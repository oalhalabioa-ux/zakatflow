import {describe,it,expect} from 'vitest';
import {evaluateFeasibilityAccess as decide} from './access';
const now=new Date('2026-11-09T12:00:00Z');
const grant={status:'TRIAL' as const,starts_at:'2026-11-01T00:00:00Z',ends_at:'2026-12-01T00:00:00Z'};
describe('independent project-study entitlement',()=>{
 it('rejects absent, future or malformed grants',()=>{
  expect(decide(null,now).canRead).toBe(false);
  expect(decide({...grant,starts_at:'2026-12-15T00:00:00Z',ends_at:'2026-12-30T00:00:00Z'},now).canRead).toBe(false);
  expect(decide({...grant,ends_at:'2026-10-01T00:00:00Z'},now).canRead).toBe(false);
 });
 it('allows valid trial and active accounts to change studies',()=>{
  expect(decide(grant,now).canWrite).toBe(true);
  expect(decide({...grant,status:'ACTIVE'},now).canWrite).toBe(true);
 });
 it('preserves read/export but forbids writes after expiry or suspension',()=>{
  for(const g of [{...grant,ends_at:'2026-11-02T00:00:00Z'},...(['READ_ONLY','SUSPENDED','CANCELLED'] as const).map(status=>({...grant,status}))]){
   const r=decide(g,now);expect(r.canRead).toBe(true);expect(r.canWrite).toBe(false);expect(r.readOnly).toBe(true);
  }
 });
});
