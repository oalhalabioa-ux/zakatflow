import {describe,expect,it} from 'vitest';
import {buildAssetStatement,currentAssetValuation,type StatementTransaction,type StatementLot} from './asset-statement';

const transaction=(id:string,date:string,kind:string,quantity:number,gross:number,metadata:Record<string,unknown>={}):StatementTransaction=>({
 id,transaction_date:date,created_at:`${date}T09:00:00Z`,transaction_type:kind,quantity,unit_price:null,gross_value:gross,
 currency:'SAR',base_value:gross,base_currency:'SAR',reference:null,reversal_of_transaction_id:null,metadata,
});
const lot=(source:string,date:string,quantity:number,cost:number):StatementLot=>({
 source_transaction_id:source,acquisition_date:date,original_quantity:quantity,original_value_base:cost,
 remaining_quantity:0,remaining_value_base:0,metadata:{},
});
const options={asOf:'2026-11-21',baseCurrency:'SAR',organizational:false,commands:[],events:[],reversals:[],amendments:[],allocations:[]};

describe('asset statement accounting',()=>{
 it('uses recorded FIFO, keeps sale prices separate, and includes a later amendment without applying another movement',()=>{
  const transactions=[
   transaction('opening','2026-01-01','OPENING_BALANCE',5,1500),
   transaction('buy','2026-02-01','PURCHASE',7,2240),
   transaction('sale1','2026-03-01','SALE',3,1320,{sale_price_amendment:{revision:1}}),
   transaction('sale2','2026-04-01','SALE',3,1650),
  ];
  const lots=[lot('opening','2026-01-01',5,1500),lot('buy','2026-02-01',7,2240)];
  const allocations=[{transaction_id:'sale1',quantity:3,value_base:900},
   {transaction_id:'sale2',quantity:2,value_base:600},{transaction_id:'sale2',quantity:1,value_base:320}];
  const amendments=[{id:'audit',entity_id:'sale1',created_at:'2026-05-01T09:00:00Z',new_data:{sale_amount:1320,unit_price:440}}];
  const input={...options,transactions,lots,allocations,amendments};
  const statement=buildAssetStatement(input);
  expect(statement.rows.map(row=>[row.type,row.remainingQuantity,row.remainingCost])).toEqual([
   ['OPENING_BALANCE','5','1500'],['PURCHASE','12','3740'],['SALE','9','2840'],
   ['SALE','6','1920'],['PRICE_CORRECTION','6','1920'],
  ]);
  expect(statement.rows[2]).toMatchObject({amount:'1320',unitPrice:'440',costEffect:'-900'});
  expect(statement.rows[4]).toMatchObject({source_id:'sale1',costEffect:'0'});
  expect(buildAssetStatement({...input,asOf:'2026-03-01'}).closing).toEqual({quantity:'9',cost:'2840',currency:'SAR'});
 });

 it('adds an explicit reversal at the reversal date and uses the allocation rather than sale proceeds',()=>{
  const purchase=transaction('purchase','2026-01-02','PURCHASE',2,100);
  const sale=transaction('sale','2026-02-01','SALE',2,150);
  const reversal={...transaction('reversal','2026-04-01','REVERSAL',2,150),reversal_of_transaction_id:'sale'};
  const input={...options,transactions:[reversal,sale,purchase],lots:[lot('purchase','2026-01-02',2,100)],
   allocations:[{transaction_id:'sale',quantity:2,value_base:100}]};
  expect(buildAssetStatement({...input,asOf:'2026-03-01'}).closing).toMatchObject({quantity:'0',cost:'0'});
  const after=buildAssetStatement(input);
  expect(after.rows[1].status).toBe('REVERSED');
  expect(after.rows[2]).toMatchObject({costEffect:'100',quantityIn:'2',remainingCost:'100'});
 });

 it('uses posted organization lot deltas while drafts have zero effect and a recorded reversal restores the carrying value',()=>{
  const rows=[
   transaction('open','2026-01-01','OPENING_BALANCE',10,120000),
   transaction('d1','2026-02-01','ADJUSTMENT',0,1800,{operation:'DEPRECIATION',financial_event_id:'event1'}),
   transaction('d2','2026-03-01','ADJUSTMENT',0,1800,{operation:'DEPRECIATION',financial_event_id:'event2'}),
   transaction('s1','2026-04-01','SALE',2,25000,{financial_event_id:'event3'}),
  ];
  const command=(id:string,tx:string|null,date:string,qty:number,value:number,afterQty:number,afterValue:number,operation='DEPRECIATION')=>({
   id,transaction_id:tx,financial_event_id:`event${id}`,operation,operation_date:date,created_at:`${date}T09:00:00Z`,
   applied_at:tx?`${date}T09:00:00Z`:null,quantity:qty-afterQty,amount:value-afterValue,
   lot_states:tx?[{id:'lot',quantity:qty,value,after_quantity:afterQty,after_value:afterValue}]:[],
  });
  const input={...options,organizational:true,transactions:rows,lots:[lot('open','2026-01-01',10,90000)],
   commands:[command('1','d1','2026-02-01',10,90000,10,88200),command('2','d2','2026-03-01',10,88200,10,86400),
    command('3','s1','2026-04-01',10,86400,8,69120,'SALE'),command('4',null,'2026-06-01',8,69120,8,67320)],
   events:['ACTUAL','ACTUAL','REVERSED','DRAFT'].map((status,i)=>({id:`event${i+1}`,base_currency:'SAR',status})),
   reversals:[{id:'rev',event_id:'event3',changed_at:'2026-04-30T21:30:00Z'}]};
  const before=buildAssetStatement({...input,asOf:'2026-04-30'});
  expect(before.closing).toMatchObject({quantity:'8',cost:'69120'});
  const after=buildAssetStatement(input);
  expect(after.rows[1]).toMatchObject({costEffect:'-1800',quantityOut:'0'});
  expect(after.rows[4]).toMatchObject({date:'2026-05-01',type:'REVERSAL',costEffect:'17280'});
  expect(after.rows[5]).toMatchObject({status:'DRAFT',costEffect:'0'});
  expect(after.closing).toMatchObject({quantity:'10',cost:'86400'});
 });

 it('withholds running totals if stored allocations are missing or basis currencies differ',()=>{
  const purchase=transaction('purchase','2026-01-02','PURCHASE',2,100);
  const sale=transaction('sale','2026-02-01','SALE',1,150);
  const input={...options,transactions:[purchase,sale],lots:[lot('purchase','2026-01-02',2,100)]};
  const unknown=buildAssetStatement(input);
  expect(unknown.complete).toBe(false);
  expect(unknown.rows[1].costEffect).toBeNull();
  expect(unknown.closing.cost).toBeNull();
  expect(buildAssetStatement({...input,baseCurrency:'USD'}).rows[0].remainingCost).toBeNull();
 });
});

