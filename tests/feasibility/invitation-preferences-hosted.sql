-- QA V2 only. Run after the candidate migration in the same rollback-only transaction.
do $test$
declare
  src uuid := 'f1e204a6-2176-4841-8faa-fee0ec35ecb4'; -- QA411
  dst uuid := 'c99f1c06-b30c-4673-a8e2-b2ed24d8b50c'; -- QA438
  third uuid := 'ce8c4aea-32fc-47c3-bda9-9a454946de68'; -- QA421
  sender uuid := '97512f53-ccf9-4fea-b5cc-2d6e87b4f43f';
  recipient uuid := '392afe57-dcec-42c8-b801-ad5e679f5010';
  project uuid := '48000000-0000-4000-8000-000000000097';
  invitation uuid;
  details jsonb;
begin
  insert into public.feasibility_projects(id,organization_id,created_by_user_id,title,study)
    select project,src,sender,'QA invitation preferences',
      study || jsonb_build_object('id',project,'title','QA invitation preferences')
    from public.feasibility_projects where id='48000000-0000-4000-8000-000000000002' and organization_id=src;
  update private.feasibility_sharing_policy set mode='edit',company_invitations_enabled=true,
    company_invitation_pilot_source=src,company_invitation_pilot_recipient=dst where singleton;
  update private.feasibility_evidence_feature_switch set enabled=true where singleton;
  delete from private.feasibility_invitation_reception where organization_id=dst;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub',recipient::text,true);
  if public.feasibility_invitation_reception(dst) then raise exception 'Unconfigured reception is on'; end if;
  perform public.feasibility_company_invitations('directory_disable',dst);
  perform set_config('request.jwt.claim.sub',sender::text,true);
  begin
    perform public.feasibility_invitation_reception(dst,true);
    raise exception 'Nonmember changed preferences';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.feasibility_issue_with_documents(src,project,dst,1,1,'read','none','{}');
    raise exception 'Disabled reception accepted issuance';
  exception when insufficient_privilege then
    if sqlerrm <> 'FEASIBILITY_INVITATION_RECEPTION_DISABLED' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub',recipient::text,true);
  perform public.feasibility_invitation_reception(dst,true);
  if public.feasibility_company_invitations('directory_status',dst) <> 'false'::jsonb then
    raise exception 'Reception opted into discovery';
  end if;
  perform set_config('request.jwt.claim.sub',sender::text,true);
  if public.feasibility_company_invitations('directory_search',src,null,null,null,null,null,'QA438') <> '[]'::jsonb then
    raise exception 'Hidden organization appeared in search';
  end if;
  begin
    perform public.feasibility_company_invitations('issue',src,null,project,third,1,1,'read');
    raise exception 'Third institution accepted via legacy RPC';
  exception when insufficient_privilege then
    if sqlerrm <> 'FEASIBILITY_INVITATION_PILOT_RESTRICTED' then raise; end if;
  end;
  begin
    perform public.feasibility_issue_with_documents(src,project,third,1,1,'read','none','{}');
    raise exception 'Third institution accepted via document RPC';
  exception when insufficient_privilege then
    if sqlerrm <> 'FEASIBILITY_INVITATION_PILOT_RESTRICTED' then raise; end if;
  end;
  begin
    perform public.feasibility_issue_with_documents(src,project,dst,1,1,'edit','none','{}');
    raise exception 'Pilot allowed editing';
  exception when insufficient_privilege then
    if sqlerrm <> 'FEASIBILITY_INVITATION_PILOT_RESTRICTED' then raise; end if;
  end;
  begin
    perform public.feasibility_issue_with_documents(src,project,dst,1,1,'read','all','{}');
    raise exception 'Pilot allowed documents';
  exception when insufficient_privilege then
    if sqlerrm <> 'FEASIBILITY_INVITATION_PILOT_RESTRICTED' then raise; end if;
  end;

  invitation := (public.feasibility_issue_with_documents(src,project,dst,1,1,'read','none','{}')->>'id')::uuid;
  perform set_config('request.jwt.claim.sub',recipient::text,true);
  perform public.feasibility_invitation_reception(dst,false);
  begin
    perform public.feasibility_company_invitations('accept',dst,invitation);
    raise exception 'Disabled reception accepted a pending invitation';
  exception when insufficient_privilege then
    if sqlerrm <> 'FEASIBILITY_INVITATION_RECEPTION_DISABLED' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub',sender::text,true);
  begin
    perform public.feasibility_issue_with_documents(src,project,dst,1,1,'read','none','{}');
    raise exception 'Retry skipped reception';
  exception when insufficient_privilege then
    if sqlerrm <> 'FEASIBILITY_INVITATION_RECEPTION_DISABLED' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub',recipient::text,true);
  perform public.feasibility_invitation_reception(dst,true);
  perform public.feasibility_company_invitations('accept',dst,invitation);
  perform public.feasibility_company_invitations('directory_enable',dst);
  perform public.feasibility_company_invitations('directory_disable',dst);
  perform public.feasibility_invitation_reception(dst,false);
  details := public.feasibility_company_shares_access('open',dst,project,null,null,null,null,null);
  if details->>'can_edit' is distinct from 'false'
    or public.feasibility_evidence('list',project,'valuation',dst) <> '[]'::jsonb then
    raise exception 'Existing share revoked or pilot scope enlarged';
  end if;
end $test$;
