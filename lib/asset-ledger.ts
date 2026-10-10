import Decimal from 'decimal.js';

export function assetLedgerBalance(asset: any, lots: any[], baseCurrency = 'SAR') {
  const metadata = asset.metadata ?? {};
  const owned = lots.filter(l => l.asset_account_id === asset.id);
  const quantity = owned.reduce((s, l) => s.add(l.remaining_quantity ?? 0), new Decimal(0));
  const originalQuantity = owned.reduce((s, l) => s.add(l.original_quantity ?? 0), new Decimal(0));
  const cost = owned.reduce((s, l) => s.add(l.remaining_value_base ?? 0), new Decimal(0));
  const quote = metadata.market_price_per_unit ?? metadata.market_price;
  const quoteCurrency = metadata.market_price_currency ?? asset.currency;
  const fx = quoteCurrency === baseCurrency ? 1 : Number(metadata.market_fx_rate ?? metadata.fx_rate ?? 0);
  let market = cost;
  if (!['CASH', 'BANK'].includes(asset.asset_type)) {
    if (quote != null && Number(quote) > 0 && fx > 0) market = quantity.mul(quote).mul(fx);
    else if (originalQuantity.gt(0) && fx > 0 && (metadata.market_value != null || metadata.estimated_value != null)) {
      market = new Decimal(metadata.market_value ?? metadata.estimated_value).mul(quantity.div(originalQuantity)).mul(fx);
    }
  }
  return {current_quantity: quantity.toNumber(), current_cost_value: cost.toNumber(),
    current_market_value: market.toNumber(), current_value_currency: baseCurrency,
    has_financial_history: owned.length > 0, valuation_fx_missing: fx <= 0};
}

// Payments remain attached to their original snapshot. A replacement within the
// SAME cycle credits them by lot; payments from another cycle never reduce it.
export function assetZakatPayments(allocations: any[], assessment: any) {
  const currentByLot = new Map<string, number>();
  const historicalByAsset = new Map<string, number>();
  const currentByAsset = new Map<string, number>();
  for (const allocation of allocations) {
    if (allocation.asset_account_id) historicalByAsset.set(allocation.asset_account_id,
      (historicalByAsset.get(allocation.asset_account_id) ?? 0) + Number(allocation.allocated_amount ?? 0));
    const inScope = assessment.hawl_cycle_id
      ? allocation.hawl_cycle_id === assessment.hawl_cycle_id
      : allocation.assessment_id === assessment.id;
    if(inScope && allocation.asset_account_id) currentByAsset.set(allocation.asset_account_id,(currentByAsset.get(allocation.asset_account_id)??0)+Number(allocation.allocated_amount??0));
    if (inScope && allocation.lot_id) currentByLot.set(allocation.lot_id,
      (currentByLot.get(allocation.lot_id) ?? 0) + Number(allocation.allocated_amount ?? 0));
  }
  return {currentByLot, currentByAsset, historicalByAsset};
}

export function disposedAssetHistory(assetId:string,transactions:any[]){
  const disposed=transactions.filter(t=>t.asset_account_id===assetId&&t.metadata?.reason==='DISPOSAL_ZERO_VALUE'&&!t.metadata?.lifecycle_reversed);
  return {disposed_quantity:disposed.reduce((sum,t)=>sum.add(t.quantity??0),new Decimal(0)).toNumber(),
    disposed_cost_value:disposed.reduce((sum,t)=>sum.add(t.metadata?.disposed_cost_base??t.metadata?.cost_basis_base??t.base_value??0),new Decimal(0)).toNumber()};
}
