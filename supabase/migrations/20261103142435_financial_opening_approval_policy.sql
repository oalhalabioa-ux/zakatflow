create or replace function public.approve_financial_opening(p_id uuid,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w public.financial_opening_workspaces%rowtype;s jsonb;r jsonb;v jsonb;amount numeric;total numeric:=0;volume numeric:=0;opening jsonb:='[]';prior uuid;pol text;
begin
 select * into w from public.financial_opening_workspaces where id=p_id;
 if w.id is null or not private.financial_opening_can(w.organization_id,'financial_core.approve') or not private.financial_opening_can(w.organization_id,'financial_core.post') then raise exception 'OPENING_APPROVE_DENIED';end if;
 perform pg_advisory_xact_lock(hashtextextended('reporting-opening:'||w.organization_id::text||w.fiscal_start::text,0));
 select * into w from public.financial_opening_workspaces where id=p_id for update;
 -- Lock financial sources for this short approval transaction, closing the read/approve race.
 lock table public.financial_events,public.financial_event_lines,public.financial_event_links,public.financial_event_obligations,
  public.financial_event_obligation_allocations,public.liquidity_accounts,public.liquidity_counterparties,public.liquidity_flows,
  public.liquidity_settlements,public.asset_accounts,public.transactions,public.transaction_allocations,public.debt_contracts in share mode;
 perform 1 from public.organization_members where organization_id=w.organization_id and user_id=auth.uid() for share;
 if not private.financial_opening_can(w.organization_id,'financial_core.approve') or not private.financial_opening_can(w.organization_id,'financial_core.post') then raise exception 'OPENING_APPROVE_DENIED';end if;
 if w.status='APPROVED' and w.version=p_expected_version+1 then return to_jsonb(w);end if;
 if w.status<>'DRAFT' or w.version is distinct from p_expected_version then raise exception 'OPENING_VERSION_CONFLICT';end if;
 s:=private.financial_opening_sources(w.organization_id,w.fiscal_start-1);
 if s->>'revision' is distinct from w.source_revision then raise exception 'OPENING_SOURCE_CHANGED';end if;
 for r in select * from jsonb_array_elements(s->'rows') loop
  v:=w.entries->(r->>'id');
  if r->>'sourceIssue' is not null then raise exception 'OPENING_SOURCE_REVIEW_REQUIRED';end if;
  if jsonb_array_length(r->'vouchers')=0 and coalesce(v->>'amount','')='' then raise exception 'OPENING_INCOMPLETE';end if;
  amount:=coalesce((select sum((a->>'debit')::numeric-(a->>'credit')::numeric) from jsonb_array_elements(r->'vouchers') a),0)
   +coalesce(nullif(v->>'amount','')::numeric,0)*case when v->>'side'='CREDIT' then -1 else 1 end;
  if (coalesce(nullif(v->>'amount','')::numeric,0)<>0 and jsonb_array_length(r->'vouchers')>0
    or amount<>0 and (amount>0)<>(r->>'normal'='DEBIT')) and length(trim(coalesce(v->>'reason','')))<3 then raise exception 'OPENING_CORRECTION_REASON_REQUIRED';end if;
  total:=total+amount;
  volume:=volume+greatest(amount,0);
  opening:=opening||jsonb_build_array(jsonb_build_object('itemId',r->>'id','accountCode',coalesce(v->>'accountCode',r->>'accountCode'),
   'debit',greatest(amount,0)::numeric(24,4)::text,'credit',greatest(-amount,0)::numeric(24,4)::text));
 end loop;
 if total<>0 then raise exception 'OPENING_UNBALANCED';end if;
 if not public.effective_organization_permission(w.organization_id,'financial_core.approve',volume,w.currency)
  or not public.effective_organization_permission(w.organization_id,'financial_core.post',volume,w.currency) then raise exception 'OPENING_APPROVE_DENIED';end if;
 select approval_policy into pol from public.organizations where id=w.organization_id for share;
 if auth.uid() in(w.created_by,w.updated_by) and not
  (pol='OWNER_CONTROLLED' and exists(select 1 from public.organization_members where organization_id=w.organization_id and user_id=auth.uid() and status='ACTIVE' and role='OWNER')
   or pol='ROLE_BASED' and public.explicit_organization_permission(w.organization_id,'financial_core.self_approve',volume,w.currency))
  then raise exception 'OPENING_SELF_APPROVAL_DENIED';end if;
 if exists(select 1 from public.financial_opening_workspaces where organization_id=w.organization_id and fiscal_start=w.fiscal_start and status='APPROVED') and length(trim(w.reason))<3 then raise exception 'OPENING_SUPERSESSION_REASON_REQUIRED';end if;
 for prior in update public.financial_opening_workspaces set status='SUPERSEDED',updated_at=now() where organization_id=w.organization_id and fiscal_start=w.fiscal_start and status='APPROVED' returning id loop
  insert into public.financial_opening_audit(workspace_id,organization_id,actor_id,action,version,detail) select prior,w.organization_id,auth.uid(),'SUPERSEDE',version,jsonb_build_object('replacement',w.id,'reason',w.reason) from public.financial_opening_workspaces where id=prior;
 end loop;
 update public.financial_opening_workspaces set status='APPROVED',approved_opening=opening,approved_by=auth.uid(),approved_at=now(),
  updated_by=auth.uid(),updated_at=now(),version=version+1 where id=w.id returning * into w;
 insert into public.financial_opening_audit(workspace_id,organization_id,actor_id,action,version,detail)
 values(w.id,w.organization_id,auth.uid(),'APPROVE',w.version,jsonb_build_object('opening',opening,'sourceRevision',w.source_revision,'reason',w.reason));
 return to_jsonb(w);
end $$;
revoke all on function public.approve_financial_opening(uuid,integer) from public,anon;
grant execute on function public.approve_financial_opening(uuid,integer) to authenticated;

