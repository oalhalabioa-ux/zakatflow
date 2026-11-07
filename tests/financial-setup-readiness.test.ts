import {describe,it,expect} from 'vitest';
import {financialSetupReadiness,type SetupEvidence} from '../lib/financial-setup-readiness';
const base:SetupEvidence={
 organizationId:'sample',mode:'EXISTING',fiscalStart:'2026-01-01',
 organizationValid:true,chartPostableRetained:true,fiscalCalendarValid:true,
 approvedPostingPolicy:true,bankAccountPresent:true,approvedOpening:true,
 zeroOpeningVerified:false,ownerRoleVisible:true,sourceChecked:true,sourceVerified:true,
};
describe('server-evidence financial setup readiness',()=>{
 it('does not treat a browser completed review as readiness',()=>{
  const result=financialSetupReadiness({...base,sourceVerified:false});
  expect(result.ready).toBe(false);expect(result.statuses.finished).toBe('BLOCKED');
 });
 it('rejects an existing business without approved opening',()=>{
  const result=financialSetupReadiness({...base,approvedOpening:false});
  expect(result.statuses.opening).toBe('IN_PROGRESS');expect(result.ready).toBe(false);
 });
 it('a NEW selection does not silently waive historical opening evidence',()=>{
  const result=financialSetupReadiness({...base,mode:'NEW',zeroOpeningVerified:false});
  expect(result.statuses.opening).toBe('BLOCKED');expect(result.ready).toBe(false);
 });
 it('new zero-opening org is ready only with independent source check',()=>{
  const result=financialSetupReadiness({...base,mode:'NEW',approvedOpening:false,zeroOpeningVerified:true});
  expect(result.statuses.opening).toBe('READY');expect(result.ready).toBe(true);
 });
 it('requires a postable retained account, fiscal mapping, owner and bank',()=>{
  const result=financialSetupReadiness({...base,chartPostableRetained:false,
   fiscalCalendarValid:false,bankAccountPresent:false,ownerRoleVisible:false});
  expect(result.statuses.chart).toBe('IN_PROGRESS');
  expect(result.statuses.fiscal).toBe('IN_PROGRESS');
  expect(result.statuses.banking).toBe('IN_PROGRESS');
  expect(result.statuses.users).toBe('BLOCKED');
  expect(result.certification).toBe('NOT_CERTIFIED');
 });
 it('no mode stays blocked, even when everything else appears complete',()=>{
  const result=financialSetupReadiness({...base,mode:null});
  expect(result.statuses.opening).toBe('NOT_STARTED');expect(result.ready).toBe(false);
 });
});
