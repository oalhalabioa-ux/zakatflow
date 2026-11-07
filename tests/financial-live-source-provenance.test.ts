import {describe,it,expect} from 'vitest';
import {assertNormalizedLiveEventProvenance} from '../lib/financial-live-source-provenance';
import type {RecognitionEvent} from '../lib/financial-event-ledger';

const eventId='10000000-0000-4000-8000-000000000001';
const rawId='20000000-0000-4000-8000-000000000002';
const cls='30000000-0000-4000-8000-000000000003';
const refundId='40000000-0000-4000-8000-000000000004';
const canonical=():RecognitionEvent=>({
 id:eventId,organizationId:'50000000-0000-4000-8000-000000000005',currency:'SAR',
 date:'2026-03-01',eventType:'EXPENSE',sourceModule:'VAT',sourceKey:'invoice-1',
 status:'ACTUAL',lines:[{id:rawId+':BASE',classificationId:cls+':BASE',
 baseAmount:'100.0000',cashDirection:'NON_CASH',recognitionSign:1}],
});
const clone=<T>(v:T):T=>structuredClone(v);
const verify=(e:RecognitionEvent[])=>assertNormalizedLiveEventProvenance(e);

describe('production live snapshot source identity integrity',()=>{
 it('accepts canonical posting parts and an empty genuinely first-activity event set',()=>{
  expect(()=>verify([canonical()])).not.toThrow();
  expect(()=>verify([])).not.toThrow();
 });
 it('accepts 100% and partially recoverable VAT source partitions',()=>{
  const c=canonical();
  c.lines=[{...c.lines[0],id:rawId+':INPUT_VAT_RECOVERABLE',
   classificationId:cls+':INPUT_VAT_RECOVERABLE',baseAmount:'60.0000'},
  {...c.lines[0],id:rawId+':INPUT_VAT_NONRECOVERABLE',
   classificationId:cls+':INPUT_VAT_NONRECOVERABLE',baseAmount:'40.0000'}];
  expect(()=>verify([c])).not.toThrow();
  c.lines=[c.lines[0]];
  expect(()=>verify([c])).not.toThrow();
 });
 it('rejects duplicate, invalid or mixed-source partition identities before computing statements',()=>{
  const c=canonical();c.lines.push(clone(c.lines[0]));
  expect(()=>verify([c])).toThrow('REPORTING_SOURCE_PROVENANCE_INVALID');
  c.lines[1].id=rawId+':OTHER';
  c.lines[1].classificationId=cls+':OTHER';
  expect(()=>verify([c])).toThrow('REPORTING_SOURCE_PROVENANCE_INVALID');
  c.lines.pop();c.lines[0].classificationId=cls+':WRONG';
  expect(()=>verify([c])).toThrow('REPORTING_SOURCE_PROVENANCE_INVALID');
 });
 it('supports Production VAT-note refund obligation-derived parts without pretending they are event lines',()=>{
  const c=canonical();
  c.lines.push({id:eventId+':refund:'+refundId,classificationId:'VAT_NOTE_REFUND_CLIENT',
   baseAmount:'25.0000',cashDirection:'NON_CASH',recognitionSign:1});
  expect(()=>verify([c])).not.toThrow();
  c.lines[1].id='99999999-0000-4000-8000-000000000999:refund:'+refundId;
  expect(()=>verify([c])).toThrow('REPORTING_SOURCE_PROVENANCE_INVALID');
 });
 it('accepts legacy liquidity and asset registers but does not treat them as canonical Financial Core events',()=>{
  const flow=canonical();flow.id='flow:'+rawId;flow.sourceModule='LEGACY_CASH';
  flow.sourceKey=rawId;flow.lines=[{...flow.lines[0],id:flow.id,classificationId:'CASH:CASH'}];
  const asset=canonical();asset.id='transaction:'+refundId;asset.sourceModule='LEGACY_ASSET';
  asset.sourceKey=refundId;asset.lines=[{...asset.lines[0],id:asset.id+':BOOK',classificationId:'ASSET:PURCHASE:BASE:BOOK'}];
  expect(()=>verify([flow,asset])).not.toThrow();
  asset.lines[0].id=asset.id+':ILLEGAL';
  expect(()=>verify([flow,asset])).toThrow('REPORTING_SOURCE_PROVENANCE_INVALID');
 });
 it('rejects missing SALE proceeds even when the BOOK cost is present',()=>{
  const sale=canonical();sale.id='transaction:'+refundId;
  sale.sourceModule='LEGACY_ASSET';sale.sourceKey=refundId;
  sale.lines=[{...sale.lines[0],id:sale.id+':BOOK',
   classificationId:'GOLD:SALE:BASE:BOOK',baseAmount:'400.0000'}];
  expect(()=>verify([sale])).toThrow('REPORTING_SOURCE_PROVENANCE_INVALID');
  sale.lines.push({...sale.lines[0],id:sale.id+':PROCEEDS',
   classificationId:'GOLD:SALE:PROCEEDS',baseAmount:'750.0000'});
  expect(()=>verify([sale])).not.toThrow();
  sale.lines.shift(); // A zero-cost disposal may have proceeds only.
  expect(()=>verify([sale])).not.toThrow();
  sale.lines[0].cashDirection='INFLOW';
  expect(()=>verify([sale])).toThrow('REPORTING_SOURCE_PROVENANCE_INVALID');
 });
 it('rejects invented sale components on purchases, wrong reversal signs and malformed cash transfers',()=>{
  const asset=canonical();asset.id='transaction:'+refundId;
  asset.sourceModule='LEGACY_ASSET';asset.sourceKey=refundId;
  asset.lines=[{...asset.lines[0],id:asset.id+':BOOK',
   classificationId:'GOLD:PURCHASE:BASE:BOOK'}];
  expect(()=>verify([asset])).not.toThrow();
  asset.lines.push({...asset.lines[0],id:asset.id+':PROCEEDS',
   classificationId:'GOLD:SALE:PROCEEDS'});
  expect(()=>verify([asset])).toThrow('REPORTING_SOURCE_PROVENANCE_INVALID');
  asset.lines.pop();asset.lines[0].recognitionSign=-1;
  expect(()=>verify([asset])).toThrow('REPORTING_SOURCE_PROVENANCE_INVALID');
  const cash=canonical();cash.id='transfer:'+refundId;
  cash.sourceModule='LEGACY_CASH';cash.sourceKey=refundId;
  cash.lines=[{...cash.lines[0],id:cash.id,
   classificationId:'TRANSFER_DIFFERENCE:CASH',cashDirection:'OUTFLOW'}];
  expect(()=>verify([cash])).not.toThrow();
  cash.lines[0].classificationId='BANK:CASH';
  expect(()=>verify([cash])).toThrow('REPORTING_SOURCE_PROVENANCE_INVALID');
  cash.id='flow:'+refundId;cash.lines[0].id=cash.id;
  expect(()=>verify([cash])).not.toThrow();
  // A standalone cash flow may use a user-defined flow_type with this label.
  // The marker alone does not prove it is an actual transfer.
  cash.lines[0].classificationId='TRANSFER_DIFFERENCE:CASH';
  expect(()=>verify([cash])).not.toThrow();
  cash.lines[0].classificationId='BANK:NO_CASH_SUFFIX';
  expect(()=>verify([cash])).toThrow('REPORTING_SOURCE_PROVENANCE_INVALID');
 });
 it('forbids the same original database recognition line from being reused by another event',()=>{
  const a=canonical(),b=clone(a);
  b.id='60000000-0000-4000-8000-000000000006';
  b.sourceKey='invoice-2';
  b.lines[0].id=rawId+':OTHER';
  b.lines[0].classificationId=cls+':OTHER';
  expect(()=>verify([a,b])).toThrow('REPORTING_SOURCE_PROVENANCE_INVALID');
 });
 it('rejects a source disguised as a legacy record or a duplicate financial event',()=>{
  const x=canonical();x.sourceModule='LEGACY_CASH';
  expect(()=>verify([x])).toThrow('REPORTING_SOURCE_PROVENANCE_INVALID');
  const c=canonical();
  expect(()=>verify([c,clone(c)])).toThrow('REPORTING_SOURCE_PROVENANCE_INVALID');
 });
 it('refuses invalid decimal amounts and cash directions rather than generating zero or NaN balances',()=>{
  const c=canonical();c.lines[0].baseAmount='100.12345';
  expect(()=>verify([c])).toThrow('REPORTING_SOURCE_PROVENANCE_INVALID');
  c.lines[0].baseAmount='100.0000';c.lines[0].cashDirection='INVALID' as 'NON_CASH';
  expect(()=>verify([c])).toThrow('REPORTING_SOURCE_PROVENANCE_INVALID');
 });
});
