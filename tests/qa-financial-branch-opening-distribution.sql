-- Branch-opening distribution acceptance: disposable database, all writes rolled back.
begin;
do $$
declare
 owner_id uuid:=gen_random_uuid();outsider_id uuid:=gen_random_uuid();
 org uuid:=gen_random_uuid();other_org uuid:=gen_random_uuid();branch uuid:=gen_random_uuid();
 empty_org uuid:=gen_random_uuid();empty_branch uuid:=gen_random_uuid();
 opening_id uuid:=gen_random_uuid();distribution uuid; saved jsonb;approved jsonb;context jsonb;
 entries jsonb;unbalanced jsonb;unknown_branch jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at) values
  (owner_id,owner_id||'@branch-opening.invalid',now()),
  (outsider_id,outsider_id||'@branch-opening.invalid',now());
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 insert into public.organizations(id,owner_user_id,name,approval_policy)
 values(org,owner_id,'Branch opening fixture','OWNER_CONTROLLED');
 insert into public.organization_members(organization_id,user_id,role,status)
 values(org,owner_id,'OWNER','ACTIVE');
 perform set_config('request.jwt.claim.sub',outsider_id::text,true);
 insert into public.organizations(id,owner_user_id,name,approval_policy)
 values(other_org,outsider_id,'Other branch fixture','OWNER_CONTROLLED');
 insert into public.organization_members(organization_id,user_id,role,status)
 values(other_org,outsider_id,'OWNER','ACTIVE');
 insert into public.organization_entities(id,organization_id,name,entity_type,active)
 values(branch,org,'Fixture branch','BRANCH',true);
 -- Separate newly established legal company and branch with genuinely no
 -- opening workspace. Their absence is not an approval failure by itself.
 insert into public.organizations(id,owner_user_id,name,approval_policy)
 values(empty_org,owner_id,'Zero-opening company fixture','OWNER_CONTROLLED');
 insert into public.organization_members(organization_id,user_id,role,status)
 values(empty_org,owner_id,'OWNER','ACTIVE');
 insert into public.organization_entities(id,organization_id,name,entity_type,active)
 values(empty_branch,empty_org,'Zero-opening branch fixture','BRANCH',true);
 -- Construct a previously approved corporate opening. This never touches a
 -- real workspace; both tenant and source rows exist only inside this rollback.
 insert into public.financial_opening_workspaces(
  id,organization_id,fiscal_start,currency,status,version,
  source_revision,financial_revision,source_snapshot,entries,approved_opening,
  created_by,updated_by,approved_by,approved_at)
 values(opening_id,org,'2026-01-01','SAR','APPROVED',2,
  'fixture-revision','fixture-revision','{}','{}',
  jsonb_build_array(
   jsonb_build_object('itemId','bank-1','accountCode','100001',
    'debit','300.0000','credit','0.0000'),
   jsonb_build_object('itemId','capital-1','accountCode','310001',
    'debit','0.0000','credit','300.0000')),
  owner_id,owner_id,owner_id,now());
 entries:=jsonb_build_object(
  'bank-1',jsonb_build_array(
   jsonb_build_object('branchId',null,'debit','100.0000','credit','0.0000'),
   jsonb_build_object('branchId',branch::text,'debit','200.0000','credit','0.0000')),
  'capital-1',jsonb_build_array(
   jsonb_build_object('branchId',null,'debit','0.0000','credit','100.0000'),
   jsonb_build_object('branchId',branch::text,'debit','0.0000','credit','200.0000')));
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 execute 'set local role authenticated';
 -- An entity with no opening records has no distribution to approve.
 -- A stale/foreign workspace must not be used to invent one.
 context:=public.financial_branch_opening_context(empty_org,'2026-01-01');
 if context->>'status'<>'MISSING' then
  raise exception 'Zero-opening branch unexpectedly needs an opening allocation';end if;
 begin
  perform public.save_financial_branch_opening(
   empty_org,'2026-01-01',0,opening_id,2,'{}'::jsonb,'Do not invent an opening');
  raise exception 'Foreign opening workspace accepted for new company';
 exception when others then
  if sqlerrm<>'BRANCH_OPENING_SOURCE_CHANGED' then raise;end if;
 end;
 context:=public.financial_branch_opening_context(empty_org,'2026-01-01');
 if context->>'status'<>'MISSING' then
  raise exception 'Synthetic opening allocation created for new company';end if;
 saved:=public.save_financial_branch_opening(
  org,'2026-01-01',0,opening_id,2,entries,'Verified independent branch cutoffs');
 distribution:=(saved->>'id')::uuid;
 if saved->>'status'<>'DRAFT' or (saved->>'version')::integer<>1 then
  raise exception 'Branch opening draft not persisted';end if;
 context:=public.financial_branch_opening_context(org,'2026-01-01');
 if context->>'status'<>'DRAFT' or context->'entries'<>entries or
    context->>'journalCoverageComplete'<>'false'
 then raise exception 'Draft inventory or disclaimers invalid';end if;
 -- Reject any unbalanced segment, even though company opening is balanced.
 unbalanced:=jsonb_set(entries,array['bank-1','0','debit'],'"150.0000"'::jsonb);
 unbalanced:=jsonb_set(unbalanced,array['bank-1','1','debit'],'"150.0000"'::jsonb);
 saved:=public.save_financial_branch_opening(
  org,'2026-01-01',1,opening_id,2,unbalanced,'Must not pass branch validation');
 begin
  perform public.approve_financial_branch_opening(distribution,2);
  raise exception 'Unbalanced segment approved';
 exception when others then
  if sqlerrm<>'BRANCH_OPENING_SEGMENT_UNBALANCED' then raise;end if;
 end;
 -- Unknown branch must be rejected as unrelated to this legal entity.
 unknown_branch:=jsonb_set(entries,array['bank-1','1','branchId'],to_jsonb(gen_random_uuid()::text));
 saved:=public.save_financial_branch_opening(
  org,'2026-01-01',2,opening_id,2,unknown_branch,'Unknown branch fixture');
 begin
  perform public.approve_financial_branch_opening(distribution,3);
  raise exception 'Unknown branch approved';
 exception when others then
  if sqlerrm<>'BRANCH_OPENING_BRANCH_INVALID' then raise;end if;
 end;
 saved:=public.save_financial_branch_opening(
  org,'2026-01-01',3,opening_id,2,entries,'Correct approved distribution');
 approved:=public.approve_financial_branch_opening(distribution,4);
 if approved->>'status'<>'APPROVED'
  or approved->'control'->>'kind'<>'RECONCILED_APPROVED_OPENING_DISTRIBUTION'
  or approved->'control'->>'openingDebit'<>'300.0000'
 then raise exception 'Approved distribution not reconciled/audited';end if;
 context:=public.financial_branch_opening_context(org,'2026-01-01');
 if context->>'status'<>'APPROVED' or context->>'openingVersion'<>'2'
   or context->>'journalCoverageComplete'<>'false'
 then raise exception 'Approved source evidence falsely certifies journals';end if;
 begin
  perform public.save_financial_branch_opening(
   org,'2026-01-01',0,opening_id,1,entries,'Stale version');
  raise exception 'Outdated source accepted';
 exception when others then
  if sqlerrm<>'BRANCH_OPENING_SOURCE_CHANGED' then raise;end if;
 end;
 -- Foreign tenant cannot access the manifest (or insert a replacement).
 perform set_config('request.jwt.claim.sub',outsider_id::text,true);
 begin
  perform public.financial_branch_opening_context(org,'2026-01-01');
  raise exception 'Cross-tenant branch opening leaked';
 exception when others then
  if sqlerrm<>'BRANCH_OPENING_READ_DENIED' then raise;end if;
 end;
 begin
  perform public.save_financial_branch_opening(
   org,'2026-01-01',0,opening_id,2,entries,'Cross tenant update');
  raise exception 'Cross-tenant save allowed';
 exception when others then
  if sqlerrm<>'BRANCH_OPENING_WRITE_DENIED' then raise;end if;
 end;
 begin
  update private.financial_branch_opening_distributions set entries='{}'
  where id=distribution;
  raise exception 'Direct private update was allowed';
 exception when insufficient_privilege then null;end;
 execute 'set local role postgres';
 if (select count(*) from private.financial_branch_opening_audit
       where distribution_id=distribution and action='APPROVE')<>1
 then raise exception 'Approved distribution audit missing';end if;
 -- Superseding the legal opening immediately marks the earlier distribution
 -- STALE without rewriting or silently redistributing its source balances.
 update public.financial_opening_workspaces set status='SUPERSEDED'
 where id=opening_id;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 execute 'set local role authenticated';
 context:=public.financial_branch_opening_context(org,'2026-01-01');
 if context->>'status'<>'STALE' then
  raise exception 'Opening supersession did not invalidate approved distribution';end if;
 execute 'set local role postgres';
end $$;
select 'PASS isolated branch opening approval, exact allocation, RLS, revisions, audit and staleness';
rollback;
