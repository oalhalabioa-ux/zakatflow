begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','f10bd630-6e35-4513-a9b3-4908d1b00c3c',true);
do $test$
declare org uuid:='85acbac0-e8b4-434c-a22b-3ec13b55e1a7';asset jsonb;snap jsonb;i jsonb;aid uuid;zeroid uuid;f jsonb;reason text;
begin
 asset:=public.create_asset_with_acquisition(jsonb_build_object('asset_type','OTHER','name','QA corporate fixed asset rollback','currency','SAR','unit','unit','is_zakatable',false,'ownership_scope','ORGANIZATION','organization_id',org,'entity_id','d3c2ef65-d8b4-4ac9-9267-d91c9dfc4cbe','asset_class_code','PPE','asset_type_code','IT_EQUIPMENT','metadata','{"acquisition_mode":"OPENING_BALANCE","quantity":1,"purchase_value":100,"purchase_date":"2026-10-23","vat_amount":0,"recoverable_percent":100,"fx_rate":1}'::jsonb),gen_random_uuid());
 snap:=public.capture_corporate_zakat_sources(org,'SAUDI','2026-10-23','2026-10-01');
 if not exists(select 1 from jsonb_array_elements(snap->'entries') x where x->>'id'=asset->>'id' and x->>'field'='fixed_assets' and (x->>'value')::numeric=100) then raise exception 'SAUDI_ASSET_FIELD_NOT_MAPPED';end if;
 i:=jsonb_build_object('model','SAUDI','organization_id',org,'title','QA Saudi review','assessment_date','2026-10-23','currency','SAR','values','{"equity":2000,"liabilities":0,"book_profit":0,"adjusted_profit":0,"fixed_assets":1000,"deductible_investments":0,"other_deductions":0}'::jsonb,'debt_policy','NONE','method_reference','Reviewed regulation','nisab_value',null,'nisab_reference','','hawl_completed',false,'period_basis','HIJRI','period_start','2026-10-01','period_end',null,'hijri_days',354,'notes','','independent_source_confirmed',true,'source_snapshot_id',snap->>'id');
 insert into public.manual_zakat_assessments(user_id,organization_id,request_id,model,title,assessment_date,currency,status,input,result) values(auth.uid(),org,gen_random_uuid(),'SAUDI','QA Saudi review','2026-10-23','SAR','REGULATORY_REVIEW',i,'{"source":"MANUAL","draft_only":true}') returning id into aid;
 begin perform public.corporate_zakat_command('PREPARE',aid,'{"period_start":"2026-10-01","review_reference":"QA regulatory review","review_confirmed":true,"final_base":1000,"final_rate":0.027}');reason:='NOT_BLOCKED';exception when others then reason:=SQLERRM;end;
 if reason<>'CORPORATE_ZAKAT_REGULATORY_REVIEW_REQUIRED' then raise exception 'SAUDI_REVIEW_NOT_REQUIRED:%',reason;end if;
 f:=public.corporate_zakat_command('PREPARE',aid,'{"period_start":"2026-10-01","review_reference":"QA regulatory review","review_confirmed":true,"regulatory_confirmed":true,"final_base":1000,"final_rate":0.027}');
 if (f->>'amount')::numeric<>27 then raise exception 'SAUDI_REVIEWED_AMOUNT_WRONG';end if;
 perform public.corporate_zakat_command('APPROVE',aid);perform public.corporate_zakat_command('POST',aid);
 if (select settleable_base_amount from public.financial_event_obligations where id=(f->>'obligation_id')::uuid)<>27 then raise exception 'SAUDI_OBLIGATION_WRONG';end if;
 -- A zero result is approved without creating fake expense/cash rows.
 i:=(i-'source_snapshot_id')||'{"assessment_date":"2026-09-30","period_start":"2026-09-01"}';
 insert into public.manual_zakat_assessments(user_id,organization_id,request_id,model,title,assessment_date,currency,status,input,result) values(auth.uid(),org,gen_random_uuid(),'SAUDI','QA zero','2026-09-30','SAR','REGULATORY_REVIEW',i,'{"source":"MANUAL","draft_only":true}') returning id into zeroid;
 f:=public.corporate_zakat_command('PREPARE',zeroid,'{"period_start":"2026-09-01","review_reference":"QA zero regulatory review","review_confirmed":true,"regulatory_confirmed":true,"final_base":0,"final_rate":0.025}');
 if (f->>'amount')::numeric<>0 or f->>'financial_event_id' is not null then raise exception 'ZERO_CREATED_FINANCIAL_EVENT';end if;
 perform public.corporate_zakat_command('APPROVE',zeroid);perform public.corporate_zakat_command('APPROVE',zeroid);
 if (select approved_at from public.corporate_zakat_finalizations where assessment_id=zeroid) is null then raise exception 'ZERO_NOT_APPROVED';end if;
 -- Cancelling a pending assessment removes only its forecast, retaining history.
 i:=(i-'source_snapshot_id')||'{"assessment_date":"2026-06-30","period_start":"2026-06-01"}';
 insert into public.manual_zakat_assessments(user_id,organization_id,request_id,model,title,assessment_date,currency,status,input,result) values(auth.uid(),org,gen_random_uuid(),'SAUDI','QA cancellation','2026-06-30','SAR','REGULATORY_REVIEW',i,'{"source":"MANUAL","draft_only":true}') returning id into aid;
 f:=public.corporate_zakat_command('PREPARE',aid,'{"period_start":"2026-06-01","review_reference":"QA cancellation review","review_confirmed":true,"regulatory_confirmed":true,"final_base":1000,"final_rate":0.025}');
 perform public.corporate_zakat_command('CANCEL',aid);
 if (select status from public.financial_events where id=(f->>'financial_event_id')::uuid)<>'CANCELLED' or exists(select 1 from public.liquidity_flows where id=(f->>'flow_id')::uuid) then raise exception 'CANCEL_FORECAST_WRONG';end if;
 if not exists(select 1 from public.corporate_zakat_finalizations where assessment_id=aid and flow_id is null) then raise exception 'CANCEL_AUDIT_LOST';end if;
 begin perform public.create_financial_event_command(jsonb_build_object('organization_id',org,'source_module','ZAKAT_ASSESSMENT','source_record_id',aid,'source_event_key','injected','event_type','EXPENSE','lines','[]'::jsonb));reason:='NOT_BLOCKED';exception when others then reason:=SQLERRM;end;
 if reason<>'CORPORATE_ZAKAT_SOURCE_NAMESPACE_RESERVED' then raise exception 'DIRECT_SOURCE_NOT_RESERVED:%',reason;end if;
 perform set_config('qa.corporate_zakat_saudi.result','{"fixed_asset_mapping":true,"regulatory_review_required":true,"reviewed_amount":true,"saudi_obligation":true,"zero_approval":true,"zero_replay":true,"namespace_guard":true,"cancel_forecast":true,"rollback":true}',true);
end $test$;
select current_setting('qa.corporate_zakat_saudi.result')::jsonb test_result;
rollback;
