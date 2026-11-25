import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),requireUser:vi.fn(),redirect:vi.fn((href:string)=>{throw new Error('REDIRECT:'+href)})}));
vi.mock('./auth',()=>({requireUser:mocks.requireUser}));
vi.mock('next/navigation',()=>({redirect:mocks.redirect}));
import {requireDashboardScope} from './dashboard-access';

beforeEach(()=>{
 vi.clearAllMocks();
 mocks.requireUser.mockResolvedValue({user:{id:'personal-user'},supabase:{rpc:mocks.rpc}});
 mocks.rpc.mockResolvedValue({data:true,error:null});
});
describe('dashboard scope access',()=>{
 it('allows an authenticated personal user with no institution without querying company onboarding',async()=>{
  await expect(requireDashboardScope('PERSONAL','ar')).resolves.toBeUndefined();
  expect(mocks.requireUser).toHaveBeenCalledOnce();expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.redirect).not.toHaveBeenCalled();
 });
 it('does not turn a personal dashboard into an error when company onboarding is unavailable',async()=>{
  mocks.rpc.mockRejectedValue(new Error('COMPANY_SCHEMA_UNAVAILABLE'));
  await expect(requireDashboardScope('PERSONAL','en')).resolves.toBeUndefined();
  expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('keeps authentication mandatory for personal dashboards',async()=>{
  mocks.requireUser.mockRejectedValue(new Error('UNAUTHORIZED'));
  await expect(requireDashboardScope('PERSONAL','en')).rejects.toThrow('UNAUTHORIZED');expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('still redirects an unenrolled business account to organization onboarding',async()=>{
  await expect(requireDashboardScope('ORGANIZATION','ar')).rejects.toThrow('REDIRECT:/ar/onboarding');
  expect(mocks.rpc).toHaveBeenCalledWith('organization_onboarding_required');
 });
 it('allows an existing institutional workspace and retains its onboarding failure guard',async()=>{
  mocks.rpc.mockResolvedValueOnce({data:false,error:null});
  await expect(requireDashboardScope('ORGANIZATION','en')).resolves.toBeUndefined();
  mocks.rpc.mockResolvedValueOnce({data:null,error:new Error('ONBOARDING_UNAVAILABLE')});
  await expect(requireDashboardScope('ORGANIZATION','en')).rejects.toThrow('ONBOARDING_UNAVAILABLE');
 });
});
