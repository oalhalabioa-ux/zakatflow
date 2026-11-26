import {beforeEach,describe,expect,it,vi} from 'vitest';

const fixture=vi.hoisted(()=>({
 asset:null as Record<string,unknown>|null,
 rpc:vi.fn(),
 statement:vi.fn(),
 readback:vi.fn(),
}));
vi.mock('./auth',()=>({requireUser:async()=>{
 const chain={select:vi.fn(),eq:vi.fn(),is:vi.fn(),maybeSingle:fixture.readback};
 chain.select.mockReturnValue(chain);chain.eq.mockReturnValue(chain);chain.is.mockReturnValue(chain);
 return {user:{id:'self'},supabase:{rpc:fixture.rpc,from:()=>chain}};
}}));
vi.mock('./asset-statement',()=>({readAssetStatement:fixture.statement}));
import {readPersonalCutoffSources} from './reporting-source-contracts';

const asset='bed48c1d-7dae-4392-a99d-911590c658f9',asOf='2026-03-31';

beforeEach(()=>{
 fixture.asset={id:asset,asset_type:'GOLD',currency:'SAR',metadata:{
  market_valuation_date:asOf,market_price_currency:'SAR',market_price_source:'MANUAL',market_price_per_unit:412.5,
 }};
 fixture.rpc.mockReset().mockResolvedValue({data:{asOf,scope:'PERSONAL',coverage:'PARTIAL',rows:[]},error:null});
 fixture.readback.mockReset().mockImplementation(async()=>({data:fixture.asset,error:null}));
 fixture.statement.mockReset().mockResolvedValue({
  complete:true,baseCurrency:'SAR',closing:{quantity:'7',cost:'2470',currency:'SAR'},
 });
});

describe('dated personal source contracts',()=>{
 it('joins an exact-date saved market price to the reconciled V2 book statement',async()=>{
  const result=await readPersonalCutoffSources({asOf,asset});
  expect(result).toMatchObject({assetCoverage:'BOOK_AND_EXACT_DATE_PRICE',asset:{
   id:asset,quantity:'7',cost:'2470',currency:'SAR',valuation:{value:'2887.5',quoteDate:asOf},
  },debts:{coverage:'PARTIAL',asOf}});
  expect(fixture.statement).toHaveBeenCalledWith(asset,{asOf,offset:0,limit:1});
  expect(fixture.rpc).toHaveBeenCalledWith('read_personal_debts_at_cutoff',{p_as_of:asOf});
 });
 it('reports book coverage without substituting the current price or a specialized unsupported asset',async()=>{
  const metadata=fixture.asset!.metadata as Record<string,unknown>;
  metadata.market_valuation_date='2026-04-01';
  await expect(readPersonalCutoffSources({asOf,asset})).resolves.toMatchObject({assetCoverage:'BOOK_ONLY',asset:{valuation:null}});
  metadata.personal_contract_id='contract';
  await expect(readPersonalCutoffSources({asOf,asset})).resolves.toMatchObject({assetCoverage:'SPECIALIZED_SOURCE_REQUIRED',asset:null});
 });
 it('fails closed on inaccessible assets and source changes during the read',async()=>{
  fixture.readback.mockResolvedValueOnce({data:null,error:null});
  await expect(readPersonalCutoffSources({asOf,asset})).rejects.toThrow('PERSONAL_CUTOFF_SOURCE_DENIED');
  fixture.readback.mockResolvedValueOnce({data:fixture.asset,error:null})
    .mockResolvedValueOnce({data:{...fixture.asset,currency:'USD'},error:null});
  await expect(readPersonalCutoffSources({asOf,asset})).rejects.toThrow('PERSONAL_CUTOFF_SOURCE_CHANGED');
 });
});