describe('stored price basis',()=>{
 it('retains the voucher prices for 18K and applies purity only to the pure-metal reference',()=>{
  const opening=transaction('opening','2026-01-01','OPENING_BALANCE',10,3000,{karat:18});
  const sale=transaction('sale','2026-05-01','SALE',2,800,{proceeds_account_id:'bank'});
  const statement=buildAssetStatement({...options,transactions:[opening,sale],
   lots:[lot('opening','2026-01-01',10,3000)],allocations:[{transaction_id:'sale',quantity:2,value_base:600}]});
  expect(statement.rows[0]).toMatchObject({amount:'3000',unitPrice:'300',costEffect:'3000'});
  expect(statement.rows[1]).toMatchObject({amount:'800',unitPrice:'400',remainingQuantity:'8',remainingCost:'2400',
   sale:{proceeds:'800',cost:'600',realized:'200'}});
  const input={type:'GOLD',currency:'SAR',baseCurrency:'SAR',quantity:'8',cost:'2400',date:'2026-11-21'};
  expect(currentAssetValuation({...input,metadata:{karat:18,market_price:410,market_value_auto:true}})).toMatchObject({
   basis:'PURE_METAL_REFERENCE',purity:'0.75',appliedPrice:'307.5',value:'2460',unrealized:'60',
  });
  expect(currentAssetValuation({...input,metadata:{karat:18,market_price:410}})).toMatchObject({
   basis:'ASSET_UNIT',appliedPrice:'410',value:'3280',unrealized:'880',
  });
  expect(currentAssetValuation({...input,metadata:{karat:18}})).toBeNull();
  expect(currentAssetValuation({...input,metadata:{market_price:410,market_valuation_date:'2026-11-22'}})).toBeNull();
 });
});
