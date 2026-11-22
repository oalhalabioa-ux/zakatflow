import {afterEach,describe,expect,it,vi} from 'vitest';

const requireUser=vi.hoisted(()=>vi.fn());
vi.mock('./auth',()=>({requireUser}));
import {readAssetStatement} from './asset-statement';

type Row=Record<string,any>;
const owner='owner';
const assetId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sale='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const date='2026-01-01';
const options={asOf:'2026-11-20',offset:0,limit:1};

function useFixture(tables:Record<string,Row[]>){
 const queries:{table:string;operation:string;column:string;value:unknown}[]=[];
 const from=(table:string)=>{
  let rows=[...(tables[table]??[])];
  const filter=(operation:string,column:string,value:unknown,match:(item:Row)=>boolean)=>{
   queries.push({table,operation,column,value});rows=rows.filter(match);return query;
  };
  const query={
   select:()=>query,
   eq:(column:string,value:unknown)=>filter('eq',column,value,item=>item[column]===value),
   is:(column:string,value:unknown)=>filter('is',column,value,item=>item[column]===value),
   lte:(column:string,value:string)=>filter('lte',column,value,item=>item[column]<=value),
   in:(column:string,value:unknown[])=>filter('in',column,value,item=>value.includes(item[column])),
   order:(column:string)=>{rows.sort((a,b)=>String(a[column]).localeCompare(String(b[column])));return query;},
   maybeSingle:async()=>({data:rows[0]??null,error:null}),
   then:(resolve:(value:{data:Row[];error:null})=>unknown)=>Promise.resolve({data:rows,error:null}).then(resolve),
   range:async(from:number,to:number)=>({data:rows.slice(from,to+1),error:null}),
  };
  return query;
 };
 requireUser.mockResolvedValue({supabase:{from},user:{id:owner}});
 return queries;
}
const asset={id:assetId,user_id:owner,organization_id:null,name:'Gold',unit:'g',asset_type:'GOLD',metadata:{}};

afterEach(()=>{vi.resetAllMocks();});

describe('read statement scope and paging',()=>{
 it('rejects missing or foreign personal asset before reading any movements',async()=>{
  const queries=useFixture({asset_accounts:[{...asset,user_id:'other'}]});
  await expect(readAssetStatement(assetId,options)).rejects.toThrow('ASSET_NOT_FOUND');
  expect(queries.map(query=>query.table)).toEqual(['asset_accounts']);
 });
 it('queries one asset and preserves prior running balance on page two',async()=>{
  const row={user_id:owner,organization_id:null,asset_account_id:assetId,created_at:'2026-01-01T00:00:00Z',
   unit_price:null,currency:'SAR',base_value:'100',base_currency:'SAR',metadata:{},reference:null,gross_value:'100'};
  const queries=useFixture({
   asset_accounts:[asset],profiles:[{id:owner,base_currency:'SAR'}],
   transactions:[
    {...row,id:sale,transaction_type:'SALE',transaction_date:'2026-02-01',quantity:'1',gross_value:'200'},
    {...row,id:assetId,transaction_type:'OPENING_BALANCE',transaction_date:date,quantity:'2'},
    {...row,id:'foreign',asset_account_id:'another',transaction_type:'ADD',transaction_date:date,quantity:'200'},
   ],
   lots:[{id:'lot',asset_account_id:assetId,source_transaction_id:assetId,acquisition_date:date,
    original_quantity:'2',original_value_base:'100',remaining_quantity:'1',remaining_value_base:'50',metadata:{}}],
   transaction_allocations:[{id:'allocation',user_id:owner,transaction_id:sale,quantity:'1',value_base:'50'}],
   voucher_numbers:[{source_id:sale,source_table:'transactions',document_number:'SA-01'}],
  });
  const first=await readAssetStatement(assetId,options);
  expect(first.rows).toHaveLength(1);expect(first.nextOffset).toBe(1);
  const second=await readAssetStatement(assetId,{...options,offset:1});
  expect(second.rows[0]).toMatchObject({voucher:'SA-01',remainingCost:'50',remainingQuantity:'1',amount:'200'});
  expect(second.total).toBe(2);expect(second.nextOffset).toBeNull();
  const report=await readAssetStatement(assetId,{...options,offset:1,view:'report'});
  expect(report.rows).toEqual([...first.rows,...second.rows]);
  expect(report.total).toBe(2);
  expect(report.nextOffset).toBeNull();
  expect(report.closing).toEqual(second.closing);

  expect(queries.filter(q=>q.table==='transactions'&&q.column==='asset_account_id').every(q=>q.value===assetId)).toBe(true);
  expect(queries.filter(q=>q.table==='transactions'&&q.column==='user_id').every(q=>q.value===owner)).toBe(true);
 });
 it('contains organization queries to the RLS-visible asset and its organization',async()=>{
  const queries=useFixture({asset_accounts:[{...asset,user_id:'creator',organization_id:'org'}],
   organizations:[{id:'org',base_currency:'SAR'}]});
  const statement=await readAssetStatement(assetId,options);
  expect(statement.asset.organizational).toBe(true);
  expect(queries).toEqual(expect.arrayContaining([
   expect.objectContaining({table:'transactions',column:'organization_id',value:'org'}),
   expect.objectContaining({table:'asset_lifecycle_commands',column:'organization_id',value:'org'}),
  ]));
 });
});
