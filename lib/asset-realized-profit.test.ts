import {describe, expect, it} from 'vitest';
import {summarizeRealizedProfit, type AssetSale, type SaleAllocation, type SalePosting, type SaleReceipt} from './asset-realized-profit';

const identity = {user_id: 'owner', organization_id: null};
const sale: AssetSale = {...identity, id: 'sale', asset_account_id: 'first', transaction_date: '2026-11-20', transfer_id: 'link',
  quantity: '12', unit_price: '500', gross_value: '6000', base_value: '6000', base_currency: 'SAR', currency: 'SAR',
  metadata: {lot_sale_request: 'request', proceeds_account_id: 'bank'}};
const allocations: SaleAllocation[] = [
  {transaction_id: 'sale', quantity: '10', value_base: '3000', lots: {...identity, asset_account_id: 'first'}},
  {transaction_id: 'sale', quantity: '2', value_base: '800', lots: {...identity, asset_account_id: 'second'}},
];
const receipt: SaleReceipt = {...identity, id: 'receipt', asset_account_id: 'bank', transaction_date: sale.transaction_date,
  transfer_id: sale.transfer_id, base_value: '6000', base_currency: 'SAR', metadata: {sale_transaction_id: sale.id}};
const fixture = () => ({sales: [sale], allocations, receipts: [receipt], postings: [] as SalePosting[], reversed: new Set<string>()});

describe('asset realized profit from sale records', () => {
  it('reconciles 6,000 proceeds and 3,800 cost across two assets without counting the bank receipt again', () => {
    const result = summarizeRealizedProfit(fixture());
    expect(result.get('first')).toEqual({status:'recorded', amount:'2000', currency:'SAR'});
    expect(result.get('second')).toEqual({status:'recorded', amount:'200', currency:'SAR'});
    expect(result.size).toBe(2);
    expect(result.get('bank')).toBeUndefined();
  });

  it('reflects a price correction and excludes the paired reversal with allocations untouched', () => {
    const corrected = {...sale, unit_price:'450', gross_value:'5400', base_value:'5400'};
    const receipts = [{...receipt, base_value:'5400'}];
    const input = {...fixture(), sales:[corrected], receipts};
    expect([...summarizeRealizedProfit(input).values()]).toEqual([
      {status:'recorded', amount:'1500', currency:'SAR'},
      {status:'recorded', amount:'100', currency:'SAR'},
    ]);
    expect(summarizeRealizedProfit({...input, reversed:new Set(['sale', 'receipt'])}).size).toBe(0);
  });

  it('retains the recorded base-currency proceeds for a foreign-currency sale and shows losses', () => {
    const independent = {...sale, quantity:'10', currency:'USD', gross_value:'600', base_value:'2250', metadata:{proceeds_account_id:'bank'}};
    const result = summarizeRealizedProfit({...fixture(), sales:[independent], allocations:[allocations[0]], receipts:[{...receipt, base_value:'2250'}]});
    expect(result.get('first')).toEqual({status:'recorded', amount:'-750', currency:'SAR'});
  });

  it.each([
    {allocations: [allocations[0]]},
    {allocations: [allocations[0], {...allocations[1], lots:{...identity, user_id:'other', asset_account_id:'second'}}]},
    {receipts: []},
    {receipts: [receipt, {...receipt, id:'second-receipt'}]},
    {receipts: [{...receipt, base_value:'5999'}]},
    {reversed: new Set(['receipt'])},
  ])('exposes incomplete evidence without assuming missing amounts are zero', amendment => {
    const result = summarizeRealizedProfit({...fixture(), ...amendment});
    expect(result.get('first')).toEqual({status:'incomplete'});
  });

  it('reconciles an institutional gain of 5,000 with the approved book cost and excludes 18,480 VAT', () => {
    const organization = 'co';
    const corporate = {...sale, organization_id:organization, quantity:'1', gross_value:'123200', base_value:'123200',
      metadata:{financial_event_id:'event', cost_basis_base:'118200', vat_amount:'18480'}};
    const posting: SalePosting = {
      id:'command', transaction_id:sale.id, asset_account_id:sale.asset_account_id, organization_id:organization, financial_event_id:'event',
      operation_date:sale.transaction_date, applied_at:'2026-11-20T10:00:00Z', quantity:'1', amount:'123200', book_effect:'118200', vat_amount:'18480',
      financial_events:{status:'ACTUAL', source_module:'ASSET_LIFECYCLE', source_record_id:'command', base_currency:'SAR'},
    };
    const input = {...fixture(), sales:[corporate], postings:[posting]};
    expect(summarizeRealizedProfit(input).get('first')).toEqual({status:'recorded', amount:'5000', currency:'SAR'});
    expect(summarizeRealizedProfit({...input, postings:[{...posting, applied_at:null}]}).get('first')).toEqual({status:'incomplete'});
    expect(summarizeRealizedProfit({...input, postings:[{...posting, financial_events:{...posting.financial_events!, status:'REVERSED'}}]}).size).toBe(0);
  });
});
