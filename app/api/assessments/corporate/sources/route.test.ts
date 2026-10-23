import {beforeEach,expect,it,vi} from 'vitest';
const source=vi.hoisted(()=>vi.fn());
vi.mock('../../../../../services/corporate-zakat-assessment',()=>({corporateZakatSources:source}));
import {POST} from './route';
beforeEach(()=>vi.resetAllMocks());
it('passes hosted browser requests through to the authenticated source service',async()=>{
 source.mockResolvedValue({values:{cash:'3150000'}});
 const r=await POST(new Request('http://localhost:3000/api',{method:'POST',headers:{origin:'https://yaqeenbiz.com','sec-fetch-site':'same-origin'},body:'{}'}));
 expect(r.status).toBe(200);expect(await r.json()).toEqual({values:{cash:'3150000'}});expect(r.headers.get('Cache-Control')).toBe('no-store');
});
it('rejects cross-site requests before reading or capturing financial data',async()=>{
 const r=await POST(new Request('http://localhost:3000/api',{method:'POST',headers:{origin:'https://yaqeenbiz.com','sec-fetch-site':'cross-site'},body:'{}'}));
 expect(r.status).toBe(403);expect(source).not.toHaveBeenCalled();
});
