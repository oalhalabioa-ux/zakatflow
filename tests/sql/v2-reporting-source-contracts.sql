-- Full-schema CI only. Use synthetic native V2 commands and roll everything back.
begin;
set constraints all immediate;
create temporary table source_contract_proof(result jsonb);
grant insert on source_contract_proof to authenticated;
do $fixture$
declare
 actor uuid:=gen_random_uuid(); stranger uuid:=gen_random_uuid(); org uuid:=gen_random_uuid();
 bank uuid:=gen_random_uuid(); party uuid:=gen_random_uuid(); gain_class uuid:=gen_random_uuid(); bank_personal uuid;
 as_of date:='2026-03-31'; debt_event uuid; obligation uuid; adjustment uuid; adj_line uuid; reversal uuid;
 debt jsonb; source jsonb; terms jsonb; ws jsonb; pol jsonb; entries jsonb; rules jsonb; line jsonb; raw jsonb;
 fx public.organization_reporting_fx_policies%rowtype; binding public.financial_fx_revaluation_evidence%rowtype;
 classified public.personal_income_expense_documents%rowtype; deposit uuid; unlabeled uuid; payable uuid; receivable uuid;
 rec jsonb; before_fx jsonb; after_fx jsonb; debt_class uuid; payment jsonb; personal_raw jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at) values
 (actor,actor||'@sources.invalid',now()),(stranger,stranger||'@sources.invalid',now());
 perform set_config('request.jwt.claim.sub',actor::text,true);
 insert into public.organizations(id,owner_user_id,name,base_currency) values(org,actor,'Synthetic Work 03 sources','SAR');
 insert into public.organization_members(organization_id,user_id,role,status)
  values(org,actor,'OWNER','ACTIVE') on conflict do nothing;
 insert into public.liquidity_accounts(id,organization_id,name,account_type,currency,current_balance,current_balance_base,created_by,metadata)
 values(bank,org,'Fixture bank','BANK','USD',1000,3750,actor,'{"opening_date":"2026-01-01","opening_balance":1000,"opening_fx_rate":3.75}');
 insert into public.liquidity_counterparties(id,organization_id,name,party_type,created_by)
 values(party,org,'Fixture borrower','BOTH',actor);
 insert into public.financial_classifications(id,organization_id,code,name,classification_type,created_by)
 values(gain_class,org,'TEST_FX_REMEASUREMENT','Synthetic FX gain','REVENUE',actor);
 insert into public.fx_rates(organization_id,from_currency,to_currency,valuation_date,rate,source)
 values(org,'USD','SAR','2026-03-31',3.9,'Synthetic approved feed'),
       (org,'USD','SAR','2026-04-30',9,'Synthetic approved feed'),
       (org,'USD','SAR','2026-03-31',4.2,'Unapproved source'),
       (org,'SAR','USD','2026-02-28',0.25,'Synthetic inverse');
 set local role authenticated;
 perform public.save_financial_fiscal_calendar(org,1,1,'3300',0,'Synthetic schedule');
 perform public.save_financial_chart_account(org,'120001','1200','قرض الاختبار','Fixture foreign loan','DEBIT',true,true,0,'Synthetic debt leaf');
 perform public.save_financial_chart_account(org,'410001','4100','فرق صرف الاختبار','Fixture FX gain','CREDIT',true,true,0,'Synthetic FX leaf');
 perform public.link_financial_cash_accounts(org);
 perform public.assign_financial_opening_source(org,'liquidity_accounts',bank,'2026-01-01','2026-01-01','1000',3750,'Verified bank opening');
 ws:=public.financial_opening_workspace(org,'2026-01-01');
 select coalesce(jsonb_object_agg(row->>'id',jsonb_build_object('amount','0','side',row->>'normal')),'{}'::jsonb)
 into entries from jsonb_array_elements(ws->'source'->'rows') row where jsonb_array_length(row->'vouchers')=0;
 entries:=jsonb_set(entries,'{equity:3100}','{"amount":"3750","side":"CREDIT"}');
 ws:=public.save_financial_opening(org,'2026-01-01',0,ws->'source'->>'revision',entries,'Synthetic balancing capital');
 perform public.approve_financial_opening((ws->>'id')::uuid,(ws->>'version')::int);

 debt:=public.create_debt_contract(jsonb_build_object('organization_id',org,'request_id',gen_random_uuid(),'kind','LOAN','mode','NEW','side','RECEIVABLE',
 'counterparty_id',party,'entity_id',null,'account_id',bank,'category','O_AR_LOAN','description','Synthetic foreign loan','reference','QA-USD',
 'date','2026-02-10','currency','USD','exchange_rate',3.75,'principal',100,
 'schedule',jsonb_build_array(jsonb_build_object('amount',100,'due_date','2026-12-01'))));
 debt_event:=(debt->>'eventId')::uuid;
 select id into strict obligation from public.financial_event_obligations where event_id=debt_event;
 select classification_id into strict debt_class from public.financial_event_lines where event_id=debt_event;
 rules:=jsonb_build_array(
  jsonb_build_object('eventType','ADJUSTMENT','sourceModule','DEBT_CONTRACTS',
    'classificationId',debt_class::text||':DEBT_FUNDED_O_AR_LOAN','cashDirection','OUTFLOW',
    'debitAccountId','120001','creditAccountId','1000','cashActivity','INVESTING','detailed',true),
  jsonb_build_object('eventType','ADJUSTMENT','sourceModule','FX_REVALUATION',
    'classificationId',gain_class::text||':BASE','cashDirection','NON_CASH','debitAccountId','120001','creditAccountId','410001','detailed',true));
 pol:=public.save_financial_reporting_policy(org,'2026-01-01',0,rules,'Synthetic loan and FX routing');
 perform public.approve_financial_reporting_policy((pol->>'id')::uuid,(pol->>'version')::integer);
 perform public.approve_financial_event(debt_event,'Approve synthetic loan');
 perform public.post_debt_contract((debt->>'id')::uuid);

 fx:=public.approve_organization_reporting_fx_policy(org,'USD','SAR','CLOSING','2026-01-01','2026-12-31',
  'Synthetic approved feed','ORGANIZATION','EXACT_DATE',false,'Synthetic policy approval');
 if (public.approve_organization_reporting_fx_policy(org,'USD','SAR','CLOSING','2026-01-01','2026-12-31',
  'Synthetic approved feed','ORGANIZATION','EXACT_DATE',false,'Synthetic policy approval')).id<>fx.id then
  raise exception 'FX policy replay duplicated'; end if;
 perform public.approve_organization_reporting_fx_policy(org,'USD','SAR','TRANSACTION','2026-01-01','2026-12-31',
  'Synthetic inverse','ORGANIZATION','LATEST_ON_OR_BEFORE',true,'Synthetic inverse policy');
 rec:=public.resolve_organization_reporting_fx(org,'USD','SAR','TRANSACTION',as_of);
 if (rec->>'rate')::numeric<>4 or rec->>'quoteDate'<>'2026-02-28' then raise exception 'FX inverse not resolved'; end if;
 begin
  perform public.resolve_organization_reporting_fx(org,'USD','SAR','CLOSING','2026-03-30');
  raise exception 'Unapproved FX fallback accepted';
 exception when others then if sqlerrm<>'REPORTING_FX_QUOTE_MISSING' then raise;end if;end;
 rec:=public.resolve_organization_reporting_fx(org,'USD','SAR','CLOSING',as_of);
 if (rec->>'rate')::numeric<>3.9 or rec->'policy'->>'approved_by'<>actor::text then raise exception 'FX approval provenance invalid';end if;

 line:=jsonb_build_object('line_number',1,'classification_id',gain_class,'amount',15,'currency','SAR',
   'exchange_rate',1,'base_amount',15,'cash_direction','NON_CASH','vat_treatment','OUT_OF_SCOPE','vat_amount',0,'vat_rate',0);
 terms:=jsonb_build_object('organization_id',org,'event_type','ADJUSTMENT','source_module','FX_REVALUATION',
  'source_event_key','synthetic-fx-test','event_date',as_of,'base_currency','SAR','description','Revalue 100 USD from 375 to 390 SAR',
  'lines',jsonb_build_array(line),'obligations','[]'::jsonb,
  'links',jsonb_build_array(jsonb_build_object('link_type','OTHER','target_module','financial_event_obligations','target_record_id',obligation)));
 adjustment:=public.create_financial_event_command(terms);
 perform public.transition_financial_event(adjustment,'PLANNED','Synthetic FX');
 perform public.transition_financial_event(adjustment,'COMMITTED','Synthetic FX');
 perform public.approve_financial_event(adjustment,'Synthetic FX');
 perform public.transition_financial_event(adjustment,'ACTUAL','Post synthetic FX');
 select id into strict adj_line from public.financial_event_lines where event_id=adjustment;
 binding:=public.bind_financial_fx_revaluation(org,adjustment,adj_line,obligation,as_of,'120001');
 if binding.document_id<>(debt->>'id')::uuid or binding.document_module<>'debt_contracts'
   or binding.posted_base_amount<>15 or binding.debt_side<>'DEBIT' or binding.offset_account_id<>'410001'
  then raise exception 'Revaluation binding missing exact ledger provenance'; end if;

 reversal:=public.create_financial_event_command(terms||jsonb_build_object('event_type','REVERSAL','source_event_key','synthetic-fx-reversal',
   'event_date','2026-04-01','links',jsonb_build_array(jsonb_build_object('link_type','REVERSAL_OF','related_event_id',adjustment))));
 perform public.transition_financial_event(reversal,'PLANNED','Synthetic FX reversal');
 perform public.transition_financial_event(reversal,'COMMITTED','Synthetic FX reversal');
 perform public.approve_financial_event(reversal,'Synthetic FX reversal');
 perform public.transition_financial_event(reversal,'ACTUAL','Synthetic FX reversal');
 perform public.transition_financial_event(adjustment,'REVERSED','Synthetic FX reversal');
 before_fx:=public.read_financial_fx_revaluation(org,adjustment,as_of);
 after_fx:=public.read_financial_fx_revaluation(org,adjustment,'2026-04-01');
 if before_fx->'reversal'<>'null'::jsonb or after_fx->'reversal'->>'journalId' is distinct from reversal::text
   or after_fx->'reversal'->>'debtAccountId'<>'120001' or after_fx->'reversal'->>'debtSide'<>'CREDIT'
   or after_fx->'evidence'->'quote_evidence'->>'rate' is distinct from rec->>'rate' then
  raise exception 'Revaluation cutoff or exact reversal mismatch'; end if;
 raw:=public.financial_statement_live_snapshot(org,'2026-01-01','2026-04-01');
 if not exists(select 1 from jsonb_array_elements(raw->'events') e where e->>'id'=reversal::text
   and e->>'reversesEventId'=adjustment::text and e->'lines'->0->>'baseAmount'='15.0000')
  then raise exception 'Reversal absent in V2 trial source'; end if;

 perform set_config('request.jwt.claim.sub',stranger::text,true);
 begin
  perform public.resolve_organization_reporting_fx(org,'USD','SAR','CLOSING',as_of);
  raise exception 'Outside organization read accepted';
 exception when others then if sqlerrm<>'REPORTING_FX_POLICY_DENIED' then raise;end if;end;
 if exists(select 1 from public.financial_fx_revaluation_evidence where organization_id=org) then
  raise exception 'Outside organization evidence visible';end if;
 perform set_config('request.jwt.claim.sub',actor::text,true);

 bank_personal:=(public.create_asset_with_acquisition('{"name":"Synthetic personal funding","asset_type":"BANK","currency":"SAR","metadata":{"quantity":200,"purchase_value":200,"purchase_date":"2026-01-01","acquisition_mode":"OPENING_BALANCE"}}',gen_random_uuid())->>'id')::uuid;
 receivable:=(public.create_asset_with_acquisition('{"name":"Synthetic receivable","asset_type":"RECEIVABLE","currency":"SAR","metadata":{"quantity":80,"purchase_value":80,"purchase_date":"2026-01-01","acquisition_mode":"OPENING_BALANCE"}}',gen_random_uuid())->>'id')::uuid;
 -- Same plain cash input the personal transaction service posts. Only one document is explicitly classified.
 insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value,created_by)
 values(actor,bank_personal,'ADD','2026-03-05',25,'SAR',25,'SAR',25,actor) returning id into deposit;
 insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value,created_by)
 values(actor,bank_personal,'ADD','2026-03-06',28,'SAR',28,'SAR',28,actor) returning id into unlabeled;
 classified:=public.classify_personal_income_expense(deposit,'INCOME','SERVICE_INCOME','Synthetic classified receipt');
 if (select count(*) from public.read_personal_income_expense('2026-03-01',as_of))<>1 then
  raise exception 'General movement implicitly classified';end if;
 perform public.reverse_transaction(actor,deposit);
 if not exists(select 1 from public.read_personal_income_expense(current_date,current_date)
   where document_id=classified.id and is_reversal and base_amount::numeric=-25) then raise exception 'Classified reversal lost';end if;
 if (select count(*) from public.read_personal_income_expense('2026-03-01',as_of))<>1 then
  raise exception 'Reversal changed earlier period';end if;
 payable:=(public.personal_payable_command(jsonb_build_object('action','CREATE','request_id',gen_random_uuid(),'party','Synthetic creditor',
  'description','Synthetic payable','amount',70,'date','2026-02-10','due_date','2026-12-31','reference','QA-PAYABLE'))->>'id')::uuid;
 payment:=public.personal_payable_command(jsonb_build_object('action','PAY','request_id',gen_random_uuid(),'payable_id',payable,
  'account_id',bank_personal,'amount',20,'date','2026-04-01','notes','Synthetic payment'));
 personal_raw:=public.read_personal_debts_at_cutoff(as_of);
 if not exists(select 1 from jsonb_array_elements(personal_raw->'rows') r where r->>'id'=payable::text and (r->>'balance')::numeric=70)
  or not exists(select 1 from jsonb_array_elements(personal_raw->'rows') r where r->>'id'=receivable::text and (r->>'balance')::numeric=80)
  or not exists(select 1 from jsonb_array_elements(public.read_personal_debts_at_cutoff('2026-04-01')->'rows') r
    where r->>'id'=payable::text and (r->>'balance')::numeric=50) then
  raise exception 'Personal cutoff includes a later payment or misses a verified receivable';end if;
 perform set_config('request.jwt.claim.sub',stranger::text,true);
 if exists(select 1 from public.read_personal_income_expense('2026-01-01',current_date))
  or jsonb_array_length(public.read_personal_debts_at_cutoff(as_of)->'rows')<>0 then raise exception 'Personal source escaped owner scope';end if;

 insert into source_contract_proof values(jsonb_build_object(
  'revaluation',jsonb_build_object('journal',adjustment,'line',adj_line,'document',debt->>'id','obligation',obligation,
    'account',binding.debt_account_id,'cutoff',as_of,'oldBase',375,'newBase',390,'adjustment',15,'reversedOn','2026-04-01',
    'reversal',reversal,'earlierReadUnchanged',true),
  'fxPolicy',jsonb_build_object('organization',org,'pair','USD/SAR','selected',3.9,'source','Synthetic approved feed','basis','EXACT_DATE','inverseTransaction',4),
  'personal',jsonb_build_object('explicitIncome',25,'unclassifiedCash',28,'reversal',-25,
    'payableAtCutoff',70,'payableAfterPayment',50,'receivableAtCutoff',80,'coverage','PARTIAL'),
  'foreignTenantDenied',true));
end $fixture$;
reset role;
select result from source_contract_proof;
rollback;
