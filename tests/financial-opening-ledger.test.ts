import {describe,it,expect} from 'vitest';
import {normalizeStatementSource,statementSourceExport} from '../lib/financial-statement-source';
import evidence from './financial-reporting/qa-live-opening-snapshot.json';
// These envelopes are emitted by actual Financial Core QA PostgreSQL RPCs inside
// a rolled-back fixture transaction, not handwritten event or opening envelopes.
describe('Approved opening → live source → reconciled statements',()=>{
 function snapshot(stage:string){const raw=evidence.snapshots.find(s=>s.stage===stage)!.payload;return normalizeStatementSource(raw,{organization:raw.organizationId,from:raw.from,to:raw.to})}
 it('starts the statements from the approved opening once, without recognizing income',()=>{
  const s=snapshot('opening-only');expect(s.origin).toBe('LIVE_CANONICAL_EVENTS');expect(s.statements.position).toEqual({assets:'500.0000',liabilities:'0.0000',equity:'500.0000',fiscalProfit:'0.0000'});expect(s.statements.cash.opening).toBe('500.0000');expect(s.statements.income.netProfit).toBe('0.0000');expect(s.lineage).toHaveLength(0);
 });
 it('recognizes expense once, splits recoverable VAT, and treats payment as a balance settlement',()=>{
  const s=snapshot('invoice-revenue-payment');expect(s.statements.income.revenue).toBe('50.0000');expect(s.statements.income.operatingExpenses).toBe('107.5000');expect(s.statements.income.netProfit).toBe('-57.5000');expect(s.statements.position).toEqual({assets:'442.5000',liabilities:'0.0000',equity:'442.5000',fiscalProfit:'-57.5000'});expect(s.statements.cash).toEqual({opening:'500.0000',operating:'-115.0000',investing:'0.0000',financing:'0.0000',movement:'-115.0000',closing:'385.0000'});expect(s.accounts.find(a=>a.id==='1400')?.balance).toBe('7.5000');expect(s.lineage).toHaveLength(5);
 });
 it('exports the same live figures and source references in Arabic and English',()=>{
  const s=snapshot('invoice-revenue-payment');for(const en of [false,true]){const rows=statementSourceExport(s,'income',en);expect(rows.some(r=>r[1]==='-57.5000')).toBe(true);expect(rows.flat()).toContain(s.openingSourceId);expect(rows.flat()).not.toContain('Local test data; not organization financial statements')}
 });
 it('cannot project an unapproved policy or an altered unbalanced opening',()=>{
  const raw=structuredClone(evidence.snapshots[1].payload);raw.policy.approvedBy='';expect(()=>normalizeStatementSource(raw,{organization:raw.organizationId,from:raw.from,to:raw.to})).toThrow('STATEMENT_SOURCE_INVALID');
  const bad=structuredClone(evidence.snapshots[1].payload);bad.opening[0].debit='999';expect(()=>normalizeStatementSource(bad,{organization:bad.organizationId,from:bad.from,to:bad.to})).toThrow('OPENING_TRIAL_BALANCE_UNBALANCED');
 });
});
