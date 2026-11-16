create or replace function private.ensure_voucher_number(p_table text,p jsonb,p_stack text[] default '{}') returns text
language plpgsql security definer set search_path='' as $$
declare sid uuid:=(p->>'id')::uuid;uid uuid:=coalesce(nullif(p->>'user_id','')::uuid,nullif(p->>'created_by','')::uuid);
 org uuid:=nullif(p->>'organization_id','')::uuid;stamp timestamptz;scope text;yr int;prefix text;seq bigint;result text;
 kind text:=coalesce(p->>'kind',p->>'transaction_type',p->>'event_type',p->>'operation','');alias_table text;alias_id uuid;target jsonb;parent jsonb;canonical public.voucher_numbers%rowtype;
 key text:=p_table||':'||(p->>'id');official text;mode text;side text;
begin
 if sid is null or p_table<>all(array['transactions','personal_payables','personal_contracts','personal_contract_movements','personal_financings','debt_contracts','financial_events','liquidity_flows','liquidity_settlements','transfers','liquidity_transfers','liquidity_intercompany_transfers','participation_contracts','participation_movements','investment_contracts','investment_operations','zakat_payments','debt_payroll_requests','debt_operation_requests','vat_documents','asset_lifecycle_commands','personal_contract_reversals'])then raise exception 'VOUCHER_SOURCE_INVALID';end if;
 select document_number into result from public.voucher_numbers where source_table=p_table and source_id=sid;
 if found then return result;end if;
 if key=any(p_stack) or cardinality(p_stack)>20 then return null;end if;
 p_stack:=array_append(p_stack,key);
 stamp:=nullif(p->>'created_at','')::timestamptz;
 if p_table='transfers' then select t.created_at into stamp from public.transactions t where t.id=nullif(p->>'source_transaction_id','')::uuid;end if;
 stamp:=coalesce(stamp,nullif(p->>'transfer_date','')::date::timestamptz,clock_timestamp());
 if p_table='liquidity_intercompany_transfers' then org:=(p->>'source_organization_id')::uuid;end if;
 if p_table='personal_contracts' then
  mode:=p->'terms'->>'mode';side:=p->>'side';
  prefix:=case when mode='OPENING'then 'OB'when p->>'product'='FINANCING'then 'FN'when p->>'product'='PARTICIPATION'then 'IC'when side='PAYABLE'then 'LR'else 'LG'end;
 elsif p_table='personal_financings' then prefix:=case when kind='ADVANCE'then 'AD'when p->>'side'='PAYABLE'then 'LR'else 'LG'end;
 elsif p_table='personal_contract_movements' then
  select to_jsonb(c)into parent from public.personal_contracts c where c.id=(p->>'contract_id')::uuid;
  prefix:=case when kind in('SETTLE','SETTLE_CHARGE')then case when parent->>'side'='RECEIVABLE'then 'RC'else 'PV'end when kind='CHARGE'then 'FC'when kind='PROFIT'then 'PF'when kind='LOSS'then 'LS'else 'AJ'end;
  if kind='FUND'then alias_table:='personal_contracts';alias_id:=(p->>'contract_id')::uuid;end if;
 elsif p_table='personal_payables' then
  prefix:='OB';
  select id into alias_id from public.personal_contract_movements m where m.payable_id=sid and m.kind in('CHARGE','PROFIT')order by m.created_at,m.id limit 1;
  if alias_id is not null then alias_table:='personal_contract_movements';else
   select id into alias_id from public.personal_contracts where payable_id=sid and terms->>'mode'<>'LINKED'order by created_at,id limit 1;
   if alias_id is not null then alias_table:='personal_contracts';else
    select id into alias_id from public.personal_financings where payable_id=sid and request_id=(p->>'request_id')::uuid order by created_at,id limit 1;
    if alias_id is not null then alias_table:='personal_financings';end if;
   end if;
  end if;
 elsif p_table='debt_contracts' then
  prefix:=case when kind='OPENING'or p->>'mode'='OPENING'then 'OB'when kind='EMPLOYEE_ADVANCE'then 'EA'when exists(select 1 from public.financing_contract_terms f where f.id=sid and f.product='FINANCING')then 'FN'when p->>'side'='PAYABLE'then 'LR'else 'LG'end;
 elsif p_table='personal_contract_reversals'then prefix:='RV';
 elsif p_table='asset_lifecycle_commands'then prefix:=case kind when 'SALE'then 'SA'when 'DEPRECIATION'then 'DP'when 'DISPOSAL'then 'DS'else 'AJ'end;if p->>'transaction_id'is not null then alias_table:='transactions';alias_id:=(p->>'transaction_id')::uuid;end if;
 elsif p_table='transactions' then
  prefix:=case kind when 'OPENING_BALANCE'then 'OB'when 'ADD'then 'RC'when 'WITHDRAWAL'then 'PV'when 'SALE'then 'SA'when 'PURCHASE'then 'PA'when 'DEPRECIATION'then 'DP'when 'DISPOSAL'then 'DS'when 'REVERSAL'then 'RV'when 'ZAKAT_PAYMENT'then 'ZP'when 'TRANSFER_IN'then 'TR'when 'TRANSFER_OUT'then 'TR'else 'AJ'end;
  official:=nullif(p->>'purchase_number','');
  if kind<>'REVERSAL' then
   select id into alias_id from public.zakat_payments where cash_transaction_id=sid limit 1;
   if alias_id is not null then alias_table:='zakat_payments';elsif p->'metadata'->>'financing_id' is not null then alias_table:='personal_financings';alias_id:=(p->'metadata'->>'financing_id')::uuid;
   elsif p->'metadata'->>'personal_contract_id' is not null then
    select id into alias_id from public.personal_contract_movements where sid=any(transaction_ids)order by created_at,id limit 1;
    if alias_id is not null then alias_table:='personal_contract_movements';else alias_table:='personal_contracts';alias_id:=(p->'metadata'->>'personal_contract_id')::uuid;end if;
   elsif p->>'transfer_id'is not null then alias_table:='transfers';alias_id:=(p->>'transfer_id')::uuid;end if;
  end if;
  if kind='REVERSAL'then
   select m.reversal_request_id into alias_id from public.personal_contract_movements m where m.reversed_at is not null and nullif(p->>'reversal_of_transaction_id','')::uuid=any(m.transaction_ids)order by m.created_at,m.id limit 1;
   if alias_id is not null then alias_table:='personal_contract_reversals';end if;
  elsif alias_table is null then
   select c.id into alias_id from public.asset_lifecycle_commands c where c.transaction_id=sid limit 1;
   if alias_id is not null then alias_table:='asset_lifecycle_commands';end if;
  end if;
 elsif p_table='financial_events' then
  prefix:=case kind when 'REVERSAL'then 'RV'when 'TRANSFER'then 'TR'when 'SETTLEMENT'then 'ST'when 'ADJUSTMENT'then 'AJ'else 'EV'end;
  if kind='SETTLEMENT' then select case cash_direction when 'INFLOW'then 'RC'else 'PV'end into prefix from public.financial_event_lines where event_id=sid and cash_direction in('INFLOW','OUTFLOW')order by line_number limit 1;prefix:=coalesce(prefix,'ST');end if;
  if p->>'source_module'='FINANCE_CONTRACTS'then prefix:='FC';end if;
  if kind<>'REVERSAL'then
   alias_id:=nullif(p->>'source_record_id','')::uuid;
   alias_table:=case p->>'source_module'when 'DEBT_CONTRACTS'then 'debt_contracts'when 'ASSETS_INTEGRATION'then 'transactions'when 'ASSET_LIFECYCLE'then 'transactions'when 'VAT_INTEGRATION'then 'vat_documents'when 'INVESTMENTS'then 'investment_operations'when 'PARTICIPATION'then 'participation_movements'else null end;
   if alias_table is null then
    select id into alias_id from public.debt_payroll_requests where financial_event_id=sid limit 1;if alias_id is not null then alias_table:='debt_payroll_requests';else
     select id into alias_id from public.debt_operation_requests where financial_event_id=sid limit 1;if alias_id is not null then alias_table:='debt_operation_requests';else
      select id into alias_id from public.participation_movements where recognition_event_id=sid or cash_event_id=sid limit 1;if alias_id is not null then alias_table:='participation_movements';else
       select id into alias_id from public.investment_operations where recognition_event_id=sid or settlement_event_id=sid limit 1;if alias_id is not null then alias_table:='investment_operations';end if;
      end if;
     end if;
    end if;
   end if;
  end if;
 elsif p_table='liquidity_settlements' then prefix:=case when p->>'direction'='INFLOW'then 'RC'else 'PV'end;alias_table:='financial_events';alias_id:=nullif(p->>'financial_event_id','')::uuid;
 elsif p_table='liquidity_flows' then prefix:='CF';
 elsif p_table in('transfers','liquidity_transfers','liquidity_intercompany_transfers')then prefix:='TR';
 elsif p_table='participation_contracts'then prefix:='IC';
 elsif p_table='participation_movements'then prefix:=case kind when 'CAPITAL_RECEIPT'then 'CP'when 'CAPITAL_RETURN'then 'CR'when 'PROFIT'then 'PF'when 'LOSS'then 'LS'when 'DISTRIBUTION'then 'PD'else 'IM'end;
 elsif p_table='investment_contracts'then prefix:='IV';
 elsif p_table='investment_operations'then prefix:=case kind when 'FUND'then 'IF'when 'INCOME'then 'IR'when 'REDEEM'then 'CR'else 'IO'end;
 elsif p_table='zakat_payments'then prefix:='ZP';
 elsif p_table='debt_payroll_requests'then prefix:='PR';
 elsif p_table='debt_operation_requests'then prefix:=case kind when 'REVERSE'then 'RV'when 'REFUND'then 'RF'when 'RESCHEDULE'then 'RS'else 'AJ'end;
 elsif p_table='vat_documents'then prefix:=case p->>'document_kind'when 'CREDIT_NOTE'then 'CN'when 'DEBIT_NOTE'then 'DN'else case when p->>'document_type'='PURCHASE'then 'PI'else 'SI'end end;official:=coalesce(nullif(p->>'purchase_number',''),nullif(p->>'document_number',''));
 end if;
 if org is null and uid is null then raise exception 'VOUCHER_OWNER_REQUIRED % %',p_table,sid;end if;
 scope:=case when org is null then 'P:'||uid::text else 'O:'||org::text end;yr:=extract(year from stamp at time zone 'Asia/Riyadh')::int;
 if alias_table is not null and alias_id is not null then
  if alias_table='personal_contract_reversals'then
   select to_jsonb(m)||jsonb_build_object('id',m.reversal_request_id,'created_at',m.reversed_at)into target from public.personal_contract_movements m where m.reversal_request_id=alias_id;
  else execute format('select to_jsonb(s) from public.%I s where id=$1',alias_table)into target using alias_id;end if;
  if target is not null then
   perform private.ensure_voucher_number(alias_table,target,p_stack);
   select * into canonical from public.voucher_numbers where source_table=alias_table and source_id=alias_id;
   if found and canonical.scope_key=scope then
    insert into public.voucher_numbers values(p_table,sid,uid,org,scope,canonical.prefix,canonical.issue_year,canonical.sequence,canonical.document_number,stamp,coalesce(canonical.canonical_table,canonical.source_table),coalesce(canonical.canonical_id,canonical.source_id))on conflict(source_table,source_id)do nothing;
    return canonical.document_number;
   end if;
  end if;
 end if;
 insert into private.voucher_sequence_counters as vc values(scope,prefix,yr,1)on conflict on constraint voucher_sequence_counters_pkey do update set last_value=vc.last_value+1 returning last_value into seq;
 result:=coalesce(official,prefix||'-'||case when seq<10000 then lpad(seq::text,4,'0')else seq::text end||'-'||right(yr::text,2));
 insert into public.voucher_numbers values(p_table,sid,uid,org,scope,prefix,yr,seq,result,stamp,null,null)on conflict(source_table,source_id)do nothing;
 return result;
