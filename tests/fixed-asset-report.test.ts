import {describe, expect, it} from 'vitest';
import {buildFixedAssetReport, type FixedAssetRecord, type FixedCommand, type FixedLot, type FixedOperation} from '../lib/fixed-asset-report';

const asset = (id: string, organization: string | null = 'org'): FixedAssetRecord => ({
 id, name: id, organization_id: organization, entity_id: null, cost_center_id: null,
 asset_class_code: 'PPE', asset_type: 'OTHER', asset_type_code: 'MACHINERY',
});
const lot = (id: string, original: string, book: string, change: Partial<FixedLot> = {}): FixedLot => ({
 id, asset_account_id: id, original_quantity: '1', remaining_quantity: '1',
 original_value_base: original, remaining_value_base: book, acquisition_date: '2026-01-01',
 metadata: {}, source: {id: `purchase-${id}`, transaction_type: 'PURCHASE', base_currency: 'SAR', metadata: {}}, ...change,
});
const operation = (id: string, assetId: string, date: string, kind: string, extra: FixedOperation['metadata']): FixedOperation => ({
 id, asset_account_id: assetId, transaction_date: date, transaction_type: kind === 'SALE' ? 'SALE' : 'ADJUSTMENT',
 base_value: kind === 'SALE' ? '25000' : '0', base_currency: 'SAR', created_at: date, reference: null,
 reversal_of_transaction_id: null, metadata: {operation: kind, ...extra},
});
const posted = (tx: FixedOperation, before: string, after: string, quantity = '1', remaining = '1'): FixedCommand => ({
 id: `command-${tx.id}`, transaction_id: tx.id, applied_at: tx.transaction_date,
 lot_states: [{id: tx.asset_account_id, quantity, after_quantity: remaining, value: before, after_value: after}],
});
const build = (overrides: Partial<Parameters<typeof buildFixedAssetReport>[0]>) => buildFixedAssetReport({
 assets: [], lots: [], operations: [], commands: [], personal: false,
 from: '2026-01-01', to: '2026-12-31', currencies: new Map([['org', 'SAR']]),
 view: 'register', offset: 0, limit: 25, sort: 'name', order: 'asc', ...overrides,
});

