import {describe,it,expect} from 'vitest';
import {matchesStatementRequest} from '../lib/financial-statement-request';
import {normalizeStatementSource,type StatementSourceSnapshot} from '../lib/financial-statement-source';
import evidence from './financial-reporting/qa-live-opening-snapshot.json';
const raw=evidence.snapshots[0].payload;
const snapshot=normalizeStatementSource(raw,{organization:raw.organizationId,from:raw.from,to:raw.to});
const request={organization:raw.organizationId,from:raw.from,to:raw.to,currency:raw.currency,origin:snapshot.origin};
describe('banner selection report identity',()=>{
 it('accepts the exact company, period, currency and source',()=>{
  expect(matchesStatementRequest(snapshot,request)).toBe(true);
 });
 it.each(['organization','from','to','currency'] as const)('rejects stale %s before display or export',key=>{
  expect(matchesStatementRequest(snapshot,{...request,[key]:'different'})).toBe(false);
 });
 it('rejects a branch, group or personal result under company-wide selection',()=>{
  for(const scope of ['BRANCH','GROUP_WITH_SUBSIDIARIES','PERSONAL'])
   expect(matchesStatementRequest({...snapshot,scope} as unknown as StatementSourceSnapshot,request)).toBe(false);
 });
 it('rejects test data in a live report and missing selection',()=>{
  expect(matchesStatementRequest({...snapshot,origin:'LOCAL_QA_CANONICAL_EVENTS'},{...request,origin:'LIVE_CANONICAL_EVENTS'})).toBe(false);
  expect(matchesStatementRequest(null,request)).toBe(false);
  expect(matchesStatementRequest(snapshot,{...request,currency:''})).toBe(false);
 });
});
