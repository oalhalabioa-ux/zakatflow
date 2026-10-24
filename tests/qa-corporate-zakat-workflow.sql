-- Financial Core QA only. All fixtures and cash changes are rolled back.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','f10bd630-6e35-4513-a9b3-4908d1b00c3c',true);
do $test$
declare org uuid:='85acbac0-e8b4-434c-a22b-3ec13b55e1a7';aid uuid;otherid uuid;bank uuid;settlement uuid;classid uuid;cmd jsonb;snap jsonb;f jsonb;i jsonb;payment jsonb;reason text;paid numeric;cash numeric;res jsonb;
begin
 insert into public.liquidity_accounts(organization_id,name,account_type,currency,current_balance,current_balance_base,metadata) values(org,'QA corporate zakat rollback bank','BANK','SAR',10000,10000,'{"opening_date":"2026-01-01"}') returning id into bank;
 snap:=public.capture_corporate_zakat_sources(org,'SIMPLE','2026-10-23',null);
 if not exists(select 1 from jsonb_array_elements(snap->'entries') x where x->>'id'=bank::text and (x->>'value')::numeric=10000) then raise exception 'SOURCE_BANK_NOT_MAPPED';end if;
 i:=jsonb_build_object('model','SIMPLE','organization_id',org,'title','QA annual Zakat','assessment_date','2026-10-23','currency','SAR','values','{"cash":100000,"debtors":0,"inventory":0,"investments":0,"other":0,"due_debts":0}'::jsonb,'debt_policy','NONE','method_reference','Reviewed method','nisab_value',30000,'nisab_reference','Reviewed saved price','hawl_completed',true,'period_basis','HIJRI','period_start',null,'period_end',null,'hijri_days',354,'notes','','independent_source_confirmed',true,'source_snapshot_id',snap->>'id');
 insert into public.manual_zakat_assessments(user_id,organization_id,request_id,model,title,assessment_date,currency,status,input,result) values(auth.uid(),org,gen_random_uuid(),'SIMPLE','QA annual Zakat','2026-10-23','SAR','DRAFT',i,'{"source":"MANUAL","draft_only":true}') returning id into aid;
 cmd:='{"period_start":"2026-01-01","review_reference":"QA reviewed supporting documents","review_confirmed":true}';
 perform set_config('request.jwt.claim.sub','8ec4c7f9-83b4-4307-9d5e-de7590fa121b',true);
 begin perform public.corporate_zakat_command('PREPARE',aid,cmd);reason:='NOT_BLOCKED';exception when others then reason:=SQLERRM;end;
 if reason not in('CORPORATE_ZAKAT_ACCESS_DENIED','CORPORATE_ZAKAT_CREATE_DENIED') then raise exception 'VIEWER_WRITE_NOT_BLOCKED:%',reason;end if;
 perform set_config('request.jwt.claim.sub','f10bd630-6e35-4513-a9b3-4908d1b00c3c',true);
 f:=public.corporate_zakat_command('PREPARE',aid,cmd);
 if (f->>'amount')::numeric<>2500 then raise exception 'WRONG_DUE';end if;
 if (select current_balance from public.liquidity_accounts where id=bank)<>10000 then raise exception 'PREPARE_POSTED_CASH';end if;
 begin perform public.corporate_zakat_command('PREPARE',aid,cmd);reason:='NOT_BLOCKED';exception when others then reason:=SQLERRM;end;
 if reason<>'CORPORATE_ZAKAT_ALREADY_PREPARED' then raise exception 'DUPLICATE_ASSESSMENT_NOT_BLOCKED:%',reason;end if;
 insert into public.manual_zakat_assessments(user_id,organization_id,request_id,model,title,assessment_date,currency,status,input,result) values(auth.uid(),org,gen_random_uuid(),'SIMPLE','QA duplicate period','2026-10-23','SAR','DRAFT',i,'{"source":"MANUAL","draft_only":true}') returning id into otherid;
 begin perform public.corporate_zakat_command('PREPARE',otherid,cmd);reason:='NOT_BLOCKED';exception when others then reason:=SQLERRM;end;
 if reason<>'CORPORATE_ZAKAT_PERIOD_ALREADY_EXISTS' then raise exception 'DUPLICATE_PERIOD_NOT_BLOCKED:%',reason;end if;
 begin perform public.corporate_zakat_command('POST',aid);reason:='NOT_BLOCKED';exception when others then reason:=SQLERRM;end;
 if reason<>'VALID_APPROVAL_REQUIRED' then raise exception 'UNAPPROVED_POST_NOT_BLOCKED:%',reason;end if;
 perform public.corporate_zakat_command('APPROVE',aid);perform public.corporate_zakat_command('POST',aid);perform public.corporate_zakat_command('POST',aid);
 if (select count(*) from public.financial_event_obligations where id=(f->>'obligation_id')::uuid)<>1 then raise exception 'DUPLICATE_OBLIGATION';end if;
 select id into classid from public.financial_classifications where organization_id=org and classification_type='PAYABLE' and active limit 1;
 -- Two real settlements through the existing atomic cash posting path.
 foreach paid in array array[1000::numeric,1500::numeric] loop
  settlement:=public.create_financial_event_command(jsonb_build_object('organization_id',org,'event_type','SETTLEMENT','source_module','OPERATIONAL_CONSOLE','source_event_key','qa-corp-zakat:'||aid||':'||paid,'event_date','2026-10-23','base_currency','SAR','description','QA Zakat payment','lines',jsonb_build_array(jsonb_build_object('line_number',1,'classification_id',classid,'amount',paid,'currency','SAR','exchange_rate',1,'base_amount',paid,'cash_direction','OUTFLOW','vat_treatment','OUT_OF_SCOPE','vat_rate',0,'vat_amount',0))));
  perform public.transition_financial_event(settlement,'PLANNED','QA');perform public.transition_financial_event(settlement,'COMMITTED','QA');perform public.approve_financial_event(settlement,'QA');
  payment:=jsonb_build_array(jsonb_build_object('obligation_id',f->>'obligation_id','flow_id',f->>'flow_id','amount',paid,'base_amount',paid,'flow_amount',paid,'flow_currency','SAR','flow_exchange_rate',1));
  perform public.post_financial_settlement(settlement,bank,'OUTFLOW','2026-10-23',paid,'SAR',1,paid,payment);
  perform public.post_financial_settlement(settlement,bank,'OUTFLOW','2026-10-23',paid,'SAR',1,paid,payment);
  select to_jsonb(w) into res from public.corporate_zakat_workflow w where assessment_id=aid;
  if paid=1000 and ((res->>'paid')::numeric<>1000 or (res->>'remaining')::numeric<>1500) then raise exception 'PARTIAL_SETTLEMENT_WRONG';end if;
 end loop;
 select current_balance into cash from public.liquidity_accounts where id=bank;
 if cash<>7500 or (res->>'remaining')::numeric<>0 or (res->>'paid')::numeric<>2500 then raise exception 'FULL_SETTLEMENT_WRONG';end if;
 if (select sum(l.base_amount) from public.financial_event_lines l join public.financial_events e on e.id=l.event_id where e.source_module='ZAKAT_ASSESSMENT' and e.source_record_id=aid)<>2500 then raise exception 'DOUBLE_EXPENSE';end if;
 perform set_config('qa.corporate_zakat.result','{"source_mapping":true,"permission_guard":true,"duplicate_assessment":true,"duplicate_period":true,"approval_required":true,"single_obligation":true,"partial_payment":true,"full_payment":true,"cash_replay":true,"no_double_expense":true,"rollback":true}',true);
end $test$;
select current_setting('qa.corporate_zakat.result')::jsonb test_result;
rollback;
