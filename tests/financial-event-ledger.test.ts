import{describe,it,expect}from'vitest';
import{compileEventLedger,type EventLedgerInput,type RecognitionEvent,type PostingRule}from'../lib/financial-event-ledger';
function event(id:string,type:string,amount:string,classification=type,cashDirection:'NON_CASH'|'OUTFLOW'|'INFLOW'='NON_CASH'):RecognitionEvent{return{id,organizationId:'a',currency:'SAR',date:'2026-01-02',eventType:type,sourceModule:'core',sourceKey:id,status:'ACTUAL',lines:[{id:id+'-line',classificationId:classification,baseAmount:amount,cashDirection,recognitionSign:1}]}}
function fixture():EventLedgerInput{
 const rules:PostingRule[]=[['expense','EXPENSE','opex','payable','NON_CASH'],['vat','EXPENSE','vat','payable','NON_CASH'],['settlement','SETTLEMENT','payable','bank','OUTFLOW'],['sale','REVENUE','receivable','revenue','NON_CASH'],['collection','SETTLEMENT','bank','receivable','INFLOW']].map(([id,eventType,debitAccountId,creditAccountId,cashDirection])=>({id,eventType,debitAccountId,creditAccountId,cashDirection:cashDirection as PostingRule['cashDirection'],organizationId:'a',currency:'SAR',sourceModule:'core',classificationId:id,from:'2026-01-01',to:'2026-12-31',cashActivity:'OPERATING'}));
 const expense=event('invoice','EXPENSE','100','expense');expense.lines.push({id:'tax-line',classificationId:'vat',baseAmount:'15',cashDirection:'NON_CASH',recognitionSign:1});
 return{organizationId:'a',currency:'SAR',openingDate:'2025-12-31',fiscalStart:'2026-01-01',from:'2026-01-01',to:'2026-12-31',openingSourceId:'canonical-opening-2026',accounts:[['bank','ASSET'],['vat','ASSET'],['receivable','ASSET'],['payable','LIABILITY'],['capital','EQUITY'],['opex','OPEX'],['revenue','REVENUE']].map(([id,kind])=>({id,kind:kind as EventLedgerInput['accounts'][number]['kind'],organizationId:'a',currency:'SAR',cash:id==='bank'})),opening:[{accountId:'bank',debit:'500',credit:'0'},{accountId:'capital',debit:'0',credit:'500'}],policy:{id:'approved-policy-v1',organizationId:'a',currency:'SAR',approvedBy:'policy-owner',approvedAt:'2026-01-01T00:00:00Z',rules},events:[expense,event('payment','SETTLEMENT','115','settlement','OUTFLOW'),event('sale','REVENUE','200','sale'),event('receipt','SETTLEMENT','200','collection','INFLOW')]};
}
describe('explicit canonical-event ledger compiler',()=>{
 it('projects a new organization subaccount posting without changing cash, profit or position totals',()=>{
  const baseline=compileEventLedger(fixture());
  const source=fixture();
  source.accounts.push({id:'610001',kind:'OPEX',organizationId:'a',currency:'SAR'},{id:'100001',kind:'ASSET',cash:true,organizationId:'a',currency:'SAR'});
  source.policy.rules.find(r=>r.id==='expense')!.debitAccountId='610001';
  source.policy.rules.find(r=>r.id==='settlement')!.creditAccountId='100001';
  const projected=compileEventLedger(source);
  expect(projected.statements).toEqual(baseline.statements);
  expect(projected.source.journals.find(j=>j.id==='invoice')?.lines[0].accountId).toBe('610001');
  expect(projected.source.journals.find(j=>j.id==='payment')?.lines[1].accountId).toBe('100001');
  expect(projected.source.opening).toEqual(source.opening);
  expect(projected.lineage).toEqual(baseline.lineage);
 });
 it('keeps expense 100, recoverable VAT 15 and gross payment 115 distinct with one journal source',()=>{const r=compileEventLedger(fixture());expect(r.statements.income).toMatchObject({revenue:'200.0000',operatingExpenses:'100.0000',netProfit:'100.0000'});expect(r.statements.cash).toMatchObject({opening:'500.0000',operating:'85.0000',closing:'585.0000'});expect(r.statements.position).toMatchObject({assets:'600.0000',liabilities:'0.0000',equity:'600.0000'});expect(r.lineage).toHaveLength(5);expect(r.source.journals).toHaveLength(4)});
 it('does not mutate sources or regenerate amounts independently of journals',()=>{const s=fixture(),before=JSON.stringify(s),r=compileEventLedger(s);expect(JSON.stringify(s)).toBe(before);expect(r.lineage[0]).toEqual({journalId:'invoice',eventId:'invoice',lineId:'invoice-line',ruleId:'expense'});expect(r.policyId).toBe(s.policy.id);expect(r.openingSourceId).toBe(s.openingSourceId)});
 it('requires approved mapping and opening provenance and a balanced opening',()=>{let s=fixture();s.policy.approvedBy='';expect(()=>compileEventLedger(s)).toThrow('APPROVED_POSTING_POLICY_REQUIRED');s=fixture();s.openingSourceId='';expect(()=>compileEventLedger(s)).toThrow('OPENING_SOURCE_REQUIRED');s=fixture();s.opening[0].debit='499';expect(()=>compileEventLedger(s)).toThrow('OPENING_TRIAL_BALANCE_UNBALANCED')});
 it('rejects missing and overlapping mappings without a fallback account',()=>{let s=fixture();s.policy.rules.shift();expect(()=>compileEventLedger(s)).toThrow('POSTING_RULE_REQUIRED');s=fixture();s.policy.rules.push({...s.policy.rules[0],id:'overlap'});expect(()=>compileEventLedger(s)).toThrow('AMBIGUOUS_POSTING_RULE')});
 it('rejects organization/currency mixing in rows, policy, rules and accounts',()=>{for(const target of ['event','policy','rule','account','currency']){const s=fixture();if(target==='event')s.events[0].organizationId='b';if(target==='policy')s.policy.organizationId='b';if(target==='rule')s.policy.rules[0].organizationId='b';if(target==='account')s.accounts[0].organizationId='b';if(target==='currency')s.events[0].currency='USD';expect(()=>compileEventLedger(s)).toThrow('LEDGER_SCOPE_MISMATCH')}});
 it('rejects duplicate canonical identity and duplicate lines',()=>{for(const target of ['id','key','line']){const s=fixture(),copy=structuredClone(s.events[0]);copy.id=target==='id'?copy.id:'copy';copy.sourceKey=target==='key'?copy.sourceKey:'copy';copy.lines=target==='line'?copy.lines:copy.lines.map(l=>({...l,id:l.id+'-copy'}));s.events.push(copy);expect(()=>compileEventLedger(s)).toThrow(target==='id'?'DUPLICATE_SOURCE_EVENT':target==='key'?'DUPLICATE_SOURCE_KEY':'DUPLICATE_SOURCE_LINE')}});
 it('excludes planned/committed events and future recognition',()=>{const s=fixture();s.events[0].status='COMMITTED';s.events[1].status='PLANNED';s.events[2].date='2027-01-01';expect(compileEventLedger(s).statements.income.netProfit).toBe('0.0000')});
 it('requires explicit cash classification and correct debit/credit direction',()=>{let s=fixture();delete s.policy.rules[2].cashActivity;expect(()=>compileEventLedger(s)).toThrow('CASH_ACTIVITY_MAPPING_REQUIRED');s=fixture();[s.policy.rules[2].debitAccountId,s.policy.rules[2].creditAccountId]=['bank','payable'];expect(()=>compileEventLedger(s)).toThrow('POSTING_CASH_DIRECTION_MISMATCH')});
 it('preserves original recognition until the reversal date and reverses exactly once',()=>{const s=fixture(),original=s.events[0];original.status='REVERSED';const reverse=structuredClone(original);reverse.id='reversal';reverse.sourceKey='reversal';reverse.status='ACTUAL';reverse.date='2026-02-01';reverse.reversesEventId=original.id;reverse.lines=reverse.lines.map(l=>({...l,id:l.id+'-reverse',recognitionSign:-1}));s.events.push(reverse);s.to='2026-01-31';expect(compileEventLedger(s).statements.income.operatingExpenses).toBe('100.0000');s.to='2026-12-31';expect(compileEventLedger(s).statements.income.operatingExpenses).toBe('0.0000');reverse.lines[0].baseAmount='99';expect(()=>compileEventLedger(s)).toThrow('REVERSAL_DOES_NOT_MATCH_SOURCE');reverse.lines[0].baseAmount='100';const duplicate=structuredClone(reverse);duplicate.id='duplicate';duplicate.sourceKey='duplicate';duplicate.lines=duplicate.lines.map(l=>({...l,id:l.id+'-dup'}));s.events.push(duplicate);expect(()=>compileEventLedger(s)).toThrow('INVALID_REVERSAL_SOURCE')});
 it('blocks missing original and incomplete reversal evidence',()=>{let s=fixture();s.events[0].status='REVERSED';expect(()=>compileEventLedger(s)).toThrow('REVERSAL_EVENT_REQUIRED');s=fixture();s.events[0].reversesEventId='missing';expect(()=>compileEventLedger(s)).toThrow('INVALID_REVERSAL_SOURCE')});
 it('keeps internal cash transfers out of cash-flow movement',()=>{const s=fixture();s.accounts.push({id:'bank2',kind:'ASSET',cash:true,organizationId:'a',currency:'SAR'});s.policy.rules.push({...s.policy.rules[2],id:'transfer',eventType:'TRANSFER',classificationId:'transfer',debitAccountId:'bank2',creditAccountId:'bank',cashActivity:undefined});s.events.push(event('transfer','TRANSFER','50','transfer','OUTFLOW'));expect(compileEventLedger(s).statements.cash.movement).toBe('85.0000')});
 it('uses effective dated rules and refuses unknown or same-side accounts',()=>{let s=fixture();s.policy.rules[0].from='2026-02-01';expect(()=>compileEventLedger(s)).toThrow('POSTING_RULE_REQUIRED');s=fixture();s.policy.rules[0].creditAccountId='unknown';expect(()=>compileEventLedger(s)).toThrow('INVALID_POSTING_ACCOUNTS');s=fixture();s.policy.rules[0].creditAccountId=s.policy.rules[0].debitAccountId;expect(()=>compileEventLedger(s)).toThrow('INVALID_POSTING_ACCOUNTS')});
 it('retains four decimals and rejects unsafe amounts/signs',()=>{const s=fixture();s.events[2].lines[0].baseAmount='200.0001';expect(compileEventLedger(s).statements.income.netProfit).toBe('100.0001');for(const n of ['NaN','-1','1e3','0','0.00001']){const x=fixture();x.events[0].lines[0].baseAmount=n;expect(()=>compileEventLedger(x)).toThrow('INVALID_RECOGNITION_AMOUNT')}});
 it('fails closed when an actual cash-funded debt contract is still sourced as non-cash',()=>{
  // Canonical create_debt_contract() currently creates ADJUSTMENT / DEBT_CONTRACTS
  // with cash_direction=NON_CASH, even for mode=NEW funded by a bank settlement.
  // Never silently treat that source as a complete investing/financing cash journal.
  const s=fixture();
  s.events=[event('loan','ADJUSTMENT','100','loan-principal','NON_CASH')];
  s.events[0].sourceModule='DEBT_CONTRACTS';
  s.accounts.push({id:'loan-receivable',kind:'ASSET',organizationId:'a',currency:'SAR'});
  s.policy.rules=[{id:'debt-funding',organizationId:'a',currency:'SAR',from:'2026-01-01',to:'2026-12-31',
   eventType:'ADJUSTMENT',sourceModule:'DEBT_CONTRACTS',classificationId:'loan-principal',
   cashDirection:'NON_CASH',debitAccountId:'loan-receivable',creditAccountId:'bank',cashActivity:'INVESTING'}];
  expect(()=>compileEventLedger(s)).toThrow('POSTING_CASH_DIRECTION_MISMATCH');
 });
 it('reconciles investment, loan receivable and borrowing in institutional detail accounts without duplicate cash',()=>{
  const s=fixture();s.events=[];s.policy.rules=[];
  s.accounts.push(
   {id:'160001',kind:'ASSET',organizationId:'a',currency:'SAR'},
   {id:'120001',kind:'ASSET',organizationId:'a',currency:'SAR'},
   {id:'220001',kind:'LIABILITY',organizationId:'a',currency:'SAR'},
  );
  const dated={organizationId:'a',currency:'SAR',sourceModule:'core',from:'2026-01-01',to:'2026-12-31'};
  s.policy.rules.push(
   {...dated,id:'buy-investment',eventType:'ASSET_PURCHASE',classificationId:'investment',cashDirection:'OUTFLOW',debitAccountId:'160001',creditAccountId:'bank',cashActivity:'INVESTING'},
   {...dated,id:'lend',eventType:'ADJUSTMENT',classificationId:'loan-issued',cashDirection:'OUTFLOW',debitAccountId:'120001',creditAccountId:'bank',cashActivity:'INVESTING'},
   {...dated,id:'borrow',eventType:'LIABILITY',classificationId:'borrowing',cashDirection:'INFLOW',debitAccountId:'bank',creditAccountId:'220001',cashActivity:'FINANCING'},
  );
  s.events.push(event('investment','ASSET_PURCHASE','250','investment','OUTFLOW'));
  s.events.push(event('loan','ADJUSTMENT','200','loan-issued','OUTFLOW'));
  s.events.push(event('funding','LIABILITY','300','borrowing','INFLOW'));
  const r=compileEventLedger(s);
  expect(r.source.journals).toHaveLength(3);
  expect(r.lineage).toHaveLength(3);
  expect(r.source.journals.map(j=>j.lines[0].accountId)).toEqual(['160001','120001','bank']);
  expect(r.statements.cash).toMatchObject({opening:'500.0000',investing:'-450.0000',financing:'300.0000',closing:'350.0000'});
  expect(r.statements.position).toMatchObject({assets:'800.0000',liabilities:'300.0000',equity:'500.0000'});
  expect(r.statements.income.netProfit).toBe('0.0000');
 });

});
