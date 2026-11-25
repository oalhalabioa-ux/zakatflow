import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({report:vi.fn(),auth:vi.fn()}));
vi.mock('../../../services/operational-reports',()=>({readOperationalReport:mocks.report}));
vi.mock('../../../services/auth',()=>({requireUser:mocks.auth}));
import {GET} from './route';
const org='20000000-0000-4000-8000-000000000001';
beforeEach(()=>vi.resetAllMocks());
it('carries personal/company request scope into every operational export and disables caching',async()=>{
 mocks.report.mockResolvedValue([{id:'owned',amount:25}]);
 for(const type of ['assets','transactions','lots','assessments','payments']){
  const r=await GET(new Request(`https://test/api/reports?type=${type}&scope=ORGANIZATION&organization_id=${org}&group=1`));
  expect(r.status).toBe(200);expect(r.headers.get('Cache-Control')).toBe('no-store');expect(r.headers.get('Content-Disposition')).toContain('organization.csv');
  expect(mocks.report).toHaveBeenLastCalledWith(type,{scope:'ORGANIZATION',organization_id:org,entity_id:null,group:true});
 }
});
it('rejects mixed scope and unknown or repeated report types instead of silently exporting personal assessments',async()=>{
 for(const query of ['type=unknown','type=payments&type=assessments','type=payments&scope=PERSONAL&organization_id='+org,'type=transactions&scope=ORGANIZATION'])expect((await GET(new Request('https://test/api/reports?'+query))).status).toBe(400);
 expect(mocks.report).not.toHaveBeenCalled();
});
it('does not return a CSV when membership/permission is denied and withholds internal errors',async()=>{
 mocks.report.mockRejectedValueOnce(Error('ORGANIZATION_ACCESS_REQUIRED'));
 let response=await GET(new Request('https://test/api/reports?type=payments&scope=ORGANIZATION&organization_id='+org));
 expect(response.status).toBe(403);expect(response.headers.get('Content-Type')).toContain('application/json');
 mocks.report.mockRejectedValueOnce(Error('unexpected private query text'));
 response=await GET(new Request('https://test/api/reports?type=payments&scope=PERSONAL'));
 expect(response.status).toBe(500);expect(await response.json()).toEqual({error:'REPORT_LOAD_FAILED'});
});
it('escapes spreadsheet formulas and preserves source amounts in CSV',async()=>{
 mocks.report.mockResolvedValue([{reference:'=HYPERLINK("https://example.invalid")',amount:125.25}]);
 const response=await GET(new Request('https://test/api/reports?type=payments&scope=PERSONAL'));
 const text=await response.text();expect(text).toContain("'=HYPERLINK");expect(text).toContain('125.25');
});
it('preserves status fields from both assessment and liquidity rows in a corporate export',async()=>{
 mocks.report.mockResolvedValue([{id:'assessment',currency:'SAR',amount:25,status:'PARTIAL'},{id:'flow',currency:'USD',amount:10,status:'CONFIRMED',settlement_status:'PARTIAL'}]);
 const response=await GET(new Request('https://test/api/reports?type=payments&scope=ORGANIZATION&organization_id='+org));
 const text=await response.text();expect(text).toContain('settlement_status');expect(text).toContain('SAR');expect(text).toContain('USD');expect(text).toContain('CONFIRMED');
});
