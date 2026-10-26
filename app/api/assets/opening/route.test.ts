import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn(),fx:vi.fn()}));
vi.mock('../../../../services/auth',()=>({requireUser:mocks.auth}));
vi.mock('../../../../services/asset-entry-fx',()=>({resolveAssetEntryFx:mocks.fx}));
import {GET,POST} from './route';
const id='11111111-1111-4111-8111-111111111111';
const changes={name:'Opening asset',date:'2026-10-01',amount:100,quantity:2,purpose:''};
const command={asset_id:id,action:'UPDATE',expected_updated_at:'2026-10-01T00:00:00Z',changes};
const request=(body:unknown,origin='https://app.test')=>new Request('https://app.test/api/assets/opening',{method:'POST',headers:{origin},body:JSON.stringify(body)});
beforeEach(()=>{vi.resetAllMocks();mocks.auth.mockResolvedValue({supabase:{rpc:mocks.rpc},user:{id:'user'}});});
it('rejects a foreign origin before authenticating or invoking a financial command',async()=>{
 const r=await POST(request(command,'https://foreign.test'));expect(r.status).toBe(403);expect(mocks.auth).not.toHaveBeenCalled();
});
it('does not accept a client supplied FX rate',async()=>{
 const r=await POST(request({...command,changes:{...changes,fx_rate:0.1}}));expect(r.status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();
});
it('resolves saved FX for the original owner/currency and new date and carries the revision into the atomic command',async()=>{
 mocks.rpc.mockResolvedValueOnce({data:{can_edit:true,asset:{currency:'USD',organization_id:'org'}},error:null}).mockResolvedValueOnce({data:{asset:{id}},error:null});
 mocks.fx.mockResolvedValue({rate:3.75,row:{id:'rate',valuation_date:'2026-09-30',source:'SAVED'}});
 const r=await POST(request(command));expect(r.status).toBe(200);
 expect(mocks.fx).toHaveBeenCalledWith({rpc:mocks.rpc},'user','USD',changes.date,'org');
 expect(mocks.rpc).toHaveBeenLastCalledWith('manage_asset_opening',{p_asset_id:id,p_action:'UPDATE',p_expected_updated_at:command.expected_updated_at,p_changes:{...changes,fx_rate:3.75,fx_rate_id:'rate',fx_rate_date:'2026-09-30',fx_rate_source:'SAVED'}});
});
it('stops an update when the database says a saved snapshot blocks it',async()=>{
 mocks.rpc.mockResolvedValue({data:{can_edit:false,block_reason:'ASSET_OPENING_ZAKAT_LINK'},error:null});
 const r=await POST(request(command));expect(r.status).toBe(409);expect(mocks.rpc).toHaveBeenCalledTimes(1);expect(mocks.fx).not.toHaveBeenCalled();
});
it('does not expose database internals and disables caching',async()=>{
 mocks.rpc.mockRejectedValue(Error('private table details'));
 const r=await GET(new Request('https://app.test/api/assets/opening?asset_id='+id));expect(r.status).toBe(500);expect(await r.json()).toEqual({error:'ASSET_OPENING_REQUEST_FAILED'});expect(r.headers.get('Cache-Control')).toBe('no-store');
});
