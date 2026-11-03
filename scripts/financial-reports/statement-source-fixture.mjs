// DISPOSABLE LOCAL FIXTURE ONLY. Not a migration or an approved customer policy.
// Reuses the canonical event tables from source-fixture.mjs; no stored journals/totals.
export const STATEMENT_ORG='10000000-0000-4000-8000-000000000003',STATEMENT_OTHER='10000000-0000-4000-8000-000000000004';
export function statementSchema(){return `
create table public.financial_statement_qa_configuration(organization_id uuid primary key references public.organizations(id),payload jsonb not null);
alter table public.financial_statement_qa_configuration enable row level security;
create policy statement_configuration_read on public.financial_statement_qa_configuration for select to authenticated using(public.financial_core_can(organization_id,'financial_core.view'));
create table public.financial_event_links(id uuid primary key,organization_id uuid,event_id uuid,link_type text,related_event_id uuid);
alter table public.financial_event_links enable row level security;
create policy statement_links_read on public.financial_event_links for select to authenticated using(public.financial_core_can(organization_id,'financial_core.view'));
alter table public.financial_events enable row level security;
create policy statement_events_read on public.financial_events for select to authenticated using(public.financial_core_can(organization_id,'financial_core.view'));
alter table public.financial_event_lines enable row level security;
create policy statement_lines_read on public.financial_event_lines for select to authenticated using(exists(select 1 from public.financial_events e where e.id=event_id));
revoke all on public.financial_statement_qa_configuration,public.financial_event_links,public.financial_events,public.financial_event_lines from public,anon,authenticated;
grant select on public.financial_statement_qa_configuration,public.financial_event_links,public.financial_events,public.financial_event_lines to authenticated;
create function public.financial_statement_qa_context() returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('organizationId',c.organization_id,'name',o.name,'currency',o.base_currency,'fiscalStart',c.payload->>'fiscalStart','fiscalEnd',c.payload->>'fiscalEnd') order by o.name),'[]'::jsonb)
 from public.financial_statement_qa_configuration c join public.organizations o on o.id=c.organization_id where auth.uid() is not null and public.financial_core_can(c.organization_id,'financial_core.view')
$$;
create function public.financial_statement_qa_snapshot(p_org uuid,p_from date,p_to date) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare config jsonb; result jsonb;
begin
 if auth.uid() is null or not public.financial_core_can(p_org,'financial_core.view') then raise exception 'STATEMENT_READ_DENIED';end if;
 select payload into config from public.financial_statement_qa_configuration where organization_id=p_org;
 if config is null then raise exception 'STATEMENT_CONFIGURATION_REQUIRED';end if;
 if p_from is null or p_to is null or p_from>p_to or p_from<(config->>'fiscalStart')::date or p_to>(config->>'fiscalEnd')::date then raise exception 'STATEMENT_PERIOD_INVALID';end if;
 -- One SQL statement observes configuration, events, lines, links and counts in the
 -- same MVCC snapshot. No paginated/limited result is mistaken for a complete ledger.
 with event_rows as materialized(
  select e.* from public.financial_events e where e.organization_id=p_org and e.event_date>=(config->>'fiscalStart')::date and e.status in('ACTUAL','REVERSED')
 ), line_rows as materialized(select l.* from public.financial_event_lines l join event_rows e on e.id=l.event_id),
 event_payload as(
  select e.event_date,e.id,jsonb_strip_nulls(jsonb_build_object('id',e.id,'organizationId',e.organization_id,'currency',e.base_currency,'date',e.event_date,'eventType',e.event_type,'sourceModule',e.source_module,'sourceKey',e.source_event_key,'status',e.status,
   'reversesEventId',(select case when count(*)=1 then min(l.related_event_id::text) when count(*)>1 then 'AMBIGUOUS_REVERSAL' else null end from public.financial_event_links l where l.organization_id=p_org and l.event_id=e.id and l.link_type='REVERSAL_OF'),
   'lines',(select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'classificationId',l.classification_id,'baseAmount',l.base_amount::text,'cashDirection',l.cash_direction,'recognitionSign',coalesce(l.metadata->'recognition_sign','1'::jsonb)) order by l.id),'[]'::jsonb) from line_rows l where l.event_id=e.id))) body from event_rows e
 ) select config-'fiscalEnd'||jsonb_build_object('origin','LOCAL_QA_CANONICAL_EVENTS','organizationId',p_org,'from',p_from,'to',p_to,'events',(select coalesce(jsonb_agg(body order by event_date,id),'[]'::jsonb) from event_payload),'coverage',jsonb_build_object('complete',true,'scope','ORGANIZATION_ALL_ENTITIES','eventCount',(select count(*) from event_rows),'lineCount',(select count(*) from line_rows),'readAt',to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) into result;
 if (result->'coverage'->>'eventCount')::int>10000 or (result->'coverage'->>'lineCount')::int>20000 then raise exception 'STATEMENT_SOURCE_TOO_LARGE';end if;
 return result;
end$$;
revoke all on function public.financial_statement_qa_context(),public.financial_statement_qa_snapshot(uuid,date,date) from public,anon,authenticated;
grant execute on function public.financial_statement_qa_context(),public.financial_statement_qa_snapshot(uuid,date,date) to authenticated;
notify pgrst,'reload schema';
`}
const uuid=n=>'a0000000-0000-4000-8000-'+String(n).padStart(12,'0');
export function statementConfiguration(org,owner){
 const accounts=[['bank','ASSET','البنك','Bank','CURRENT'],['vat','ASSET','ضريبة مدخلات قابلة للاسترداد','Recoverable input VAT','CURRENT'],['receivable','ASSET','الذمم المدينة','Trade receivables','CURRENT'],['equipment','ASSET','معدات','Equipment','NON_CURRENT'],['payable','LIABILITY','الذمم الدائنة','Trade payables','CURRENT'],['debt','LIABILITY','تمويل طويل الأجل','Long-term financing','NON_CURRENT'],['capital','EQUITY','رأس المال','Capital','OTHER'],['revenue','REVENUE','الإيرادات','Revenue','OTHER'],['opex','OPEX','المصروفات التشغيلية','Operating expenses','OTHER']].map(([id,kind,ar,en,presentation])=>({id,kind,ar,en,presentation,organizationId:org,currency:'SAR',cash:id==='bank'}));
 const rules=[['expense','EXPENSE',1,'opex','payable','NON_CASH'],['vat','EXPENSE',2,'vat','payable','NON_CASH'],['payment','SETTLEMENT',1,'payable','bank','OUTFLOW','OPERATING'],['sale','REVENUE',3,'receivable','revenue','NON_CASH'],['receipt','SETTLEMENT',3,'bank','receivable','INFLOW','OPERATING'],['equipment','ASSET_PURCHASE',4,'equipment','bank','OUTFLOW','INVESTING'],['financing','LIABILITY',5,'bank','debt','INFLOW','FINANCING']].map(([id,eventType,c,debitAccountId,creditAccountId,cashDirection,cashActivity])=>({id,eventType,classificationId:uuid(c),debitAccountId,creditAccountId,cashDirection,...(cashActivity?{cashActivity}:{}),organizationId:org,currency:'SAR',sourceModule:'STATEMENT_QA',from:'2026-01-01',to:'2026-12-31'}));
 return{currency:'SAR',openingDate:'2025-12-31',fiscalStart:'2026-01-01',fiscalEnd:'2026-12-31',openingSourceId:'LOCAL-FIXTURE-OPENING-'+org,accounts,opening:[{accountId:'bank',debit:'500.0000',credit:'0.0000'},{accountId:'capital',debit:'0.0000',credit:'500.0000'}],policy:{id:'LOCAL-FIXTURE-POLICY-'+org,organizationId:org,currency:'SAR',approvedBy:owner,approvedAt:'2026-01-01T00:00:00Z',rules}};
}
export function seedStatementSource(a,b,viewer){for(const id of[a,b,viewer])if(!/^[a-f0-9-]{36}$/.test(id))throw Error('TEST_ACTOR_ID_INVALID');
 const config=(org,owner)=>JSON.stringify(statementConfiguration(org,owner)).replaceAll("'","''");
 const events=[['invoice','EXPENSE','2026-01-15',1,100,'NON_CASH'],['payment','SETTLEMENT','2026-01-16',1,115,'OUTFLOW'],['sale','REVENUE','2026-01-17',3,200,'NON_CASH'],['receipt','SETTLEMENT','2026-01-18',3,200,'INFLOW'],['equipment','ASSET_PURCHASE','2026-02-01',4,40,'OUTFLOW'],['financing','LIABILITY','2026-03-01',5,30,'INFLOW']];
 let sql=`insert into public.organizations values('${STATEMENT_ORG}','Local statement institution A','SAR'),('${STATEMENT_OTHER}','Local statement institution B','SAR');
insert into public.organization_members values('${STATEMENT_ORG}','${a}','ACTIVE',false,true),('${STATEMENT_OTHER}','${b}','ACTIVE',false,true),('${STATEMENT_ORG}','${viewer}','ACTIVE',false,false);
insert into public.financial_statement_qa_configuration values('${STATEMENT_ORG}','${config(STATEMENT_ORG,a)}'::jsonb),('${STATEMENT_OTHER}','${config(STATEMENT_OTHER,b)}'::jsonb);
insert into public.financial_classifications values${[1,2,3,4,5].map((n)=>`('${uuid(n)}','${['OPEX','TAX','REVENUE','ASSET','FINANCING'][n-1]}')`).join(',')};\n`;
 for(const[org,offset]of[[STATEMENT_ORG,100],[STATEMENT_OTHER,200]])for(let i=0;i<events.length;i++){const[name,type,date,c,amount,direction]=events[i],eventId=uuid(offset+i),n=org===STATEMENT_OTHER&&name==='sale'?7000:amount;
  sql+=`insert into public.financial_events values('${eventId}','${org}',null,'${date}','ACTUAL','${type}','STATEMENT_QA',null,'${name}','SAR');\ninsert into public.financial_event_lines values('${uuid(offset+1000+i)}','${eventId}','${uuid(c)}',null,'SAR',1,${n},'{}','${direction}');\n`;
  if(i===0)sql+=`insert into public.financial_event_lines values('${uuid(offset+2000)}','${eventId}','${uuid(2)}',null,'SAR',1,15,'{}','NON_CASH');\n`;
 }
 return sql;
}
