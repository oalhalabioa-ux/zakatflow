import {expect,it} from 'vitest';
import fixture from './financial-reporting/statement-snapshot.json';
import {branchFixture} from './financial-reporting/branch-report-fixture';
import {compileBranchReport} from '../lib/financial-branch-report';
import {normalizeStatementSource} from '../lib/financial-statement-source';
import {statementHubExport} from '../lib/financial-statement-summary';

it('reconciles a later period to statement balances and retains gross journal debits and credits',()=>{
 const raw={...structuredClone(fixture),from:'2026-02-01'};
 const query={organization:raw.organizationId,from:raw.from,to:raw.to};
 expect(normalizeStatementSource(raw,query)).not.toHaveProperty('periodLedger');
 const snapshot=normalizeStatementSource(raw,query,true);
 const ledger=snapshot.periodLedger!;
 expect(ledger.totals.openingDebit).toBe(ledger.totals.openingCredit);
 expect(ledger.totals.periodDebit).toBe(ledger.totals.periodCredit);
 expect(ledger.totals.closingDebit).toBe(ledger.totals.closingCredit);
 const bank=ledger.accounts.find(row=>row.id==='bank')!;
 expect(bank).toMatchObject({
  opening:'585.0000',closing:'575.0000',periodDebit:'30.0000',periodCredit:'40.0000',
 });
 expect(bank.entries.map(entry=>[entry.debit,entry.credit,entry.balance])).toEqual([
  ['0.0000','40.0000','545.0000'],['30.0000','0.0000','575.0000'],
 ]);
 expect(statementHubExport(snapshot,'trial-balance',true)).toContainEqual([
  '', 'Total', ...Object.values(ledger.totals),
 ]);
 const exportRows=statementHubExport(snapshot,'general-ledger',false,undefined,'bank');
 expect(exportRows).toContainEqual(['رصيد أول الفترة',snapshot.statements.cash.opening]);
 expect(exportRows).toContainEqual(['رصيد آخر الفترة',snapshot.statements.cash.closing]);
 expect(exportRows.filter(row=>row.length===7).slice(1)).toHaveLength(bank.entries.length);
});

it('keeps an original movement before the reversal date and shows the linked reversal after it posts',()=>{
 const raw=structuredClone(fixture);
 const source=raw.events.find(event=>event.sourceKey==='invoice')!;
 raw.events.push({
  ...source,id:'test-adjustment',sourceKey:'test-adjustment',status:'REVERSED',date:'2026-11-01',
  lines:[{...source.lines[0],id:'test-adjustment-line',baseAmount:'25'}],
 },{
  ...source,id:'test-reversal',sourceKey:'test-reversal',status:'ACTUAL',date:'2026-12-01',reversesEventId:'test-adjustment',
  lines:[{...source.lines[0],id:'test-reversal-line',baseAmount:'25',recognitionSign:-1}],
 } as typeof source);
 raw.coverage.eventCount+=2;
 raw.coverage.lineCount+=2;
 const query={organization:raw.organizationId,from:raw.from,to:raw.to};
 const until='2026-11-30';
 const before=normalizeStatementSource({...raw,to:until},{...query,to:until},true);
 const after=normalizeStatementSource(raw,query,true);
 expect(before.periodLedger?.accounts.find(row=>row.id==='opex')).toMatchObject({closing:'125.0000',periodCredit:'0.0000'});
 expect(after.periodLedger?.accounts.find(row=>row.id==='opex')).toMatchObject({
  closing:'100.0000',periodDebit:'125.0000',periodCredit:'25.0000',
 });
 expect(after.periodLedger?.accounts.find(row=>row.id==='opex')?.entries.at(-1)).toMatchObject({
  journalId:'test-reversal',reversesJournalId:'test-adjustment',balance:'100.0000',
 });
});

it('exports an independently reconciled ledger for the selected branch and preserves the headquarters boundary',()=>{
 const raw=branchFixture(),q={organization:raw.source.organizationId,from:raw.source.from,to:raw.source.to};
 const branch='20000000-0000-4000-8000-000000000002';
 const selected=compileBranchReport(raw,q,branch,true),hq=compileBranchReport(raw,q,null,true);
 const bankId=raw.source.accounts.find(account=>account.cash)?.id;
 expect(selected.periodLedger?.accounts.find(row=>row.id===bankId)).toMatchObject({opening:'300.0000',closing:'185.0000'});
 const ids=new Set(selected.statements.sourceJournalIds);
 const branchRows=selected.periodLedger?.accounts.flatMap(account=>account.entries)??[];
 expect(branchRows.length).toBeGreaterThan(0);
 expect(branchRows.every(row=>ids.has(row.journalId)&&!hq.statements.sourceJournalIds.includes(row.journalId))).toBe(true);
 expect(statementHubExport(selected,'trial-balance',true)).toContainEqual(['Branch',branch]);
 expect(statementHubExport(hq,'trial-balance',true)).toContainEqual(['Branch','Headquarters']);
});
