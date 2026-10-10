import {describe,it,expect} from 'vitest';
import {disposedAssetHistory} from '../lib/asset-ledger';
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
