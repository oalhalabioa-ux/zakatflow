import {describe,it,expect} from 'vitest';
import {assetEntryTaxSettings} from './asset-entry-tax';
const base={acquisition_mode:'PURCHASE',ownership_scope:'ORGANIZATION',tax_category:'S',vat_input_mode:'PERCENT',vat_rate:15,vat_amount:0,recoverable_percent:100};
describe('asset invoice tax settings',()=>{
 it('calculates standard tax once in percent and amount modes',()=>{expect(assetEntryTaxSettings(base,100).amounts).toEqual({net:100,tax:15,gross:115});expect(assetEntryTaxSettings({...base,vat_input_mode:'AMOUNT',vat_amount:12},100).amounts.gross).toBe(112)});
 it.each(['Z','E','O'])('clears stale standard tax for %s',category=>{const x=assetEntryTaxSettings({...base,tax_category:category,tax_exemption_reason_code:'TEST',tax_exemption_reason:'Test reason'},100);expect(x.amounts.tax).toBe(0);expect(x.amounts.gross).toBe(100);expect(x.metadata.recoverable_percent).toBe(0);expect(x.metadata.tax_category).toBe(category)});
 it.each(['Z','E'])('requires saved reasons for %s even if controls were collapsed',category=>{expect(()=>assetEntryTaxSettings({...base,tax_category:category},100)).toThrow('ASSET_TAX_REASON_REQUIRED')});
 it('ignores purchase settings in openings and personal acquisitions',()=>{expect(assetEntryTaxSettings({...base,acquisition_mode:'OPENING_BALANCE'},100).amounts.tax).toBe(0);expect(assetEntryTaxSettings({...base,ownership_scope:'PERSONAL'},100).amounts.tax).toBe(0)});
 it('rejects standard zero rates and unknown categories',()=>{expect(()=>assetEntryTaxSettings({...base,vat_rate:0},100)).toThrow('ASSET_STANDARD_TAX_REQUIRED');expect(()=>assetEntryTaxSettings({...base,tax_category:'UNKNOWN'},100)).toThrow('ASSET_TAX_CATEGORY_INVALID')});
});
