begin;
do $$
declare u uuid:=gen_random_uuid(); stranger uuid:=gen_random_uuid(); org uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); r jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at) values(u,u||'@center-registry.invalid',now()),(stranger,stranger||'@center-registry.invalid',now());
 perform set_config('request.jwt.claim.sub',u::text,true);
 insert into public.organizations(id,owner_user_id,name,approval_policy) values(org,u,'Center registry isolated fixture','OWNER_CONTROLLED');
 insert into public.organization_members(organization_id,user_id,role,status) values(org,u,'OWNER','ACTIVE');
 insert into public.organization_cost_centers(id,organization_id,code,name,center_type) values(c,org,'CENTER','Center','OPERATING');
 insert into public.organization_entities(id,organization_id,name,entity_type,active) values(b,org,'Branch','BRANCH',true);
 set local role authenticated;
 r:=public.assign_financial_center_branch(org,c,null,'2025-01-01','2025-12-31',0,'Historical HQ assignment');
 if r->>'revision'<>'1' then raise exception 'missing revision';end if;
 begin
  perform public.assign_financial_center_branch(org,c,b,'2026-01-01',null,0,'Stale request');raise exception 'accepted stale';
 exception when others then if sqlerrm<>'CENTER_BRANCH_VERSION_CONFLICT' then raise;end if;end;
 begin
  perform public.assign_financial_center_branch(org,c,b,'2025-12-31',null,1,'Overlapping request');raise exception 'accepted overlap';
 exception when others then if sqlerrm<>'CENTER_BRANCH_ASSIGNMENT_OVERLAP' then raise;end if;end;
 perform public.assign_financial_center_branch(org,c,b,'2026-01-01',null,1,'Prospective branch assignment');
 r:=public.financial_center_branch_registry(org);
 if jsonb_array_length(r->'assignments')<>2 or r->>'revision'<>'2' or r#>>'{assignments,0,branchId}' is not null
 then raise exception 'historical assignment changed';end if;
 begin
  delete from private.financial_center_branch_assignments where organization_id=org;raise exception 'direct modification allowed';
 exception when insufficient_privilege then null;end;
 begin
  perform public.transfer_financial_center_branch(org,c,null,current_date,2,'Retroactive transfer');raise exception 'retroactive transfer accepted';
 exception when others then if sqlerrm<>'CENTER_BRANCH_FUTURE_TRANSFER_REQUIRED' then raise;end if;end;
 begin
  perform public.transfer_financial_center_branch(org,c,gen_random_uuid(),current_date+30,2,'Invalid branch');raise exception 'unknown branch accepted';
 exception when others then if sqlerrm<>'CENTER_BRANCH_BRANCH_INVALID' then raise;end if;end;
 r:=public.financial_center_branch_registry(org);
 if r#>>'{assignments,1,to}' is not null or r->>'revision'<>'2' then raise exception 'failed transfer changed history';end if;
 perform public.transfer_financial_center_branch(org,c,null,current_date+30,2,'Future HQ transfer');
 r:=public.financial_center_branch_registry(org);
 if r->>'revision'<>'3' or r#>>'{assignments,1,to}'<>(current_date+29)::text or r#>>'{assignments,2,from}'<>(current_date+30)::text
 then raise exception 'transfer intervals incorrect';end if;
 reset role;
 if (select count(*) from private.financial_center_branch_transfers where organization_id=org)<>1 then raise exception 'transfer audit missing';end if;
 set local role authenticated;
 perform set_config('request.jwt.claim.sub',stranger::text,true);
 begin
  perform public.financial_center_branch_registry(org);raise exception 'foreign read allowed';
 exception when others then if sqlerrm<>'CENTER_BRANCH_READ_DENIED' then raise;end if;end;
 begin
  perform public.assign_financial_center_branch(org,c,b,'2027-01-01',null,2,'Foreign write');raise exception 'foreign write allowed';
 exception when others then if sqlerrm<>'CENTER_BRANCH_WRITE_DENIED' then raise;end if;end;
 reset role;
end $$;
rollback;
