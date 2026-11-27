import Decimal from 'decimal.js';

const Money = Decimal.clone({precision: 40});
const zero = () => new Money(0);
const tolerance = new Money('0.000001');
type Numeric = string | number;
export type FixedAssetRecord = {
 id: string; name: string; organization_id: string | null; entity_id: string | null; cost_center_id: string | null;
 asset_class_code: string | null; asset_type: string; asset_type_code: string | null;
};
export type FixedLot = {
 id: string; asset_account_id: string; original_quantity: Numeric; remaining_quantity: Numeric;
 original_value_base: Numeric; remaining_value_base: Numeric; acquisition_date: string;
 metadata: {recognition_pending?: boolean; base_currency?: string};
 source: {id: string; transaction_type: string; base_currency: string; metadata: {asset_deleted?: boolean}} | null;
};
type LotState = {id: string; quantity: Numeric; after_quantity: Numeric; value: Numeric; after_value: Numeric};
export type FixedOperation = {
 id: string; asset_account_id: string; transaction_date: string; transaction_type: string; base_currency: string;
 base_value: Numeric; reference: string | null; created_at: string; reversal_of_transaction_id: string | null;
 metadata: {operation?: string; reason?: string; disposed_cost_base?: Numeric; lifecycle_reversed?: boolean; asset_deleted?: boolean; financial_event_id?: string;
  asset_effect_base?: Numeric; cost_basis_base?: Numeric; realized_gain_base?: Numeric};
};
export type FixedCommand = {id: string; transaction_id: string; applied_at: string; lot_states: LotState[]};
type DepreciationEvidence = {balance: Decimal; valid: boolean};
export type FixedReport = ReturnType<typeof buildFixedAssetReport>;

const keys = ['gross', 'accumulated', 'book', 'depreciation', 'maintenance', 'improvements'] as const;
export type FixedMetric = typeof keys[number];
export type FixedState = 'ACTIVE' | 'EXITED' | 'PENDING' | 'UNVERIFIED';

export function fixedReportToday() {
 return new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
}

function groupByAsset<T extends {asset_account_id: string}>(rows: T[]) {
 const groups = new Map<string, T[]>();
 for (const row of rows) {
  const group = groups.get(row.asset_account_id) ?? [];
  group.push(row);
  groups.set(row.asset_account_id, group);
 }
 return groups;
}

function operationKind(tx: FixedOperation) {
 const kind = tx.metadata.operation ?? (tx.metadata.reason === 'DISPOSAL_ZERO_VALUE' ? 'DISPOSAL' : tx.transaction_type);
 return kind === 'SALE' || kind === 'DISPOSAL' || kind === 'DEPRECIATION' ? kind : null;
}

function lotDepreciation(operations: FixedOperation[], commands: Map<string, FixedCommand>, exitLots?: Map<string, FixedLot>) {
 const amounts = new Map<string, DepreciationEvidence>();
 const exits = new Map<string, {gross: string; accumulated: string}>();
 const ordered = operations.flatMap(tx => {
  const command = commands.get(tx.id);
  const kind = operationKind(tx);
  return command && kind ? [{tx, kind, command}] : [];
 }).sort((a, b) => a.command.applied_at.localeCompare(b.command.applied_at) || a.command.id.localeCompare(b.command.id));
 for (const {tx, kind, command} of ordered) {
  if (!Array.isArray(command.lot_states)) continue;
  const isExit = kind !== 'DEPRECIATION';
  let removedGross = zero(), removedDepreciation = zero(), removedBook = zero();
  let complete = Boolean(exitLots && isExit && command.lot_states.length);
  let removedQuantity = zero();
  const seen = new Set<string>();
  for (const state of command.lot_states) {
   const amount = amounts.get(state.id) ?? {balance: zero(), valid: true};
   const quantity = new Money(state.quantity);
   const afterQuantity = new Money(state.after_quantity);
   const valueChange = new Money(state.value).sub(state.after_value);
   if (seen.has(state.id) || quantity.lte(0) || afterQuantity.lt(0) || afterQuantity.gt(quantity) || valueChange.lt(0)) {
    amount.valid = false;
    complete = false;
   } else if (!isExit) {
    if (!afterQuantity.eq(quantity)) amount.valid = false;
    amount.balance = amount.balance.add(valueChange);
   } else {
    const fraction = quantity.sub(afterQuantity).div(quantity);
    const depreciation = amount.balance.mul(fraction);
    if (exitLots && complete && fraction.gt(0)) {
     removedQuantity = removedQuantity.add(quantity.sub(afterQuantity));
     const lot = exitLots.get(state.id);
     const gross = lot?.source?.transaction_type === 'PURCHASE' && lot.source.base_currency === tx.base_currency
       && new Money(lot.original_quantity).gte(quantity)
      ? new Money(lot.original_value_base).mul(quantity).div(lot.original_quantity) : null;
     if (!gross || !amount.valid || gross.lt(amount.balance)
       || gross.sub(amount.balance).sub(state.value).abs().gt(tolerance)
       || gross.mul(fraction).sub(depreciation).sub(valueChange).abs().gt(tolerance)) {
      complete = false;
     } else {
      removedGross = removedGross.add(gross.mul(fraction));
      removedDepreciation = removedDepreciation.add(depreciation);
      removedBook = removedBook.add(valueChange);
     }
    }
    amount.balance = amount.balance.sub(depreciation);
   }
   seen.add(state.id);
   amounts.set(state.id, amount);
  }
  const exitBook = complete ? exitBookValue(tx) : null;
  if (exitBook != null && removedQuantity.gt(0) && removedBook.sub(exitBook).abs().lte(tolerance)) {
   exits.set(tx.id, {gross: removedGross.toDecimalPlaces(8).toString(), accumulated: removedDepreciation.toDecimalPlaces(8).toString()});
  }
 }
 return {amounts, exits};
}

