-- One transaction replaces the draft header and lines and synchronizes its unposted sales source.
-- Invoker security preserves the organization RLS and existing write permissions.
create or replace function public.amend_zatca_draft_atomic(p_invoice_id uuid, p_header jsonb, p_lines jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $fn$
declare
  e public.vat_einvoices%rowtype;
  h public.vat_einvoices%rowtype;
  d public.vat_documents%rowtype;
  v_event uuid; v_status text; v_counterparty uuid; v_tax_class uuid; v_base text;
  v_net numeric; v_tax numeric; v_gross numeric; v_source_net numeric; v_source_tax numeric;
  v_line_items jsonb; v_changed boolean;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  select * into e from public.vat_einvoices where id=p_invoice_id for update;
  if e.id is null then raise exception 'EINVOICE_DRAFT_NOT_FOUND'; end if;
  if not public.is_organization_admin(e.organization_id) then raise exception 'ORGANIZATION_ADMIN_REQUIRED'; end if;
  if e.status <> 'DRAFT' then raise exception 'EINVOICE_DRAFT_LOCKED'; end if;
  if (p_header->>'organization_id')::uuid is distinct from e.organization_id then raise exception 'EINVOICE_ACCOUNTING_SOURCE_MISMATCH'; end if;
  -- Only editable columns are copied below; IDs, lifecycle, QR and audit fields remain server-owned.
  h := jsonb_populate_record(e,p_header);
  if e.accounting_document_id is not null and h.accounting_document_id is distinct from e.accounting_document_id then
    raise exception 'EINVOICE_ACCOUNTING_SOURCE_MISMATCH';
  end if;
  if e.accounting_document_id is null then e.accounting_document_id := h.accounting_document_id; end if;
  if h.document_type is distinct from e.document_type then raise exception 'EINVOICE_ACCOUNTING_SOURCE_MISMATCH'; end if;
  if h.due_date is null then h.due_date := h.issue_date; end if;
  if h.due_date < h.issue_date then raise exception 'DUE_DATE_BEFORE_ISSUE_DATE'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 500 then raise exception 'INVALID_EINVOICE_DRAFT'; end if;
  if exists(select 1 from jsonb_to_recordset(p_lines) as l(quantity numeric,unit_price numeric,discount_amount numeric,line_extension_amount numeric)
      where l.quantity<=0 or l.unit_price<0 or l.discount_amount<0 or l.line_extension_amount is distinct from round(l.quantity*l.unit_price-l.discount_amount,2)) then
    raise exception 'INVALID_EINVOICE_DRAFT';
  end if;
  select sum((l->>'line_extension_amount')::numeric) into v_source_net from jsonb_array_elements(p_lines) l;
  select sum(round(t.taxable*t.rate/100,2)) into v_source_tax from (
    select sum((l->>'line_extension_amount')::numeric) taxable,(l->>'tax_rate')::numeric rate
    from jsonb_array_elements(p_lines) l group by l->>'tax_category',l->>'tax_rate'
  ) t;
  if h.tax_exclusive_amount is distinct from v_source_net or h.tax_total_amount is distinct from v_source_tax
    or h.line_extension_amount is distinct from v_source_net or h.tax_inclusive_amount is distinct from v_source_net+v_source_tax
    or h.allowance_total_amount <> 0 or h.tax_total_amount_sar is distinct from round(v_source_tax*h.exchange_rate,2)
    or h.payable_amount is distinct from v_source_net+v_source_tax then raise exception 'EINVOICE_ACCOUNTING_SOURCE_MISMATCH'; end if;
  if exists(select 1 from public.vat_documents where organization_id=e.organization_id and document_type='SALES'
    and document_kind=h.document_type and document_number=h.invoice_number and id is distinct from e.accounting_document_id) then
    raise exception 'ACCOUNTING_INVOICE_NUMBER_EXISTS';
  end if;

  if e.accounting_document_id is not null then
    select * into d from public.vat_documents where id=e.accounting_document_id and organization_id=e.organization_id for update;
    if d.id is null or d.document_type<>'SALES' or d.document_kind<>h.document_type then raise exception 'EINVOICE_ACCOUNTING_SOURCE_MISMATCH'; end if;
    select base_currency into v_base from public.organizations where id=e.organization_id;
    -- ZATCA exchange_rate is explicitly quoted to SAR. A different reporting base needs a separate rate.
    if v_base <> 'SAR' then raise exception 'EINVOICE_ACCOUNTING_BASE_CURRENCY_UNSUPPORTED'; end if;
    v_net := round(v_source_net*h.exchange_rate,2);
    v_tax := round(v_source_tax*h.exchange_rate,2);
    v_gross := v_net+v_tax;
    v_changed := d.document_number is distinct from h.invoice_number or d.transaction_date is distinct from h.issue_date
      or d.due_date is distinct from h.due_date or d.counterparty_contact_id is distinct from h.buyer_contact_id
      or d.net_amount is distinct from v_net or d.tax_amount is distinct from v_tax
      or d.source_currency is distinct from h.currency or d.exchange_rate is distinct from h.exchange_rate
      or exists (
        (select item_name,description,quantity,unit_code,unit_price,discount_amount,tax_category,tax_rate
          from jsonb_populate_recordset(null::public.vat_einvoice_lines,p_lines)
         except
         select item_name,description,quantity,unit_code,unit_price,discount_amount,tax_category,tax_rate
          from public.vat_einvoice_lines where invoice_id=e.id)
        union all
        (select item_name,description,quantity,unit_code,unit_price,discount_amount,tax_category,tax_rate
          from public.vat_einvoice_lines where invoice_id=e.id
         except
         select item_name,description,quantity,unit_code,unit_price,discount_amount,tax_category,tax_rate
          from jsonb_populate_recordset(null::public.vat_einvoice_lines,p_lines))
      );
    if v_changed then
      if h.document_type <> 'INVOICE' then raise exception 'VAT_FINANCIAL_EVENT_LOCKED'; end if;
      select event_id into v_event from public.financial_event_links where organization_id=e.organization_id
        and link_type='SOURCE' and target_module='vat_documents' and target_record_id=d.id limit 1;
      select status into v_status from public.financial_events where id=v_event for update;
      if exists(select 1 from public.financial_event_approvals where event_id=v_event and decision='APPROVED') then raise exception 'VAT_FINANCIAL_EVENT_LOCKED'; end if;
      if v_status is null or v_status not in ('DRAFT','PLANNED','COMMITTED') then raise exception 'VAT_FINANCIAL_EVENT_LOCKED'; end if;
      perform 1 from public.liquidity_flows where organization_id=e.organization_id and source_module='VAT_INTEGRATION' and source_record_id=d.id for update;
      if exists(select 1 from public.financial_event_obligation_allocations a join public.financial_event_obligations o on o.id=a.obligation_id where o.event_id=v_event)
        or exists(select 1 from public.liquidity_flows where organization_id=e.organization_id and source_module='VAT_INTEGRATION' and source_record_id=d.id and settled_amount>0)
        or exists(select 1 from public.financial_event_links l join public.financial_events se on se.id=l.event_id
          where l.organization_id=e.organization_id and l.target_module='liquidity_flows' and l.metadata->>'purpose'='SETTLEMENT_INSTRUCTION'
            and se.status not in ('CANCELLED','REVERSED') and l.target_record_id in (
              select id from public.liquidity_flows where organization_id=e.organization_id and source_module='VAT_INTEGRATION' and source_record_id=d.id)) then
        raise exception 'VAT_DOCUMENT_SETTLED_LOCKED';
      end if;
      -- Serialize projection creation for a newly selected customer and keep it in this transaction.
      perform 1 from public.vat_contacts where id=h.buyer_contact_id and organization_id=e.organization_id
        and contact_type in ('CUSTOMER','BOTH') for update;
      if not found then raise exception 'VAT_CONTACT_TYPE_MISMATCH'; end if;
      select counterparty_id into v_counterparty from public.financial_vat_counterparty_map where organization_id=e.organization_id and vat_contact_id=h.buyer_contact_id;
      if v_counterparty is null then
        select id into v_counterparty from public.liquidity_counterparties where organization_id=e.organization_id
          and notes='VAT identity projection: '||h.buyer_contact_id and active limit 1;
        if v_counterparty is null then
          insert into public.liquidity_counterparties(organization_id,name,party_type,contact_name,phone,email,notes)
            select e.organization_id,name,'CUSTOMER','','','','VAT identity projection: '||id
            from public.vat_contacts where id=h.buyer_contact_id returning id into v_counterparty;
        end if;
        insert into public.financial_vat_counterparty_map(organization_id,vat_contact_id,counterparty_id,created_by)
          values(e.organization_id,h.buyer_contact_id,v_counterparty,auth.uid());
      end if;
      select jsonb_agg(jsonb_build_object('description',l->>'item_name','unit',l->>'unit_code','quantity',l->>'quantity',
        'unit_price',round((l->>'unit_price')::numeric*h.exchange_rate,2)::text,'source_unit_price',l->>'unit_price',
        'discount_amount',round((l->>'discount_amount')::numeric*h.exchange_rate,2)::text,'source_discount_amount',l->>'discount_amount',
        'supply_type',case l->>'tax_category' when 'S' then 'STANDARD' when 'Z' then 'ZERO_RATED' when 'E' then 'EXEMPT' else 'OUT_OF_SCOPE' end,
        'net_amount',round((l->>'line_extension_amount')::numeric*h.exchange_rate,2)::text,'source_net_amount',l->>'line_extension_amount',
        'tax_rate',l->>'tax_rate','tax_amount',round((l->>'tax_amount')::numeric*h.exchange_rate,2)::text,'source_tax_amount',l->>'tax_amount',
        'gross_amount',(round((l->>'line_extension_amount')::numeric*h.exchange_rate,2)+round((l->>'tax_amount')::numeric*h.exchange_rate,2))::text,
        'source_gross_amount',l->>'gross_amount') order by (l->>'line_number')::integer) into v_line_items from jsonb_array_elements(p_lines) l;
      update public.vat_documents set document_number=h.invoice_number,transaction_date=h.issue_date,due_date=h.due_date,
        counterparty_contact_id=h.buyer_contact_id,counterparty_name=h.buyer_name,counterparty_tax_number=h.buyer_vat_number,
        net_amount=v_net,tax_amount=v_tax,gross_amount=v_gross,source_currency=h.currency,exchange_rate=h.exchange_rate,
        source_net_amount=v_source_net,source_tax_amount=v_source_tax,source_gross_amount=v_source_net+v_source_tax,
        line_items=v_line_items,tax_rate=case when v_source_net=0 then 0 else round(v_source_tax/v_source_net*100,2) end
        where id=d.id;
      update public.financial_events set counterparty_id=v_counterparty,event_date=h.issue_date,due_date=h.due_date,
        description='Sales invoice '||h.invoice_number,updated_at=now() where id=v_event;
      update public.financial_event_lines l set amount=v_net,base_amount=v_net where l.event_id=v_event
        and l.classification_id in(select id from public.financial_classifications where organization_id=e.organization_id and classification_type='REVENUE');
      if not found then raise exception 'VAT_FINANCIAL_EVENT_LOCKED'; end if;
      select id into v_tax_class from public.financial_classifications where organization_id=e.organization_id and classification_type='TAX' and active limit 1;
      if v_tax_class is null then raise exception 'VAT_FINANCIAL_CLASSIFICATIONS_REQUIRED'; end if;
      update public.financial_event_lines set amount=v_tax,base_amount=v_tax where event_id=v_event and classification_id=v_tax_class;
      if not found and v_tax>0 then
        insert into public.financial_event_lines(event_id,organization_id,line_number,description,classification_id,amount,currency,exchange_rate,base_amount,cash_direction,vat_treatment,vat_rate,vat_amount)
        values(v_event,e.organization_id,2,'Output VAT recognition',v_tax_class,v_tax,'SAR',1,v_tax,'NON_CASH','OUT_OF_SCOPE',0,0);
      end if;
      if v_tax=0 then delete from public.financial_event_lines where event_id=v_event and classification_id=v_tax_class; end if;
      update public.financial_event_obligations set settleable_amount=v_gross,settleable_base_amount=v_gross where event_id=v_event and obligation_type='RECEIVABLE';
      if not found then raise exception 'VAT_FINANCIAL_EVENT_LOCKED'; end if;
      update public.liquidity_flows set amount=v_gross,base_amount=v_gross,due_date=h.due_date,counterparty=h.buyer_name,
        counterparty_id=v_counterparty,reference=h.invoice_number,title='Invoice receivable · '||h.invoice_number,updated_at=now()
        where organization_id=e.organization_id and source_module='VAT_INTEGRATION' and source_record_id=d.id;
    end if;
  end if;
  update public.vat_einvoices set
    accounting_document_id=e.accounting_document_id,
    invoice_number=h.invoice_number,
    document_type=h.document_type,
    invoice_category=h.invoice_category,
    issue_date=h.issue_date,
    issue_time=h.issue_time,
    due_date=h.due_date,
    currency=h.currency,
    exchange_rate=h.exchange_rate,
    buyer_contact_id=h.buyer_contact_id,
    seller_name=h.seller_name,
    seller_vat_number=h.seller_vat_number,
    seller_address=h.seller_address,
    seller_building_number=h.seller_building_number,
    seller_district=h.seller_district,
    seller_additional_number=h.seller_additional_number,
    seller_city=h.seller_city,
    seller_postal_code=h.seller_postal_code,
    seller_country_code=h.seller_country_code,
    buyer_name=h.buyer_name,
    buyer_vat_number=h.buyer_vat_number,
    buyer_address=h.buyer_address,
    buyer_building_number=h.buyer_building_number,
    buyer_district=h.buyer_district,
    buyer_additional_number=h.buyer_additional_number,
    buyer_city=h.buyer_city,
    buyer_postal_code=h.buyer_postal_code,
    buyer_country_code=h.buyer_country_code,
    payment_means_code=h.payment_means_code,
    billing_reference=h.billing_reference,
    preceding_invoice_id=h.preceding_invoice_id,
    note_reason=h.note_reason,
    line_extension_amount=h.line_extension_amount,
    allowance_total_amount=h.allowance_total_amount,
    tax_exclusive_amount=h.tax_exclusive_amount,
    tax_total_amount=h.tax_total_amount,
    tax_inclusive_amount=h.tax_inclusive_amount,
    payable_amount=h.payable_amount,
    tax_total_amount_sar=h.tax_total_amount_sar, updated_at=now()
    where id=e.id returning * into e;
  delete from public.vat_einvoice_lines where invoice_id=e.id;
  insert into public.vat_einvoice_lines(invoice_id,line_number,item_name,description,quantity,unit_code,unit_price,discount_amount,tax_category,tax_rate,tax_exemption_reason_code,tax_exemption_reason,line_extension_amount,tax_amount,gross_amount)
    select e.id,l.line_number,l.item_name,l.description,l.quantity,l.unit_code,l.unit_price,l.discount_amount,l.tax_category,l.tax_rate,l.tax_exemption_reason_code,l.tax_exemption_reason,l.line_extension_amount,l.tax_amount,l.gross_amount
    from jsonb_populate_recordset(null::public.vat_einvoice_lines,p_lines) l;
  return to_jsonb(e)||jsonb_build_object('lines',(select jsonb_agg(to_jsonb(l) order by line_number) from public.vat_einvoice_lines l where invoice_id=e.id));
end $fn$;
revoke all on function public.amend_zatca_draft_atomic(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.amend_zatca_draft_atomic(uuid,jsonb,jsonb) to authenticated;
