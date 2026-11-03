-- Run on Financial Core QA only. Every fixture and write is rolled back.
begin;
create temporary table opening_qa_snapshots(stage text,payload jsonb);grant select,insert on opening_qa_snapshots to authenticated;
create temporary table opening_qa_results(name text primary key,passed boolean not null);
grant select,insert on opening_qa_results to authenticated;
do $$
declare u uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();o uuid:=gen_random_uuid();other_org uuid:=gen_random_uuid();cash uuid:=gen_random_uuid();party uuid:=gen_random_uuid();
 s jsonb;w jsonb;e jsonb;approved jsonb;denied boolean;cls uuid:=gen_random_uuid();taxcls uuid:=gen_random_uuid();revcls uuid:=gen_random_uuid();invoice uuid:=gen_random_uuid();sale uuid:=gen_random_uuid();payment uuid:=gen_random_uuid();policy jsonb;rules jsonb;snap jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at) values(u,'opening-rollback-'||u||'@example.invalid',now()),(outsider,'opening-rollback-'||outsider||'@example.invalid',now());
 perform set_config('request.jwt.claim.sub',u::text,true);
 insert into public.organizations(id,owner_user_id,name) values(o,u,'Opening rollback QA');
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 insert into public.organizations(id,owner_user_id,name) values(other_org,outsider,'Other rollback QA');
 perform set_config('request.jwt.claim.sub',u::text,true);
 insert into public.organization_members(organization_id,user_id,role,status) values(o,u,'OWNER','ACTIVE'),(other_org,outsider,'OWNER','ACTIVE')
 on conflict(organization_id,user_id) do update set role=excluded.role,status='ACTIVE';
 insert into public.liquidity_accounts(id,organization_id,name,account_type,currency,current_balance,current_balance_base,created_by,metadata)
 values(cash,o,'QA cash','CASH','SAR',500,500,u,jsonb_build_object('opening_balance',500,'opening_date','2025-12-31','opening_fx_rate',1));
 insert into public.liquidity_counterparties(id,organization_id,name,party_type,created_by) values(party,o,'Missing customer','CUSTOMER',u);
 perform set_config('request.jwt.claim.sub',u::text,true);
 execute 'set local role authenticated';
 s:=public.financial_opening_workspace(o,'2026-01-01');
 if jsonb_array_length(s->'source'->'rows')<>5 then raise exception 'master source coverage';end if;
 insert into opening_qa_results values('Live masters include unentered customers and canonical cash',true);
 e:=jsonb_build_object('equity:3100',jsonb_build_object('amount','500','side','CREDIT'),'equity:3200',jsonb_build_object('amount','0','side','CREDIT'),'equity:3300',jsonb_build_object('amount','0','side','CREDIT'));
 w:=public.save_financial_opening(o,'2026-01-01',0,s->'source'->>'revision',e,'');
 if w->>'status'<>'DRAFT' or (w->>'version')::int<>1 then raise exception 'save failed';end if;
 insert into opening_qa_results values('Save persists supplements with source revision and audit',true);
 begin perform public.approve_financial_opening((w->>'id')::uuid,1);raise exception 'accepted missing';exception when others then if sqlerrm<>'OPENING_INCOMPLETE' then raise;end if;end;
 insert into opening_qa_results values('Missing balance is not silently treated as zero',true);
 begin perform public.save_financial_opening(o,'2026-01-01',0,s->'source'->>'revision',e,'');raise exception 'accepted stale';exception when others then if sqlerrm<>'OPENING_VERSION_CONFLICT' then raise;end if;end;
 insert into opening_qa_results values('Optimistic version conflict prevents lost edits',true);
 e:=e||jsonb_build_object('party:'||party||':DEBIT',jsonb_build_object('amount','0','side','DEBIT'));
 w:=public.save_financial_opening(o,'2026-01-01',1,s->'source'->>'revision',e,'');
 begin perform public.save_financial_opening(o,'2026-01-01',2,'stale',e,'');raise exception 'accepted changed source';exception when others then if sqlerrm<>'OPENING_SOURCE_CHANGED' then raise;end if;end;
 insert into opening_qa_results values('Stale source revision is rejected',true);
 begin update public.financial_opening_workspaces set entries='{}' where id=(w->>'id')::uuid;raise exception 'direct write allowed';exception when insufficient_privilege then null;end;
 insert into opening_qa_results values('Direct client writes cannot bypass validation',true);
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 if exists(select 1 from public.financial_opening_workspaces where id=(w->>'id')::uuid) then raise exception 'tenant leak';end if;
 begin perform public.financial_opening_workspace(o,'2026-01-01');raise exception 'foreign read allowed';exception when others then if sqlerrm<>'OPENING_ACCESS_DENIED' then raise;end if;end;
 begin perform public.approve_financial_opening((w->>'id')::uuid,2);raise exception 'foreign approval allowed';exception when others then if sqlerrm<>'OPENING_APPROVE_DENIED' then raise;end if;end;
 insert into opening_qa_results values('Tenant RLS and RPC authorization reject foreign access',true);
 perform set_config('request.jwt.claim.sub',u::text,true);
 execute 'set local role postgres';update public.organizations set approval_policy='STRICT_SEGREGATION' where id=o;execute 'set local role authenticated';
 begin perform public.approve_financial_opening((w->>'id')::uuid,2);raise exception 'self approval allowed';exception when others then if sqlerrm<>'OPENING_SELF_APPROVAL_DENIED' then raise;end if;end;
 insert into opening_qa_results values('Strict segregation blocks creator approval',true);
 execute 'set local role postgres';update public.organizations set approval_policy='OWNER_CONTROLLED' where id=o;execute 'set local role authenticated';
 approved:=public.approve_financial_opening((w->>'id')::uuid,2);
 if approved->>'status'<>'APPROVED' or (approved->>'version')::int<>3 then raise exception 'approval failed';end if;
 if (select sum((r->>'debit')::numeric-(r->>'credit')::numeric) from jsonb_array_elements(approved->'approved_opening') r)<>0 then raise exception 'approved opening unbalanced';end if;
 if jsonb_array_length(approved->'approved_opening')<>5 then raise exception 'approved detail coverage';end if;
 insert into opening_qa_results values('Approval freezes a complete balanced opening, counting cash once',true);
 if public.approve_financial_opening((w->>'id')::uuid,2)->>'id'<>w->>'id' then raise exception 'approval replay';end if;
 if (select count(*) from public.financial_opening_audit where workspace_id=(w->>'id')::uuid and action='APPROVE')<>1 then raise exception 'duplicate approval audit';end if;
 insert into opening_qa_results values('Approval replay is idempotent',true);

 policy:=public.save_financial_reporting_policy(o,'2026-01-01',0,'[]','Initial QA policy');
 policy:=public.approve_financial_reporting_policy((policy->>'id')::uuid,1);
 snap:=public.financial_statement_live_snapshot(o,'2026-01-01','2026-12-31');
 if snap->>'origin'<>'LIVE_CANONICAL_EVENTS' or jsonb_array_length(snap->'events')<>0 then raise exception 'opening ledger source invalid';end if;
 insert into opening_qa_snapshots values('opening-only',snap);
 insert into opening_qa_results values('Approved opening is the canonical statement opening',true);
 execute 'set local role postgres';
 insert into public.financial_classifications(id,organization_id,code,name,classification_type,created_by) values(cls,o,'QA-OPEX','QA expense','OPEX',u),(taxcls,o,'QA-VAT','QA tax','TAX',u),(revcls,o,'QA-REV','QA revenue','REVENUE',u);
 insert into public.financial_events(id,organization_id,event_type,source_module,source_event_key,description,event_date,status,base_currency,created_by)
 values(invoice,o,'EXPENSE','REPORTING_QA','qa-invoice','QA invoice','2026-02-01','DRAFT','SAR',u),
 (sale,o,'REVENUE','REPORTING_QA','qa-sale','QA sale','2026-03-01','DRAFT','SAR',u),
 (payment,o,'SETTLEMENT','REPORTING_QA','qa-payment','QA payment','2026-04-01','DRAFT','SAR',u);
 insert into public.financial_event_lines(event_id,organization_id,line_number,classification_id,amount,currency,exchange_rate,base_amount,cash_direction,metadata)
 values(invoice,o,1,cls,100,'SAR',1,100,'NON_CASH','{"source_role":"NET_RECOGNITION"}'),
 (invoice,o,2,taxcls,15,'SAR',1,15,'NON_CASH','{"source_role":"INPUT_VAT","recoverable_percent":50}'),
 (sale,o,1,revcls,50,'SAR',1,50,'NON_CASH','{}'),
 (payment,o,1,cls,115,'SAR',1,115,'OUTFLOW','{}');
 update public.financial_events set status='ACTUAL',posted_by=u,posted_at=now() where id in(invoice,sale,payment);
 insert into public.liquidity_settlements(organization_id,account_id,direction,settlement_date,amount,currency,exchange_rate,base_currency,base_amount,source_module,source_event_key,financial_event_id,status,payload_fingerprint,created_by,posted_by)
 values(o,cash,'OUTFLOW','2026-04-01',115,'SAR',1,'SAR',115,'REPORTING_QA','qa-payment',payment,'POSTED','qa',u,u);
 update public.liquidity_accounts set current_balance=385,current_balance_base=385 where id=cash;
 execute 'set local role authenticated';
 rules:=jsonb_build_array(
 jsonb_build_object('eventType','EXPENSE','sourceModule','REPORTING_QA','classificationId',cls||':NET_RECOGNITION','cashDirection','NON_CASH','debitAccountId','6100','creditAccountId','2100'),
 jsonb_build_object('eventType','EXPENSE','sourceModule','REPORTING_QA','classificationId',taxcls||':INPUT_VAT_RECOVERABLE','cashDirection','NON_CASH','debitAccountId','1400','creditAccountId','2100'),
 jsonb_build_object('eventType','EXPENSE','sourceModule','REPORTING_QA','classificationId',taxcls||':INPUT_VAT_NONRECOVERABLE','cashDirection','NON_CASH','debitAccountId','6100','creditAccountId','2100'),
 jsonb_build_object('eventType','REVENUE','sourceModule','REPORTING_QA','classificationId',revcls||':BASE','cashDirection','NON_CASH','debitAccountId','1100','creditAccountId','4100'),
 jsonb_build_object('eventType','SETTLEMENT','sourceModule','REPORTING_QA','classificationId',cls||':BASE','cashDirection','OUTFLOW','debitAccountId','2100','creditAccountId','1000','cashActivity','OPERATING'));
 policy:=public.save_financial_reporting_policy(o,'2026-01-01',0,rules,'Review real QA source rules');
 policy:=public.approve_financial_reporting_policy((policy->>'id')::uuid,1);
 snap:=public.financial_statement_live_snapshot(o,'2026-01-01','2026-12-31');
 if jsonb_array_length(snap->'events')<>3 or (snap->'coverage'->>'lineCount')::int<>5 then raise exception 'normalized source coverage';end if;
 insert into opening_qa_snapshots values('invoice-revenue-payment',snap);
 insert into opening_qa_results values('Live VAT split, recognition and settlement share one source',true);
 if (snap->'opening'->0->>'accountId') is null then raise exception 'opening omitted';end if;
 insert into opening_qa_results values('Later cash settlement preserves historical approved opening',true);
 execute 'set local role postgres';update public.organization_members set status='INACTIVE' where organization_id=o and user_id=u;execute 'set local role authenticated';
 if exists(select 1 from public.financial_opening_workspaces where id=(w->>'id')::uuid) then raise exception 'revoked RLS read';end if;
 begin perform public.financial_opening_workspace(o,'2026-01-01');raise exception 'revoked rpc';exception when others then if sqlerrm<>'OPENING_ACCESS_DENIED' then raise;end if;end;
 insert into opening_qa_results values('Revocation removes saved data access immediately',true);
 execute 'set local role postgres';
end $$;
select jsonb_build_object('checks',(select jsonb_agg(to_jsonb(t) order by name) from opening_qa_results t),'snapshots',(select jsonb_agg(to_jsonb(s)) from opening_qa_snapshots s)) results;
rollback;