end$$;

create or replace function private.register_source_voucher()returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform private.ensure_voucher_number(tg_table_name,to_jsonb(new));
 if tg_table_name='personal_contract_movements'and to_jsonb(new)->>'reversed_at'is not null and to_jsonb(new)->>'reversal_request_id'is not null then
  perform private.ensure_voucher_number('personal_contract_reversals',to_jsonb(new)||jsonb_build_object('id',to_jsonb(new)->>'reversal_request_id','created_at',to_jsonb(new)->>'reversed_at'));
 end if;return null;
end$$;
revoke all on function private.ensure_voucher_number(text,jsonb,text[])from public,anon,authenticated;
revoke all on function private.register_source_voucher()from public,anon,authenticated;
create constraint trigger register_voucher_number after insert on public.asset_lifecycle_commands deferrable initially deferred for each row execute function private.register_source_voucher();
create constraint trigger register_voucher_reversal after update on public.personal_contract_movements deferrable initially deferred for each row when(new.reversed_at is not null)execute function private.register_source_voucher();
do $$declare r record;begin
 for r in select to_jsonb(c)payload from public.asset_lifecycle_commands c order by created_at,id loop perform private.ensure_voucher_number('asset_lifecycle_commands',r.payload);end loop;
 for r in select to_jsonb(m)||jsonb_build_object('id',m.reversal_request_id,'created_at',m.reversed_at)payload from public.personal_contract_movements m where m.reversed_at is not null and m.reversal_request_id is not null order by m.reversed_at,m.id loop perform private.ensure_voucher_number('personal_contract_reversals',r.payload);end loop;
end$$;
