-- Synthetic fixtures and commands; rollback leaves no data or approvals.
begin;
do $$
declare u uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); one_only uuid:=gen_random_uuid();
 a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();ea uuid:=gen_random_uuid();eb uuid:=gen_random_uuid();
 request uuid:=gen_random_uuid();m uuid;other uuid;r jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at) values(u,u||'@group-doc.invalid',now()),(outsider,outsider||'@group-doc.invalid',now()),(one_only,one_only||'@group-doc.invalid',now());
 perform set_config('request.jwt.claim.sub',u::text,true);
 insert into public.organizations(id,owner_user_id,name,approval_policy) values(a,u,'Document parent fixture','OWNER_CONTROLLED'),(b,u,'Document child fixture','OWNER_CONTROLLED');
 insert into public.organization_members(organization_id,user_id,role,status) values(a,u,'OWNER','ACTIVE'),(b,u,'OWNER','ACTIVE'),(a,one_only,'ADMIN','ACTIVE');
 -- SQL fixtures exercise evidence security. Native voucher lifecycle is tested
 -- independently by verify-source-bound-group-preview.mjs.
 insert into public.financial_events(id,organization_id,event_type,source_module,source_event_key,event_date,status,base_currency)
 values(ea,a,'REVENUE','OPERATIONAL_CONSOLE','group-doc-a','2026-10-01','ACTUAL','SAR'),(eb,b,'EXPENSE','OPERATIONAL_CONSOLE','group-doc-b','2026-10-01','ACTUAL','SAR');
 set local role authenticated;
 m:=public.financial_group_document_propose(ea,eb,'Signed reciprocal invoice reference','Both original documents reviewed',request);
 if m<>public.financial_group_document_propose(eb,ea,'Signed reciprocal invoice reference','Both original documents reviewed',request) then raise exception 'duplicate proposal';end if;
 begin
  perform public.financial_group_document_propose(ea,eb,'Different documentary evidence','Both original documents reviewed',request);raise exception 'mutated request accepted';
 exception when others then if sqlerrm<>'GROUP_DOCUMENT_REQUEST_CONFLICT' then raise;end if;end;
 perform set_config('request.jwt.claim.sub',one_only::text,true);
 begin
  perform public.financial_group_document_decide(m,'APPROVE','Cross company permission absent');raise exception 'single company authority accepted';
 exception when others then if sqlerrm<>'GROUP_DOCUMENT_APPROVAL_DENIED' then raise;end if;end;
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform public.financial_group_document_decide(m,'APPROVE','Both reciprocal invoices verified');
 r:=public.financial_group_document_context(array[m]);
 if r#>>'{0,status}'<>'APPROVED' or r#>>'{0,sourceCurrent}'<>'true' then raise exception 'approved match missing';end if;
 other:=public.financial_group_document_propose(eb,ea,'Duplicate invoice reference','Second proposal cannot double approve',gen_random_uuid());
 begin
  perform public.financial_group_document_decide(other,'APPROVE','Duplicate reciprocal invoices');raise exception 'duplicate match approved';
 exception when others then if sqlerrm<>'GROUP_DOCUMENT_ALREADY_MATCHED' then raise;end if;end;
 begin
  delete from private.financial_group_document_matches where id=m;raise exception 'direct write accepted';
 exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 begin
  perform public.financial_group_document_context(array[m]);raise exception 'foreign match disclosed';
 exception when others then if sqlerrm<>'GROUP_DOCUMENT_READ_DENIED' then raise;end if;end;
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform public.financial_group_document_decide(m,'REVOKE','Document pairing corrected after review');
 if public.financial_group_document_context(array[m])#>>'{0,status}'<>'REVOKED' then raise exception 'revocation missing';end if;
 begin
  perform public.financial_group_document_decide(m,'APPROVE','Cannot silently reactivate revoked evidence');raise exception 'revoked match reapproved';
 exception when others then if sqlerrm<>'GROUP_DOCUMENT_NOT_DRAFT' then raise;end if;end;
 reset role;
 if (select count(*) from private.financial_group_document_match_audit where match_id=m)<>3 then raise exception 'audit incomplete';end if;
 -- A concurrent original-source correction invalidates the saved evidence.
 update public.financial_events set description='Changed source identity' where id=ea;
 set local role authenticated;
 if public.financial_group_document_context(array[other])#>>'{0,sourceCurrent}'<>'false' then raise exception 'source mismatch hidden';end if;
 begin
  perform public.financial_group_document_decide(other,'APPROVE','Approval of changed source blocked');raise exception 'changed source approved';
 exception when others then if sqlerrm<>'GROUP_DOCUMENT_SOURCE_CHANGED' then raise;end if;end;
 reset role;
 if has_function_privilege('anon','public.financial_group_document_context(uuid[])','execute') then raise exception 'anonymous reader enabled';end if;
end $$;
rollback;
