import{describe,it,expect}from'vitest';
import snapshot from'./financial-reporting/statement-snapshot.json';
import{normalizeStatementSource,statementSourceExport,statementQuery,statementTreeRows}from'../lib/financial-statement-source';
const fixture=()=>structuredClone(snapshot),query={organization:snapshot.organizationId,from:'2026-01-01',to:'2026-12-31'};
describe('complete canonical statement snapshot',()=>{
 it('reconciles income account children to their period parents without using fiscal balances',()=>{const raw=fixture();raw.from='2026-02-01';const s=normalizeStatementSource(raw,{...query,from:raw.from}),rows=statementTreeRows(s,'income',true);expect(rows.find(r=>r.id==='income-3')?.value).toBe('0.0000');expect(rows.find(r=>r.parentId==='income-3')?.value).toBe('0.0000');expect(s.accounts.find(a=>a.id==='opex')?.balance).toBe('100.0000');expect(s.accounts.find(a=>a.id==='opex')?.periodMovement).toBe('0.0000')});
 it('supplies actual account children for income and position while keeping totals outside groups',()=>{const s=normalizeStatementSource(fixture(),query),income=statementTreeRows(s,'income',true),position=statementTreeRows(s,'position',true);expect(income.find(r=>r.parentId==='income-3')?.value).toBe('-100.0000');expect(income.find(r=>r.id==='income-7')).toMatchObject({value:'100.0000',kind:'total'});expect(income.find(r=>r.id==='income-7')?.parentId).toBeUndefined();expect(position.filter(r=>r.parentId&&r.kind==='detail').length).toBe(8);expect(position.filter(r=>r.kind==='total').every(r=>!r.parentId)).toBe(true)});
 it('promotes the position totals into parents and reuses authoritative subgroup totals when closed',()=>{const s=normalizeStatementSource(fixture(),query),rows=statementTreeRows(s,'position',true);expect(rows[0]).toMatchObject({id:'position-ASSET',value:'630.0000',kind:'total'});const current=rows.find(r=>r.id==='position-ASSET:CURRENT')!;expect(current).toMatchObject({parentId:'position-ASSET',value:'',collapsedValue:'590.0000'});expect(rows.find(r=>r.summaryFor===current.id)).toMatchObject({parentId:current.id,value:'590.0000'});expect(rows.filter(r=>r.id==='position-ASSET')).toHaveLength(1);expect(rows.find(r=>r.id==='position-EQUITY')?.value).toBe('600.0000')});
 it('groups cash details by explicitly mapped activity with original recognition references',()=>{const s=normalizeStatementSource(fixture(),query),rows=statementTreeRows(s,'cash-flow',true);expect(s.cashMovements).toHaveLength(4);expect(rows.filter(r=>r.parentId==='cash-1').map(r=>r.value)).toEqual(['200.0000','-115.0000']);expect(rows.find(r=>r.parentId==='cash-2')?.value).toBe('-40.0000');expect(rows.find(r=>r.parentId==='cash-3')?.value).toBe('30.0000');expect(rows.find(r=>r.parentId==='cash-1')?.label).toContain('Receipts');expect(s.cashMovements[0].reference).toBe('payment')});
 it('exports the complete hierarchy independently of any display collapse state',()=>{const s=normalizeStatementSource(fixture(),query);for(const view of['income','position','cash-flow']as const){const tree=statementTreeRows(s,view,true),exported=statementSourceExport(s,view,true);for(const row of tree)expect(exported).toContainEqual([row.label,row.value])}});
 it('reconciles three statements from a real local SQL-RPC-shaped snapshot',()=>{const r=normalizeStatementSource(fixture(),query);expect(r.statements.income).toMatchObject({revenue:'200.0000',operatingExpenses:'100.0000',netProfit:'100.0000'});expect(r.statements.position).toEqual({assets:'630.0000',liabilities:'30.0000',equity:'600.0000',fiscalProfit:'100.0000'});expect(r.statements.cash).toMatchObject({opening:'500.0000',operating:'85.0000',investing:'-40.0000',financing:'30.0000',movement:'75.0000',closing:'575.0000'});expect(r.lineage).toHaveLength(7)});
 it('keeps selected-period profit separate from fiscal equity and opening cash',()=>{const p=fixture();p.from='2026-02-01';const r=normalizeStatementSource(p,{...query,from:p.from});expect(r.statements.income.netProfit).toBe('0.0000');expect(r.statements.position.fiscalProfit).toBe('100.0000');expect(r.statements.cash.opening).toBe('585.0000');expect(r.statements.cash.movement).toBe('-10.0000');expect(r.cashMonths).toHaveLength(11);expect(r.cashMonths[0]).toEqual({month:'2026-02',movement:'-40.0000',closing:'545.0000'})});
 it('fills genuine empty cash months with zero movement, preserving the balance',()=>{const r=normalizeStatementSource(fixture(),query);expect(r.cashMonths).toHaveLength(12);expect(r.cashMonths[0]).toEqual({month:'2026-01',movement:'85.0000',closing:'585.0000'});expect(r.cashMonths[11]).toEqual({month:'2026-12',movement:'0.0000',closing:'575.0000'});expect(r.accounts.find(a=>a.id==='vat')?.balance).toBe('15.0000')});
 it('rejects truncated events/lines rather than silently publishing partial statements',()=>{let p=fixture();p.events.pop();expect(()=>normalizeStatementSource(p,query)).toThrow('STATEMENT_SOURCE_INCOMPLETE');p=fixture();p.events[0].lines.pop();expect(()=>normalizeStatementSource(p,query)).toThrow('STATEMENT_SOURCE_INCOMPLETE');expect(()=>normalizeStatementSource({...fixture(),coverage:{...snapshot.coverage,complete:false}},query)).toThrow('STATEMENT_SOURCE_INVALID')});
 it('rejects scope/period substitution and unsupported runtime payloads',()=>{expect(()=>normalizeStatementSource(fixture(),{...query,organization:'10000000-0000-4000-8000-000000000004'})).toThrow('SCOPE_MISMATCH');expect(()=>normalizeStatementSource(fixture(),{...query,to:'2026-11-30'})).toThrow('SCOPE_MISMATCH');const p=fixture();(p.events[0].lines[0]as Record<string,unknown>).baseAmount=100;expect(()=>normalizeStatementSource(p,query)).toThrow('STATEMENT_SOURCE_INVALID')});
 it('will not invent a counterentry or tax recoverability mapping',()=>{const p=fixture();p.policy.rules=p.policy.rules.filter(r=>r.id!=='vat');expect(()=>normalizeStatementSource(p,query)).toThrow('POSTING_RULE_REQUIRED')});
 it('exports exact values, scope and source lineage in both languages',()=>{const r=normalizeStatementSource(fixture(),query);for(const en of[false,true])for(const view of['income','position','cash-flow']as const){const rows=statementSourceExport(r,view,en);expect(rows).toContainEqual([en?'Organization':'المؤسسة',query.organization]);expect(rows.flat()).toContain('LOCAL_QA_CANONICAL_EVENTS');expect(rows.flat()).toContain(r.lineage[0].lineId);expect(rows.flat()).not.toContain('NaN');expect(rows.flat()).not.toContain('undefined')}expect(statementSourceExport(r,'income',true)).toContainEqual(['Net profit','100.0000'])});
 it('rejects invalid query dates, unknown dimensions and reversed periods',()=>{for(const bad of[{...query,from:'2026-02-30'},{...query,from:'2027-01-01'},{...query,entity:'unauthorized-subset'},{...query,to:'2029-01-01'}])expect(statementQuery.safeParse(bad).success).toBe(false)});
 it('handles a large mapped recognition set without repeated scans of all rules',()=>{const p=fixture(),template=p.events[0];p.events=Array.from({length:2000},(_,n)=>({...template,id:'event-'+n,sourceKey:'key-'+n,lines:[{...template.lines[0],id:'line-'+n,baseAmount:'1.0000'}]}));p.coverage.eventCount=2000;p.coverage.lineCount=2000;expect(normalizeStatementSource(p,query).statements.income.netProfit).toBe('-2000.0000')});
 it('accepts a verified first-activity company with no opening vouchers and no activity',()=>{
  const p=fixture();
  p.opening=[];p.events=[];p.policy.rules=[];
  p.openingSourceId='FIRST_ACTIVITY:2026-01-01';
  p.coverage.eventCount=0;p.coverage.lineCount=0;
  const result=normalizeStatementSource(p,query);
  expect(result.statements.cash).toMatchObject({opening:'0.0000',movement:'0.0000',closing:'0.0000'});
  expect(result.statements.position).toMatchObject({assets:'0.0000',liabilities:'0.0000',equity:'0.0000'});
  expect(result.statements.income.netProfit).toBe('0.0000');
  expect(result.accounts.every(a=>a.balance==='0.0000')).toBe(true);
 });
 it('recognizes current-year legal-company capital receipts without creating an opening balance or income',()=>{
  const p=fixture();
  p.opening=[];p.openingSourceId='FIRST_ACTIVITY:2026-01-01';
  p.policy.rules=[{...p.policy.rules[0],id:'capital-receipt-rule',eventType:'CAPITAL_RECEIPT',
   classificationId:'capital-receipt',cashDirection:'INFLOW',debitAccountId:'bank',
   creditAccountId:'capital',cashActivity:'FINANCING'}];
  p.events=[{...p.events[0],id:'capital-receipt',sourceKey:'capital-receipt',
   eventType:'CAPITAL_RECEIPT',date:'2026-01-10',lines:[{
    ...p.events[0].lines[0],id:'capital-receipt-line',classificationId:'capital-receipt',
    baseAmount:'100.0000',cashDirection:'INFLOW',recognitionSign:1,
   }]}];
  p.coverage.eventCount=1;p.coverage.lineCount=1;
  const result=normalizeStatementSource(p,query);
  expect(result.statements.cash).toMatchObject({opening:'0.0000',financing:'100.0000',closing:'100.0000'});
  expect(result.statements.position).toMatchObject({assets:'100.0000',equity:'100.0000'});
  expect(result.statements.income).toMatchObject({revenue:'0.0000',netProfit:'0.0000'});
 });
 it('rejects missing opening records unless the canonical source attests first activity',()=>{
  const p=fixture();p.opening=[];p.events=[];p.policy.rules=[];
  p.coverage.eventCount=0;p.coverage.lineCount=0;
  expect(()=>normalizeStatementSource(p,query)).toThrow('STATEMENT_OPENING_PROVENANCE_REQUIRED');
  p.openingSourceId='FIRST_ACTIVITY:2026-02-01';
  expect(()=>normalizeStatementSource(p,query)).toThrow('STATEMENT_OPENING_PROVENANCE_REQUIRED');
  p.openingSourceId='FIRST_ACTIVITY:2026-01-01:UNVERIFIED';
  expect(()=>normalizeStatementSource(p,query)).toThrow('STATEMENT_OPENING_PROVENANCE_REQUIRED');
 });

});