function exitBookValue(tx: FixedOperation) {
 const effect = tx.metadata.asset_effect_base;
 return tx.metadata.cost_basis_base ?? tx.metadata.disposed_cost_base ?? (effect == null ? null : new Money(effect).negated().toString());
}

function balances(lots: FixedLot[], evidence: Map<string, DepreciationEvidence>, currency: string) {
 let gross = zero(), book = zero(), accumulated = zero();
 let splitKnown = true, bookKnown = true;
 for (const lot of lots) {
  const remaining = new Money(lot.remaining_quantity);
  const carrying = new Money(lot.remaining_value_base);
  if (remaining.isZero() && carrying.isZero()) continue;
  if ((lot.source?.base_currency ?? lot.metadata.base_currency) !== currency) bookKnown = false;
  book = book.add(carrying);
  const original = new Money(lot.original_quantity);
  if (lot.source?.transaction_type !== 'PURCHASE' || original.lte(0) || remaining.lte(0) || remaining.gt(original)) {
   splitKnown = false;
   continue;
  }
  const lotGross = new Money(lot.original_value_base).mul(remaining).div(original);
  const depreciation = evidence.get(lot.id);
  const booked = depreciation?.balance ?? zero();
  if (depreciation?.valid === false || lotGross.sub(booked).sub(carrying).abs().gt(tolerance)) splitKnown = false;
  gross = gross.add(lotGross);
  accumulated = accumulated.add(booked);
 }
 return {
  gross: bookKnown && splitKnown ? gross.toDecimalPlaces(8).toString() : null,
  accumulated: bookKnown && splitKnown ? accumulated.toDecimalPlaces(8).toString() : null,
  book: bookKnown ? book.toString() : null,
 };
}

