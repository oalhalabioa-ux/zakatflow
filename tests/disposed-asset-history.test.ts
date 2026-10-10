import {describe,it,expect} from 'vitest';
import {disposedAssetHistory,soldAssetHistory} from '../lib/asset-ledger';
describe('disposed asset history',()=>{
 it('retains partial disposal quantities and costs, excluding reversed and other asset entries',()=>{
  const data=[{asset_account_id:'a',quantity:20,base_value:0,metadata:{reason:'DISPOSAL_ZERO_VALUE',disposed_cost_base:1200}},
   {asset_account_id:'a',quantity:10,metadata:{reason:'DISPOSAL_ZERO_VALUE',cost_basis_base:450}},
   {asset_account_id:'a',quantity:5,base_value:200,metadata:{reason:'DISPOSAL_ZERO_VALUE',lifecycle_reversed:true}},
   {asset_account_id:'b',quantity:8,base_value:500,metadata:{reason:'DISPOSAL_ZERO_VALUE'}},
   {asset_account_id:'a',quantity:9,base_value:800,metadata:{reason:'SALE'}}];
  expect(disposedAssetHistory('a',data)).toEqual({disposed_quantity:30,disposed_cost_value:1650});
 });
 it('supports legacy disposal cost without using a market quote',()=>{
  expect(disposedAssetHistory('a',[{asset_account_id:'a',quantity:2000,base_value:13600,metadata:{reason:'DISPOSAL_ZERO_VALUE'}}])).toEqual({disposed_quantity:2000,disposed_cost_value:13600});
 });
});

describe('sold asset history',()=>{
 it('adds exited quantities and FIFO costs across sales without using proceeds as cost',()=>{
  const transactions=[{id:'s1',asset_account_id:'a',transaction_type:'SALE',quantity:2,base_value:1500},
   {id:'s2',asset_account_id:'a',transaction_type:'SALE',quantity:3,base_value:2400,metadata:{cost_basis_base:1800}},
   {id:'r',asset_account_id:'a',transaction_type:'SALE',quantity:10,base_value:8000,metadata:{lifecycle_reversed:true}},
   {id:'b',asset_account_id:'b',transaction_type:'SALE',quantity:20,base_value:9000}];
  expect(soldAssetHistory('a',transactions,[{transaction_id:'s1',value_base:600},{transaction_id:'s1',value_base:500},{transaction_id:'b',value_base:999}])).toEqual({sold_quantity:5,sold_cost_value:2900,sold_proceeds_value:3900});
 });
 it('keeps missing historical cost unknown, preserving a recorded zero cost',()=>{
  const sale={id:'s',asset_account_id:'a',transaction_type:'SALE',quantity:1,base_value:500};
  expect(soldAssetHistory('a',[sale],[]).sold_cost_value).toBeNull();
  expect(soldAssetHistory('a',[{...sale,metadata:{cost_basis_base:0}}],[]).sold_cost_value).toBe(0);
 });
});
