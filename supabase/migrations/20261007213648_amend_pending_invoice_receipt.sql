-- A receipt may be corrected before approval/posting. Posted cash is immutable and requires reversal.
create or replace function public.amend_pending_invoice_receipt(p_event_id uuid,p_account_id uuid,p_date date,p_amount numeric)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare
 e public.financial_events%rowtype; f public.liquidity_flows%rowtype; a public.liquidity_accounts%rowtype;
 l public.financial_event_links%rowtype; m jsonb; v_base numeric; v_rate numeric;
begin
 if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
 select * into e from public.financial_events where id=p_event_id for update;
 if e.id is null then raise exception 'RECEIPT_NOT_FOUND'; end if;
 if not public.is_organization_admin(e.organization_id) or not public.has_organization_permission(e.organization_id,'liquidity.settle') then raise exception 'ORGANIZATION_ADMIN_REQUIRED'; end if;
 if e.event_type<>'SETTLEMENT' or e.status not in ('DRAFT','PLANNED','COMMITTED')
    or exists(select 1 from public.liquidity_settlements where financial_event_id=e.id)
    or exists(select 1 from public.financial_event_approvals where event_id=e.id and decision='APPROVED') then raise exception 'RECEIPT_EDIT_LOCKED'; end if;
 select * into l from public.financial_event_links where event_id=e.id and organization_id=e.organization_id
   and link_type='OTHER' and target_module='liquidity_flows' and metadata->>'purpose'='SETTLEMENT_INSTRUCTION' for update;
 if l.id is null then raise exception 'SETTLEMENT_INSTRUCTION_REQUIRED'; end if;
 select * into f from public.liquidity_flows where id=l.target_record_id and organization_id=e.organization_id for update;
 if f.id is null or f.source_module<>'VAT_INTEGRATION' or f.direction<>'INFLOW' then raise exception 'RECEIPT_NOT_FOUND'; end if;
 select * into a from public.liquidity_accounts where id=p_account_id and organization_id=e.organization_id and active;
 if a.id is null or a.currency<>f.currency then raise exception 'SETTLEMENT_ACCOUNT_CURRENCY_MISMATCH'; end if;
 if f.account_id is not null and f.account_id<>p_account_id then raise exception 'SETTLEMENT_FLOW_ACCOUNT_MISMATCH'; end if;
 if p_date is null or p_amount is null or p_amount<=0 then raise exception 'SETTLEMENT_AMOUNT_INVALID'; end if;
 if p_amount>f.amount-coalesce(f.settled_amount,0) then raise exception 'SETTLEMENT_EXCEEDS_FLOW_OUTSTANDING'; end if;
 m:=l.metadata; v_rate:=(m->>'exchange_rate')::numeric; v_base:=round(p_amount*v_rate,4);
 if v_rate is null or v_rate<=0 then raise exception 'SETTLEMENT_AMOUNT_INVALID'; end if;
 if (select count(*) from public.financial_event_lines where event_id=e.id)<>1 then raise exception 'RECEIPT_EDIT_LOCKED'; end if;
 update public.financial_event_lines set amount=p_amount,base_amount=v_base where event_id=e.id;
 update public.financial_events set event_date=p_date,updated_at=now() where id=e.id;
 update public.financial_event_links set metadata=m||jsonb_build_object('account_id',p_account_id,'settlement_date',p_date,
   'amount',p_amount,'base_amount',v_base,'flow_amount',p_amount,'amended_by',auth.uid(),'amended_at',now()) where id=l.id;
 insert into public.audit_logs(user_id,entity_type,entity_id,action,old_data,new_data)
 values(auth.uid(),'invoice_receipt',e.id,'AMEND_BEFORE_POSTING',m,jsonb_build_object('account_id',p_account_id,'settlement_date',p_date,'amount',p_amount,'base_amount',v_base));
 return jsonb_build_object('event_id',e.id,'saved',true,'posted',false);
end $fn$;
revoke all on function public.amend_pending_invoice_receipt(uuid,uuid,date,numeric) from public,anon;
grant execute on function public.amend_pending_invoice_receipt(uuid,uuid,date,numeric) to authenticated;
