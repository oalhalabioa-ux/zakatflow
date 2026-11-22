import {beforeEach,describe,expect,it,vi} from 'vitest';
import {z} from 'zod';
const read=vi.hoisted(()=>vi.fn());
vi.mock('../../../../../services/asset-statement',()=>({
 readAssetStatement:read,
 assetStatementQuery:z.object({asOf:z.string().date(),offset:z.coerce.number().int().min(0).default(0),limit:z.coerce.number().int().min(1).max(100).default(30)}),
}));
import {GET} from './route';

const id='11111111-1111-4111-8111-111111111111';
const request=(query:string)=>new Request('https://app.yaqeenbiz.test/api/assets/'+id+'/statement?'+query);
const context=(value=id)=>({params:Promise.resolve({id:value})});

describe('asset statement GET',()=>{
 beforeEach(()=>{read.mockReset();});
 it('validates the ID and paging before opening an asset',async()=>{
  expect((await GET(request('asOf=2026-11-21'),context('invalid'))).status).toBe(400);
  expect((await GET(request('asOf=2026-11-21&limit=101'),context())).status).toBe(400);
  expect(read).not.toHaveBeenCalled();
 });
 it('returns a private statement for the exact asset and date',async()=>{
  read.mockResolvedValue({rows:[],total:0});
  const response=await GET(request('asOf=2026-11-21&offset=20&limit=20'),context());
  expect(read).toHaveBeenCalledWith(id,{asOf:'2026-11-21',offset:20,limit:20});
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(await response.json()).toEqual({rows:[],total:0});
 });
 it('returns indistinguishable missing/forbidden data without financial fields',async()=>{
  read.mockRejectedValue(new Error('ASSET_NOT_FOUND'));
  const response=await GET(request('asOf=2026-11-21'),context());
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({error:'ASSET_NOT_FOUND'});
 });
});