describe('fixed asset report read model', () => {
 it('reconciles the approved cost, depreciation and net book example to posted lot states', () => {
  const monthly = Array.from({length: 12}, (_, index) =>
   operation(`equip-${index}`, 'equipment', `2026-${String(index + 1).padStart(2, '0')}-01`, 'DEPRECIATION', {asset_effect_base: '-1800'}));
  const car = operation('car-dep', 'car', '2025-12-31', 'DEPRECIATION', {asset_effect_base: '-20000'});
  const furniture = operation('furniture-dep', 'furniture', '2025-12-31', 'DEPRECIATION', {asset_effect_base: '-30000'});
  const report = build({
   assets: ['equipment', 'car', 'furniture', 'land'].map(id => asset(id)),
   lots: [lot('equipment', '120000', '98400'), lot('car', '100000', '80000'), lot('furniture', '50000', '20000'), lot('land', '200000', '200000')],
   operations: [...monthly, car, furniture],
   commands: [...monthly.map((tx, index) => posted(tx, String(120000 - 1800 * index), String(120000 - 1800 * (index + 1)))),
    posted(car, '100000', '80000'), posted(furniture, '50000', '20000')],
  });
  expect(report.summary[0]).toMatchObject({gross: '470000', accumulated: '71600', book: '398400', depreciation: '21600',
   maintenance: null, improvements: null});
 });

 it('keeps an exited asset out of current balances and shows its sourced gain at the period cutoff', () => {
  const dep = operation('dep', 'equipment', '2025-12-31', 'DEPRECIATION', {asset_effect_base: '-60000'});
  const sale = operation('sale', 'equipment', '2026-06-01', 'SALE', {cost_basis_base: '20000', realized_gain_base: '5000'});
  const inputs = {
   assets: [asset('equipment')], lots: [lot('equipment', '80000', '0', {remaining_quantity: '0'})],
   operations: [dep, sale], commands: [posted(dep, '80000', '20000'), posted(sale, '20000', '0', '1', '0')],
  };
  const report = build({...inputs, view: 'exits', to: '2026-06-01'});
  expect(report.summary[0]).toMatchObject({gross: '0', accumulated: '0', book: '0', depreciation: '0'});
  expect(report.movements[0]).toMatchObject({cost: '20000', proceeds: '25000', gain: '5000', posted: true});
  expect(build({...inputs, view: 'exits', to: '2026-05-31'}).movements).toEqual([]);
 });

 it('allocates accumulated depreciation on partial sale and excludes a reversed posting', () => {
  const dep = operation('dep', 'equipment', '2026-01-01', 'DEPRECIATION', {asset_effect_base: '-60000'});
  const sale = operation('sale', 'equipment', '2026-02-01', 'SALE', {cost_basis_base: '10000'});
  const reversed = operation('reversed', 'equipment', '2026-03-01', 'DEPRECIATION', {asset_effect_base: '-6000', lifecycle_reversed: true});
  const report = build({assets: [asset('equipment')],
   lots: [lot('equipment', '80000', '10000', {remaining_quantity: '0.5'})],
   operations: [dep, sale, reversed], commands: [posted(dep, '80000', '20000'), posted(sale, '20000', '10000', '1', '0.5'), posted(reversed, '10000', '4000', '0.5', '0.5')],
   view: 'depreciation'});
  expect(report.summary[0]).toMatchObject({gross: '40000', accumulated: '30000', book: '10000', depreciation: '60000'});
  expect(report.movements.map(row => row.id)).toEqual(['dep']);
 });

 it('keeps opening splits unknown, excludes pending balances and groups currencies independently', () => {
  const legacy = lot('opening', '5000', '5000');
  legacy.source!.transaction_type = 'OPENING_BALANCE';
  const foreign = lot('foreign', '1000', '1000');
  foreign.source!.base_currency = 'USD';
  const report = build({assets: [asset('opening'), asset('pending'), asset('foreign', 'foreign-org')],
   currencies: new Map([['org', 'SAR'], ['foreign-org', 'USD']]),
   lots: [legacy, lot('pending', '12000', '12000', {metadata: {recognition_pending: true}}), foreign]});
  expect(report.summary).toMatchObject([
   {currency: 'SAR', gross: null, accumulated: null, book: '5000', recognized: 1, registered: 2},
   {currency: 'USD', gross: '1000', accumulated: '0', book: '1000', recognized: 1},
  ]);
 });

 it('does not turn unexplained reductions into booked depreciation', () => {
  const report = build({assets: [asset('unexplained')], lots: [lot('unexplained', '900', '800')]});
  expect(report.register[0]).toMatchObject({gross: null, accumulated: null, book: '800'});
 });

 it('preserves the personal disposal cost, withholds estimates, and pages the register', () => {
  const ids = Array.from({length: 34}, (_, index) => `asset-${index}`);
  const dispose = {...operation('out', ids[0], '2026-03-01', 'ADJUSTMENT', {reason: 'DISPOSAL_ZERO_VALUE', disposed_cost_base: '900'}),
   metadata: {reason: 'DISPOSAL_ZERO_VALUE', disposed_cost_base: '900'}};
  const inputs = {
   personal: true, assets: ids.map(id => asset(id, null)), currencies: new Map([[null, 'SAR']]),
   lots: ids.map((id, index) => lot(id, '900', index ? '900' : '0', {remaining_quantity: index ? '1' : '0'})),
   operations: [dispose],
  };
  const report = build({...inputs, offset: 25});
  expect(report.total).toBe(34);
  expect(report.register).toHaveLength(9);
  expect(report.summary[0]).toMatchObject({book: '29700', depreciation: null, accumulated: null});
  expect(build({...inputs, view: 'exits'}).movements[0]).toMatchObject({kind: 'DISPOSAL', cost: '900'});
 });
});
