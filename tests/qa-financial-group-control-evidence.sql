-- Disposable Supabase PostgreSQL only; every synthetic owner/org/assessment is rolled back.
begin;
do $$
declare
  owner_id uuid:=gen_random_uuid();outsider_id uuid:=gen_random_uuid();
  root_org uuid:=gen_random_uuid();subsidiary_org uuid:=gen_random_uuid();foreign_org uuid:=gen_random_uuid();
  approved_id uuid;new_id uuid;request_key uuid:=gen_random_uuid();ctx jsonb;
begin
  insert into auth.users(id,email,email_confirmed_at)
    values(owner_id,owner_id||'@group-control.invalid',now()),
          (outsider_id,outsider_id||'@group-control.invalid',now());
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  insert into public.organizations(id,owner_user_id,name,approval_policy)
    values(root_org,owner_id,'Controlled parent fixture','OWNER_CONTROLLED'),
          (subsidiary_org,owner_id,'Controlled subsidiary fixture','OWNER_CONTROLLED');
  insert into public.organization_members(organization_id,user_id,role,status)
    values(root_org,owner_id,'OWNER','ACTIVE'),(subsidiary_org,owner_id,'OWNER','ACTIVE');
  perform set_config('request.jwt.claim.sub',outsider_id::text,true);
  insert into public.organizations(id,owner_user_id,name,approval_policy)
    values(foreign_org,outsider_id,'Unrelated fixture','OWNER_CONTROLLED');
  insert into public.organization_members(organization_id,user_id,role,status)
    values(foreign_org,outsider_id,'OWNER','ACTIVE');

  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  approved_id:=public.financial_group_control_propose(
    root_org,subsidiary_org,'2026-01-01',null,80,65,'VOTING',
    'signed-control-reference-A','Recorded approved board evidence',request_key);
  if approved_id<>public.financial_group_control_propose(
    root_org,subsidiary_org,'2026-01-01',null,80,65,'VOTING',
    'signed-control-reference-A','Recorded approved board evidence',request_key) then
    raise exception 'Idempotent request created duplicate';
  end if;
  if (select count(*) from private.financial_group_control_audit where assessment_id=approved_id)<>1
    then raise exception 'Duplicate proposal audit';end if;
  begin
    perform public.financial_group_control_propose(root_org,subsidiary_org,'2026-01-01',null,
      60,65,'VOTING','signed-control-reference-A','Different request payload',request_key);
    raise exception 'Mutated idempotency key accepted';
  exception when others then
    if sqlerrm<>'GROUP_CONTROL_REQUEST_CONFLICT' then raise;end if;
  end;
  perform public.financial_group_control_approve(approved_id,'Both company controls verified');
  ctx:=public.financial_group_control_context(root_org,'2026-12-31');
  if ctx->>'status'<>'EVIDENCE_ONLY' or ctx->>'registryComplete'<>'false'
    or jsonb_array_length(ctx->'relationships')<>1
    or ctx->'relationships'->0->>'subsidiaryOrganizationId'<>subsidiary_org::text
    then raise exception 'Approved control inventory is incomplete or overclaims consolidation';end if;
  if (select count(*) from private.financial_group_control_audit where assessment_id=approved_id)<>2
    then raise exception 'Approval audit missing';end if;

  new_id:=public.financial_group_control_propose(root_org,subsidiary_org,'2026-06-01',null,
    81,70,'VOTING','signed-control-reference-B','Replacement ownership claim',gen_random_uuid());
  begin
    perform public.financial_group_control_approve(new_id,'Reject same-child overlap');
    raise exception 'Overlapping control accepted';
  exception when others then
    if sqlerrm<>'GROUP_CONTROL_PERIOD_OVERLAP' then raise;end if;
  end;

  new_id:=public.financial_group_control_propose(subsidiary_org,root_org,'2026-01-01',null,
    70,70,'VOTING','signed-control-reference-C','Attempt cyclic ownership',gen_random_uuid());
  begin
    perform public.financial_group_control_approve(new_id,'Reject circular control path');
    raise exception 'Circular control accepted';
  exception when others then
    if sqlerrm<>'GROUP_CONTROL_CYCLE' then raise;end if;
  end;

  update public.organizations set approval_policy='STRICT_SEGREGATION' where id=root_org;
  new_id:=public.financial_group_control_propose(root_org,subsidiary_org,'2027-01-01','2027-12-31',
    80,65,'VOTING','signed-control-reference-D','Require independent approver',gen_random_uuid());
  begin
    perform public.financial_group_control_approve(new_id,'Self approval must fail here');
    raise exception 'Strict self approval accepted';
  exception when others then
    if sqlerrm<>'GROUP_CONTROL_SELF_APPROVAL_DENIED' then raise;end if;
  end;

  perform set_config('request.jwt.claim.sub',outsider_id::text,true);
  begin
    perform public.financial_group_control_context(root_org,'2026-12-31');
    raise exception 'Outsider read parent relationships';
  exception when others then
    if sqlerrm<>'GROUP_CONTROL_READ_DENIED' then raise;end if;
  end;
  begin
    perform public.financial_group_control_propose(root_org,foreign_org,'2026-01-01',null,
      100,100,'VOTING','signed-control-reference-E','Cross tenant attempt',gen_random_uuid());
    raise exception 'Outsider proposed group control';
  exception when others then
    if sqlerrm<>'GROUP_CONTROL_WRITE_DENIED' then raise;end if;
  end;
  execute 'set local role authenticated';
  begin
    perform 1 from private.financial_group_control_assessments where id=approved_id;
    raise exception 'Direct private control read leaked';
  exception when insufficient_privilege then null;end;
  begin
    update private.financial_group_control_assessments set status='DRAFT' where id=approved_id;
    raise exception 'Approved relationship mutable directly';
  exception when insufficient_privilege then null;end;
  execute 'set local role postgres';
end $$;
select 'PASS effective control approvals, audit, overlaps, cycle, idempotency and cross-tenant denial';
rollback;
