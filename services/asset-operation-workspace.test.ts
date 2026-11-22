import {beforeEach,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({auth:vi.fn(),review:vi.fn(),event:false,historySelect:vi.fn(),historyOrder:vi.fn()}));
vi.mock('./auth',()=>({requireUser:f.auth}));
vi.mock('./asset-financial-review',()=>({assetFinancialReview:f.review}));
import {assetOperationWorkspace} from './asset-operation-workspace';
const id='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222';
beforeEach(()=>{vi.clearAllMocks();f.event=false;f.review.mockResolvedValue({event:{organization_id:null,source_module:'LEGACY'},permissions:{},approved:false});f.auth.mockResolvedValue({user:{id:user},supabase:{rpc:async()=>({data:[],error:null}),from:(table:string)=>{let query='';const result=()=>({data:table==='transactions'?(query==='id'?null:{id,user_id:user,transaction_type:'ADJUSTMENT',metadata:f.event?{financial_event_id:id}:null,asset_accounts:{id,user_id:user,organization_id:null}}):table==='asset_lifecycle_commands'?null:[],error:null});const chain:any={select:(s:string)=>{query=s;if(table==='financial_event_status_history')f.historySelect(s);return chain;},eq:()=>chain,in:()=>chain,limit:()=>chain,order:(s:string)=>{if(table==='financial_event_status_history')f.historyOrder(s);return chain;},maybeSingle:async()=>result(),then:(resolve:any)=>Promise.resolve(result()).then(resolve)};return chain;}}});});
it('loads an existing transaction with null metadata and no lifecycle command',async()=>{const data=await assetOperationWorkspace(id);expect(data.record.id).toBe(id);expect(data.review).toBeNull();expect(f.review).not.toHaveBeenCalled();});
it('reads financial history using the stored changed_at column',async()=>{f.event=true;await assetOperationWorkspace(id);expect(f.historySelect).toHaveBeenCalledWith('id,from_status,to_status,note,actor_id,created_at:changed_at');expect(f.historyOrder).toHaveBeenCalledWith('changed_at');});

const bankId='33333333-3333-4333-8333-333333333333';
const personalSale={
 id,user_id:user,organization_id:null,transaction_type:'SALE',transfer_id:bankId,
 quantity:'2',unit_price:null,gross_value:'900',base_value:'900',currency:'SAR',base_currency:'SAR',
 metadata:{proceeds_account_id:bankId},
 asset_accounts:{id,user_id:user,organization_id:null,ownership_scope:'PERSONAL'},
};

function loadSale(sale:typeof personalSale,allocations:{quantity:string;value_base:string}[],count=allocations.length){
 const allocationFilter=vi.fn();
 const allocationRead=vi.fn();
 f.auth.mockResolvedValue({
  user:{id:user},
  supabase:{
   rpc:async()=>({data:[],error:null}),
   from:(table:string)=>{
    let query='';
    const result=()=>{
     if(table==='transactions')return {data:query==='id'?null:sale,error:null};
     if(table==='transaction_allocations')return {data:allocations,error:null,count};
     return {data:[],error:null};
    };
    const chain:any={
     select:(columns:string,options?:unknown)=>{
      query=columns;
      if(table==='transaction_allocations')allocationRead(columns,options);
      return chain;
     },
     eq:(column:string,value:string)=>{
      if(table==='transaction_allocations')allocationFilter(column,value);
      return chain;
     },
     in:()=>chain,order:()=>chain,limit:()=>chain,
     maybeSingle:async()=>result(),
     then:(resolve:any)=>Promise.resolve(result()).then(resolve),
    };
    return chain;
   },
  },
 });
 return {allocationRead,allocationFilter};
}

it('reconciles personal sale voucher amounts from saved FIFO allocations before and after price correction',async()=>{
 const allocations=[{quantity:'0.5',value_base:'150'},{quantity:'1.5',value_base:'450'}];
 const {allocationRead,allocationFilter}=loadSale(personalSale,allocations);
 const voucher=(await assetOperationWorkspace(id)).record;
 expect(allocationRead).toHaveBeenCalledWith('quantity::text,value_base::text',{count:'exact'});
 expect(allocationFilter.mock.calls).toEqual([['transaction_id',id],['user_id',user]]);
 expect(voucher).toMatchObject({unit_price:450,standalone_sale_amounts:{bookEffect:-600,gain:300}});
 loadSale({...personalSale,gross_value:'850',base_value:'850'},allocations);
 expect((await assetOperationWorkspace(id)).record).toMatchObject({
  unit_price:425,standalone_sale_amounts:{bookEffect:-600,gain:250},
 });
});

it('leaves book effect and gain unavailable when FIFO coverage is incomplete',async()=>{
 loadSale(personalSale,[{quantity:'2',value_base:'600'}],2);
 expect((await assetOperationWorkspace(id)).record).toMatchObject({
  unit_price:450,standalone_sale_amounts:{bookEffect:null,gain:null},
 });
 loadSale(personalSale,[{quantity:'1',value_base:'300'}]);
 expect((await assetOperationWorkspace(id)).record.standalone_sale_amounts).toEqual({bookEffect:null,gain:null});
});

it('keeps the voucher unit price in source currency and gain in base currency',async()=>{
 loadSale({...personalSale,currency:'USD',gross_value:'240'},[{quantity:'2',value_base:'600'}]);
 expect((await assetOperationWorkspace(id)).record).toMatchObject({
  unit_price:120,standalone_sale_amounts:{bookEffect:-600,gain:300},
 });
});

it('does not query personal FIFO for institutional or grouped vouchers',async()=>{
 for(const sale of [
  {...personalSale,asset_accounts:{...personalSale.asset_accounts,ownership_scope:'ORGANIZATION'}},
  {...personalSale,metadata:{...personalSale.metadata,lot_sale_request:true}},
 ]){
  const {allocationRead}=loadSale(sale,[]);
  expect((await assetOperationWorkspace(id)).record).not.toHaveProperty('standalone_sale_amounts');
  expect(allocationRead).not.toHaveBeenCalled();
 }
});
