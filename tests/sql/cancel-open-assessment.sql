-- QA-only rollback test. The fixture profile and method already exist in QA.
begin;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
set local role authenticated;
do $$
declare uid uuid:=auth.uid();mid uuid;cid uuid:=gen_random_uuid();aid uuid:=gen_random_uuid();oldid uuid:=gen_random_uuid();otherid uuid:=gen_random_uuid();paidid uuid:=gen_random_uuid();historicalid uuid:=gen_random_uuid();result jsonb;snap jsonb;blocked boolean;
begin
 select id into mid from public.zakat_methods limit 1;
 insert into public.zakat_hawl_cycles(id,user_id,cycle_no,nisab_standard,nisab_reached_date,hawl_start_date,hawl_due_date,status)
 values(cid,uid,99001,'SILVER','2026-03-06','2026-03-06','2027-02-24','OPEN');
 insert into public.zakat_assessments(id,user_id,assessment_date,valuation_date,method_id,nisab_standard,nisab_quantity,nisab_value_base,zakat_rate,currency,status,hawl_cycle_id,calculation_snapshot)
 select x,uid,'2026-10-11','2026-10-11',mid,'SILVER',595,5000,.025,'SAR','CALCULATED',cid,'{"schemaVersion":2,"candidateLots":1,"prices":{"gold":500,"silver":7}}'::jsonb from unnest(array[aid,oldid,paidid,historicalid]) x;
 update public.zakat_assessments set superseded_by=aid where id=oldid;
 update public.zakat_hawl_cycles set assessment_id=aid where id=cid;
 insert into public.zakat_assessment_lines(assessment_id,quantity,valuation_price,valuation_currency,market_value,eligible_value,zakat_amount,eligibility_status,explanation,valuation_snapshot)
 values(aid,10,500,'SAR',5000,5000,125,'ELIGIBLE','QA snapshot','{"valuationDate":"2026-10-11"}');
 select calculation_snapshot into snap from public.zakat_assessments where id=aid;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 blocked:=false;begin perform public.cancel_open_zakat_assessment(aid);exception when others then if sqlerrm<>'ASSESSMENT_NOT_FOUND' then raise;end if;blocked:=true;end;
 if not blocked then raise exception 'QA_CROSS_USER_NOT_REJECTED';end if;
 perform set_config('request.jwt.claim.sub','',true);
 blocked:=false;begin perform public.cancel_open_zakat_assessment(aid);exception when others then if sqlerrm<>'UNAUTHORIZED' then raise;end if;blocked:=true;end;
 if not blocked then raise exception 'QA_UNAUTHENTICATED_NOT_REJECTED';end if;
 perform set_config('request.jwt.claim.sub',uid::text,true);
 result:=public.cancel_open_zakat_assessment(oldid);
 if (select assessment_id from public.zakat_hawl_cycles where id=cid) is distinct from aid then raise exception 'QA_OLD_CANCEL_CHANGED_CURRENT';end if;
 result:=public.cancel_open_zakat_assessment(aid);
 if (result->>'requires_recalculation')::boolean is distinct from true or (select assessment_id from public.zakat_hawl_cycles where id=cid) is not null then raise exception 'QA_CURRENT_NOT_CLEARED';end if;
 if (select calculation_snapshot from public.zakat_assessments where id=aid) is distinct from snap or (select valuation_price from public.zakat_assessment_lines where assessment_id=aid)<>500 then raise exception 'QA_SNAPSHOT_CHANGED';end if;
 if (select status::text from public.zakat_assessments where id=aid)<>'CANCELLED' then raise exception 'QA_NOT_CANCELLED';end if;
 result:=public.cancel_open_zakat_assessment(aid);
 if (result->>'already_cancelled')::boolean is distinct from true then raise exception 'QA_NOT_IDEMPOTENT';end if;
 insert into public.zakat_payments(user_id,assessment_id,hawl_cycle_id,payment_date,amount,currency,base_amount) values(uid,paidid,cid,'2026-10-11',1,'SAR',1);
 blocked:=false;begin perform public.cancel_open_zakat_assessment(paidid);exception when others then if sqlerrm<>'ASSESSMENT_PROTECTED' then raise;end if;blocked:=true;end;
 if not blocked then raise exception 'QA_PAYMENT_NOT_PROTECTED';end if;
 blocked:=false;begin perform public.cancel_open_zakat_assessment(otherid);exception when others then if sqlerrm<>'ASSESSMENT_NOT_FOUND' then raise;end if;blocked:=true;end;
 if not blocked then raise exception 'QA_UNKNOWN_NOT_REJECTED';end if;
 update public.zakat_hawl_cycles set assessment_id=paidid,final_assessment_id=paidid,final_zakat_due=0,status='CLOSED' where id=cid;
 result:=public.cancel_open_zakat_assessment(historicalid);
 if (select status::text from public.zakat_assessments where id=historicalid)<>'CANCELLED' then raise exception 'QA_CLOSED_PREVIEW_NOT_CANCELLED';end if;
 if (select final_assessment_id from public.zakat_hawl_cycles where id=cid) is distinct from paidid or (select final_zakat_due from public.zakat_hawl_cycles where id=cid)<>0 then raise exception 'QA_FINAL_CHANGED';end if;
 blocked:=false;begin update public.zakat_assessments set zakat_due=99 where id=historicalid;exception when others then if sqlerrm<>'ASSESSMENT_SNAPSHOT_LOCKED' then raise;end if;blocked:=true;end;
 if not blocked then raise exception 'QA_CLOSED_PREVIEW_VALUE_NOT_PROTECTED';end if;
 blocked:=false;begin perform public.cancel_open_zakat_assessment(paidid);exception when others then if sqlerrm<>'ASSESSMENT_PROTECTED' then raise;end if;blocked:=true;end;
 if not blocked then raise exception 'QA_FINAL_NOT_PROTECTED';end if;
end $$;
select 'PASS: previous/current cancellation, snapshot retention, idempotency, unused closed previews, payment/final/current protection, cross-user and unauthenticated rejection' result;
rollback;
