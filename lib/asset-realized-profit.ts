import DecimalJs from 'decimal.js';

const Decimal = DecimalJs.clone({precision: 48});
type Numeric = string | number;
type Identity = { user_id: string; organization_id: string | null };

export type AssetSale = Identity & {
  id: string;
  asset_account_id: string;
  transaction_date: string;
  transfer_id: string | null;
  quantity: Numeric;
  unit_price: Numeric | null;
  gross_value: Numeric;
  base_value: Numeric;
  base_currency: string;
  currency: string;
  metadata: {
    asset_deleted?: boolean;
    lifecycle_reversed?: boolean;
    sale_correction_replacement_id?: string;
    lot_sale_request?: string;
    proceeds_account_id?: string;
    financial_event_id?: string;
    cost_basis_base?: Numeric;
    vat_amount?: Numeric;
  } | null;
};

export type SaleAllocation = {
  transaction_id: string;
  quantity: Numeric;
  value_base: Numeric;
  lots: (Identity & { asset_account_id: string }) | null;
};

export type SaleReceipt = Identity & {
  id: string;
  asset_account_id: string;
  transaction_date: string;
  transfer_id: string | null;
  base_value: Numeric;
  base_currency: string;
  metadata: { sale_transaction_id: string; asset_deleted?: boolean; lifecycle_reversed?: boolean };
};

export type SalePosting = {
  id: string;
  transaction_id: string;
  asset_account_id: string;
  financial_event_id: string;
  organization_id: string;
  operation_date: string;
  applied_at: string | null;
  quantity: Numeric;
  amount: Numeric;
  book_effect: Numeric;
  vat_amount: Numeric;
  financial_events: { status: string; source_module: string; source_record_id: string; base_currency: string } | null;
};

export type RealizedProfit =
  | { status: 'recorded'; amount: string; currency: string }
  | { status: 'incomplete' };

function bySale<T>(items: T[], id: (item: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = id(item);
    const set = grouped.get(key);
    if (set) set.push(item);
    else grouped.set(key, [item]);
  }
  return grouped;
}

function nonnegative(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  try {
    const amount = new Decimal(value);
    return amount.isFinite() && amount.gte(0) ? amount : null;
  } catch {
    return null;
  }
}

export function summarizeRealizedProfit(input: {
  sales: AssetSale[];
  allocations: SaleAllocation[];
  receipts: SaleReceipt[];
  postings: SalePosting[];
  reversed: ReadonlySet<string>;
}) {
  const allocations = bySale(input.allocations, line => line.transaction_id);
  const receipts = bySale(input.receipts, row => row.metadata.sale_transaction_id);
  const postings = bySale(input.postings, row => row.transaction_id);
  const result = new Map<string, RealizedProfit>();

  function record(asset: string, currency: string, gain: DecimalJs | null) {
    const previous = result.get(asset);
    if (!gain || previous?.status === 'incomplete' || (previous && previous.currency !== currency)) {
      result.set(asset, {status: 'incomplete'});
      return;
    }
    result.set(asset, {status: 'recorded', amount: gain.plus(previous?.amount ?? 0).toString(), currency});
  }

  for (const sale of input.sales) {
    const metadata = sale.metadata ?? {};
    if (metadata.asset_deleted || metadata.lifecycle_reversed || metadata.sale_correction_replacement_id || input.reversed.has(sale.id)) continue;
    const proceeds = nonnegative(sale.base_value);
    const quantity = nonnegative(sale.quantity);
    if (sale.organization_id) {
      const candidates = postings.get(sale.id) ?? [];
      const command = candidates.length === 1 ? candidates[0] : null;
      const event = command?.financial_events;
      if (event?.status === 'REVERSED' || event?.status === 'CANCELLED') continue;
      const cost = nonnegative(command?.book_effect);
      const tax = nonnegative(command?.vat_amount);
      const verified = command?.applied_at && event?.status === 'ACTUAL' && event.source_module === 'ASSET_LIFECYCLE'
        && event.source_record_id === command.id && command.financial_event_id === metadata.financial_event_id
        && command.organization_id === sale.organization_id && command.asset_account_id === sale.asset_account_id
        && command.operation_date === sale.transaction_date && event.base_currency === sale.base_currency
        && sale.currency === sale.base_currency && proceeds?.eq(command.amount) && proceeds.eq(sale.gross_value)
        && quantity?.gt(0) && quantity.eq(command.quantity) && cost?.eq(nonnegative(metadata.cost_basis_base) ?? 'NaN')
        && tax?.eq(nonnegative(metadata.vat_amount) ?? 'NaN');
      // The lifecycle command records consideration before VAT and the posted book cost.
      record(sale.asset_account_id, sale.base_currency, verified ? proceeds!.minus(cost!) : null);
      continue;
    }

    const lines = allocations.get(sale.id) ?? [];
    const portions = new Map<string, {quantity: DecimalJs; cost: DecimalJs}>();
    let validLines = lines.length > 0;
    let totalQuantity = new Decimal(0);
    for (const line of lines) {
      const units = nonnegative(line.quantity);
      const cost = nonnegative(line.value_base);
      if (!line.lots || line.lots.user_id !== sale.user_id || line.lots.organization_id !== null || !units?.gt(0) || !cost) {
        validLines = false;
        continue;
      }
      const id = line.lots.asset_account_id;
      const current = portions.get(id);
      portions.set(id, {quantity: units.plus(current?.quantity ?? 0), cost: cost.plus(current?.cost ?? 0)});
      totalQuantity = totalQuantity.plus(units);
    }

    const linked = (receipts.get(sale.id) ?? []).filter(row => !row.metadata.asset_deleted);
    const receipt = linked.length === 1 ? linked[0] : null;
    const validReceipt = receipt && !receipt.metadata.lifecycle_reversed && !input.reversed.has(receipt.id)
      && receipt.user_id === sale.user_id && receipt.organization_id === null
      && receipt.asset_account_id === metadata.proceeds_account_id && receipt.transaction_date === sale.transaction_date
      && sale.transfer_id && receipt.transfer_id === sale.transfer_id && receipt.base_currency === sale.base_currency
      && proceeds?.gt(0) && proceeds.eq(receipt.base_value);
    const grouped = Boolean(metadata.lot_sale_request);
    const price = nonnegative(sale.unit_price);
    const reconciled = validLines && validReceipt && quantity?.gt(0) && totalQuantity.eq(quantity)
      && portions.has(sale.asset_account_id)
      && (grouped ? sale.currency === sale.base_currency && price?.gt(0)
        && price.times(quantity).toDecimalPlaces(8).eq(proceeds!) : portions.size === 1);
    if (!reconciled) {
      for (const id of new Set([sale.asset_account_id, ...portions.keys()])) record(id, sale.base_currency, null);
      continue;
    }

    // Apportion a grouped voucher once, reconciling rounding to the one saved receipt.
    let cumulativeQuantity = new Decimal(0), allocated = new Decimal(0);
    for (const [id, part] of [...portions].sort(([a], [b]) => a.localeCompare(b))) {
      cumulativeQuantity = cumulativeQuantity.plus(part.quantity);
      const next = grouped ? cumulativeQuantity.times(price!).toDecimalPlaces(8) : proceeds!;
      record(id, sale.base_currency, next.minus(allocated).minus(part.cost));
      allocated = next;
    }
  }
  return result;
}