export function buildFixedAssetReport(input: {
 assets: FixedAssetRecord[]; lots: FixedLot[]; operations: FixedOperation[]; commands: FixedCommand[];
 currencies: Map<string | null, string>; personal: boolean; from: string; to: string;
 view: 'register' | 'depreciation' | 'exits'; offset: number; limit: number;
 sort: 'name' | 'acquisition'; order: 'asc' | 'desc'; state?: FixedState;
}) {
 const lots = groupByAsset(input.lots);
 const recorded = input.operations.filter(tx => !tx.metadata.asset_deleted && !tx.metadata.lifecycle_reversed);
 const reversed = new Set(recorded.flatMap(tx => tx.reversal_of_transaction_id ? [tx.reversal_of_transaction_id] : []));
 const liveOperations = recorded.filter(tx =>
  !tx.reversal_of_transaction_id && !reversed.has(tx.id));
 const operations = groupByAsset(liveOperations);
 const commands = new Map(input.commands.map(row => [row.transaction_id, row]));
 const rows = [], movements = [];
 for (const asset of input.assets) {
  const currency = input.currencies.get(asset.organization_id);
  if (!currency) throw Error('FIXED_ASSET_BASE_CURRENCY');
  const allLots = lots.get(asset.id) ?? [];
  const recognized = allLots.filter(lot => !lot.metadata.recognition_pending && !lot.source?.metadata.asset_deleted);
  const assetOperations = operations.get(asset.id) ?? [];
  const exitLots = !input.personal && input.view === 'exits' ? new Map(recognized.map(lot => [lot.id, lot])) : undefined;
  const evidence = lotDepreciation(assetOperations, commands, exitLots);
  const current = recognized.length ? balances(recognized, evidence.amounts, currency) : {gross: null, accumulated: null, book: null};
  const first = recognized.reduce<FixedLot | null>((earliest, lot) =>
   !earliest || lot.acquisition_date < earliest.acquisition_date ? lot : earliest, null);
  const state = recognized.length === 0 ? (allLots.some(lot => lot.metadata.recognition_pending) ? 'PENDING' : 'UNVERIFIED')
   : recognized.some(lot => new Money(lot.remaining_quantity).gt(0)) ? 'ACTIVE' : 'EXITED';
  if (input.state && state !== input.state) continue;
  const quantity = recognized.length ? recognized.reduce((sum, lot) => sum.add(lot.remaining_quantity), zero()).toString() : null;
  rows.push({id: asset.id, name: asset.name, currency, organization: asset.organization_id, entity: asset.entity_id,
   classCode: asset.asset_class_code ?? 'LEGACY_REAL_ESTATE', typeCode: asset.asset_type_code,
   acquisition: first?.acquisition_date ?? null, sourceId: first?.source?.id ?? null, state, quantity, ...current, accumulated: input.personal ? null : current.accumulated} as const);
  for (const tx of assetOperations) {
   const kind = operationKind(tx);
   if (!kind || tx.transaction_date < input.from || tx.transaction_date > input.to) continue;
   const matchingCurrency = tx.base_currency === currency;
   const effect = tx.metadata.asset_effect_base;
   // Lifecycle commands only populate transaction_id after posting; keep uncovered effects unknown.
   const posted = input.personal || commands.has(tx.id);
   const cost = kind === 'DEPRECIATION' ? (effect == null ? null : new Money(effect).negated().toString())
    : exitBookValue(tx);
   const split = matchingCurrency ? evidence.exits.get(tx.id) : undefined;
   movements.push({id: tx.id, assetId: asset.id, assetName: asset.name, reference: tx.reference, kind,
    date: tx.transaction_date, currency, organization: asset.organization_id, posted,
    removedGross: split?.gross ?? null, removedDepreciation: split?.accumulated ?? null,
    cost: posted && matchingCurrency && cost != null ? String(cost) : null,
    proceeds: posted && matchingCurrency && kind === 'SALE' ? String(tx.base_value) : null,
    gain: posted && matchingCurrency && tx.metadata.realized_gain_base != null ? String(tx.metadata.realized_gain_base) : null,
   });
  }
 }
 const groups = new Map<string, typeof rows>();
 for (const row of rows) {
  const group = groups.get(row.currency) ?? [];
  group.push(row);
  groups.set(row.currency, group);
 }
 for (const currency of new Set(input.currencies.values())) if (!groups.has(currency)) groups.set(currency, []);
 const periodTotals = new Map<string, {total: Decimal; complete: boolean}>();
 for (const movement of movements) {
  if (movement.kind !== 'DEPRECIATION') continue;
  const total = periodTotals.get(movement.currency) ?? {total: zero(), complete: true};
  if (!movement.posted || movement.cost == null) total.complete = false;
  else total.total = total.total.add(movement.cost);
  periodTotals.set(movement.currency, total);
 }
 const summary = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, group]) => {
  const recognized = group.filter(row => row.state === 'ACTIVE' || row.state === 'EXITED');
  function sum(key: 'gross' | 'accumulated' | 'book') {
   if (group.some(row => row.state === 'UNVERIFIED') || recognized.some(row => row[key] == null)) return null;
   return recognized.reduce((amount, row) => amount.add(row[key]!), zero()).toString();
  }
  const period = periodTotals.get(currency);
  return {currency, registered: group.length, recognized: recognized.length, gross: sum('gross'), accumulated: input.personal ? null : sum('accumulated'),
   book: sum('book'), depreciation: input.personal || period?.complete === false ? null : period?.total.toString() ?? '0',
   maintenance: null, improvements: null};
 });
 const movementRows = movements.filter(row => input.view === 'depreciation' ? row.kind === 'DEPRECIATION' : row.kind !== 'DEPRECIATION')
  .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
 const direction = input.order === 'desc' ? -1 : 1;
 const register = rows.sort((a, b) => {
  const timeOrder = input.sort === 'acquisition' ? (a.acquisition ?? '').localeCompare(b.acquisition ?? '') : 0;
  return (timeOrder || a.name.localeCompare(b.name, undefined, {numeric: true}) || a.id.localeCompare(b.id)) * direction;
 });
 const page = input.view === 'register' ? register : movementRows;
 return {summary, total: page.length, register: input.view === 'register' ? rows.slice(input.offset, input.offset + input.limit) : [],
  movements: input.view === 'register' ? [] : movementRows.slice(input.offset, input.offset + input.limit)};
}
