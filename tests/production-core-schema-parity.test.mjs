import test from 'node:test';
import assert from 'node:assert/strict';
import {compareInventories,FORMAT} from '../scripts/financial-reports/compare-production-core-schema.mjs';
const row=(category,key,fingerprint='0'.repeat(32))=>({category,key,fingerprint});
const inv=objects=>({format:FORMAT,objects,serverVersion:'17.6'});
test('same operational structures pass irrespective of ordering',()=>{
 const r=compareInventories(
  inv([row('migration','20261105150000'),row('relation','public.financial_events')]),
  inv([row('relation','public.financial_events'),row('migration','20261105150000')]));
 assert.equal(r.status,'SCHEMA_PARITY_MATCH');
});
test('missing production write guard, changed report RPC and QA extra index block',()=>{
 const name='public.financial_statement_live_snapshot(p_org uuid,p_from date,p_to date)';
 const a=inv([row('trigger','public.financial_events.subscription_write_guard'),row('function',name),row('migration','v1')]);
 const b=inv([row('function',name,'1'.repeat(32)),row('migration','v1'),row('index','public.financial_events.qa_only')]);
 const r=compareInventories(a,b);
 assert.equal(r.status,'BLOCKED');
 assert.equal(r.counts.missing.trigger,1);
 assert.equal(r.counts.different.function,1);
 assert.equal(r.counts.coreOnly.index,1);
});
test('ancillary historical backups and QA legacy scopes do not hide subscription gaps',()=>{
 const a=inv([row('relation','private_budget_backups.old'),row('function','subscription_private.assert_writable(p_org uuid)')]);
 const b=inv([row('relation','qa_legacy.qa_invoice_review_scopes')]);
 const r=compareInventories(a,b);
 assert.equal(r.counts.missing.function,1);
 assert.equal(r.counts.missing.relation??0,0);
 assert.equal(r.counts.coreOnly.relation??0,0);
});
test('fail closed on malformed or duplicate inventory entries',()=>{
 assert.throws(()=>compareInventories({},inv([])),/SCHEMA_PARITY_INPUT_INVALID/);
 assert.throws(()=>compareInventories(inv([row('relation','public.dup'),row('relation','public.dup')]),inv([])),/SCHEMA_PARITY_DUPLICATE_OBJECT/);
 assert.throws(()=>compareInventories(inv([row('function','public.bad','zz')]),inv([])),/SCHEMA_PARITY_RECORD_INVALID/);
});
