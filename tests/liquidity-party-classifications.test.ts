import {describe,it,expect} from 'vitest';
import {liquidityPartyAllowsClassification as allows,liquidityPartyClassifications as choices} from '../lib/liquidity-party-classifications';
describe('liquidity party accounting compatibility',()=>{
 it('allows supplier expense and payment while rejecting supplier sales recognition',()=>{expect(allows('SUPPLIER','OPEX')).toBe(true);expect(allows('SUPPLIER','PAYABLE')).toBe(true);expect(allows('SUPPLIER','REVENUE')).toBe(false);});
 it('allows customer revenue and collection while rejecting customer purchases',()=>{expect(allows('CUSTOMER','REVENUE')).toBe(true);expect(allows('CUSTOMER','RECEIVABLE')).toBe(true);expect(allows('CUSTOMER','OPEX')).toBe(false);});
 it('supports a party acting as both customer and supplier',()=>{for(const type of ['REVENUE','RECEIVABLE','OPEX','PAYABLE'])expect(allows('BOTH',type)).toBe(true);});
 it('does not invent restrictions for specialized type codes without a persisted compatibility policy',()=>{for(const code of ['LENDER','OWNER','ASSET_SUPPLIER','INVESTMENT_COUNTERPARTY','TAX_AUTHORITY','ZAKAT_AUTHORITY'])expect(choices(code)).toEqual([]);});
 it('preserves custom, personal and unspecified party types without guessing from names',()=>{for(const code of ['CUSTOM_123','PERSON','OTHER','']){expect(choices(code)).toEqual([]);expect(allows(code,'OPEX')).toBe(true);expect(allows(code,'REVENUE')).toBe(true);}});
});
