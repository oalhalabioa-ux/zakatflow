CREATE OR REPLACE FUNCTION private.record_debt_followup(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare uid uuid:=auth.uid();org uuid:=nullif(p->>'organization_id','')::uuid;target uuid:=(p->>'debt_id')::uuid;req uuid:=(p->>'request_id')::uuid;r public.debt_collection_followups%rowtype;kind text:=p->>'target_type';assignee uuid:=nullif(p->>'assignee_id','')::uuid;ccy text;installment_balance numeric;
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 if req is null or target is null or(p->>'action_date')::date>(now()at time zone 'Asia/Riyadh')::date then raise exception 'FOLLOWUP_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text||req::text,0));select * into r from public.debt_collection_followups where user_id=uid and request_id=req;
 if r.id is not null then if r.fingerprint<>md5(p::text)then raise exception 'FOLLOWUP_REQUEST_CONFLICT';end if;return r.id;end if;
 if kind='CORE'and org is not null then
  if not public.financial_core_can(org,'financial_core.view')or not public.financial_core_can(org,'financial_core.create')then raise exception 'FOLLOWUP_ACCESS_DENIED';end if;
  select o.base_currency into ccy from public.financial_event_obligations o join public.financial_events e on e.id=o.event_id and e.organization_id=o.organization_id and e.status='ACTUAL' where o.id=target and o.organization_id=org and o.obligation_type in('PAYABLE','RECEIVABLE')and o.adjusts_obligation_id is null;
  if assignee is not null and not exists(select 1 from public.organization_members where organization_id=org and user_id=assignee and status='ACTIVE')then raise exception 'FOLLOWUP_ASSIGNEE_INVALID';end if;
 elsif kind='PERSONAL_RECEIVABLE'and org is null then
  select base_currency into ccy from public.profiles where id=uid;
  if not exists(select 1 from public.asset_accounts where id=target and user_id=uid and organization_id is null and asset_type='RECEIVABLE')then ccy:=null;end if;
 elsif kind='PERSONAL_PAYABLE'and org is null then select currency into ccy from public.personal_payables where id=target and user_id=uid and cancelled_at is null;
 else raise exception 'FOLLOWUP_INVALID';end if;
 if org is null and ccy is null and kind in('PERSONAL_RECEIVABLE','PERSONAL_PAYABLE')then
  select c.currency,least(i.amount,greatest(0,private.personal_contract_balance(c.asset_id,c.payable_id)-coalesce((select sum(j.amount)from public.personal_contract_installments j where j.contract_id=c.id and j.number>i.number),0)))
  into ccy,installment_balance from public.personal_contract_installments i join public.personal_contracts c on c.id=i.contract_id
  where i.id=target and i.user_id=uid and c.user_id=uid and c.status='POSTED'and c.product in('QARD','FINANCING')
   and c.side=case when kind='PERSONAL_RECEIVABLE'then 'RECEIVABLE'else 'PAYABLE'end;
  if coalesce((p->>'promise_amount')::numeric,0)>installment_balance then raise exception 'PROMISE_EXCEEDS_BALANCE';end if;
 end if;
 if org is null and assignee is not null and assignee<>uid then raise exception 'FOLLOWUP_ASSIGNEE_INVALID';end if;
 if ccy is null then raise exception 'FOLLOWUP_TARGET_INVALID';end if;
 if kind='CORE'and coalesce((p->>'promise_amount')::numeric,0)>coalesce((select outstanding_base_amount from public.financial_event_obligation_balances where obligation_id=target and organization_id=org),0)then raise exception 'PROMISE_EXCEEDS_BALANCE';end if;
 insert into public.debt_collection_followups(request_id,user_id,organization_id,debt_id,target_type,status,action_date,next_date,promise_date,promise_amount,currency,assignee_id,note,fingerprint)
 values(req,uid,org,target,kind,p->>'status',(p->>'action_date')::date,nullif(p->>'next_date','')::date,nullif(p->>'promise_date','')::date,(p->>'promise_amount')::numeric,ccy,assignee,trim(p->>'note'),md5(p::text))returning id into target;return target;
end $function$
