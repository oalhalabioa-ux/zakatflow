import {describe,it,expect} from 'vitest';
import {ASSET_DISPLAY_CLASSES,assetDisplayClass,catalogDisplayClass,assetTypeIcon} from '../lib/asset-classification-display';
describe('asset presentation preserves accounting records',()=>{
 it('groups legacy assets without modifying their ownership, balances or classification',()=>{
  const records=['CASH','BANK','GOLD','SILVER','STOCK','INVENTORY','RECEIVABLE','REAL_ESTATE','OTHER'].map(asset_type=>Object.freeze({asset_type,asset_class_code:null,asset_type_code:null,ownership_scope:'PERSONAL',current_cost_value:100,metadata:Object.freeze({purchase_value:100})}));
  const before=JSON.stringify(records);
  const groups=ASSET_DISPLAY_CLASSES.map(([code])=>records.filter(r=>assetDisplayClass(r)===code));
  expect(groups.flat()).toHaveLength(records.length);
  expect(new Set(groups.flat())).toHaveLength(records.length);
  expect(JSON.stringify(records)).toBe(before);
  expect(assetDisplayClass(records[7])).toBe('UNCLASSIFIED');
 });
 it('separates displayed financial categories while retaining stored class codes',()=>{
  expect(catalogDisplayClass({code:'BANK',class_code:'FINANCIAL'})).toBe('CASH');
  expect(catalogDisplayClass({code:'RECEIVABLE',class_code:'FINANCIAL'})).toBe('RECEIVABLE');
  expect(catalogDisplayClass({code:'DEPOSIT',class_code:'FINANCIAL'})).toBe('INVESTMENT');
  expect(catalogDisplayClass({code:'INVESTMENT_PROPERTY',class_code:'INVESTMENT'})).toBe('PROPERTY');
  expect(catalogDisplayClass({code:'MACHINERY',class_code:'PPE',default_legacy_asset_type:'OTHER'})).toBe('PPE');
 });
 it('retains an unknown asset visibly for review',()=>{
  expect(assetDisplayClass({asset_type:'FUTURE_TYPE',asset_class_code:'FUTURE_CLASS'})).toBe('UNCLASSIFIED');
  expect(assetTypeIcon('FUTURE_TYPE')).toBeTruthy();
 });
});
