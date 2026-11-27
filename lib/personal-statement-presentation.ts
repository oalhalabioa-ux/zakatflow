import Decimal from 'decimal.js';
import {priorStatementPeriod, statementRowComparison} from './financial-statement-comparison';
import type {StatementTreeRow, StatementView} from './financial-statement-source';
import {STATEMENT_HUB_TITLES} from './financial-statement-summary';
import {personalCashActivityLabel, personalIncomeLabel} from './personal-financial-export';
import type {PersonalReport} from './personal-financial-reports';

const Money = Decimal.clone({precision: 50});
const sum = (values: string[]) => values.reduce((total, value) => total.plus(value), new Money(0)).toString();
type Label = (ar: string, en: string) => string;
export type PersonalStatementView = 'overview' | StatementView;

export function personalStatementComparison(current: PersonalReport, previous: PersonalReport | null) {
  if (!previous || previous.scope !== current.scope || previous.basis !== current.basis) return null;
  const expected = priorStatementPeriod(current.from, current.to);
  return previous.from === expected.from && previous.to === expected.to ? previous : null;
}

export function personalStatementCurrencies(report: PersonalReport, view: PersonalStatementView): string[] {
  if (view === 'overview') return [...new Set((['income','position','cash-flow'] as const)
    .flatMap(statement => personalStatementCurrencies(report, statement)))].sort();
  const currencies = view === 'income'
    ? [...report.recognizedIncome.map(row => row.currency), ...report.classifiedActivity?.rows.map(row => row.base_currency) ?? []]
    : view === 'cash-flow'
      ? [...report.cashAccounts.map(row => row.currency), ...report.cashByActivity.map(row => row.currency)]
      : report.to === report.asOf
        ? report.positions.map(row => row.currency)
        : [...report.historicalPosition.map(row => row.currency), ...report.historicalAssetValuations?.map(row => row.currency) ?? [],
           ...report.cutoffSources?.rows.map(row => row.currency) ?? []];
  return [...new Set(currencies)].sort();
}

export function personalStatementRows(report: PersonalReport, view: PersonalStatementView, currency: string, en: boolean): StatementTreeRow[] {
  if (!personalStatementCurrencies(report, view).includes(currency)) return [];
  const t: Label = (ar, english) => en ? english : ar;
  switch (view) {
    case 'overview':
      return ([
        ['income',['net']], ['position',['assets','liabilities','net-worth']], ['cash-flow',['closing']],
      ] as const).flatMap(([statement,ids]) => personalStatementRows(report,statement,currency,en)
        .filter(row => (ids as readonly string[]).includes(row.id)));
    case 'income': return incomeRows(report, currency, en, t);
    case 'position': return positionRows(report, currency, t);
    case 'cash-flow': return cashRows(report, currency, en, t);
  }
}

function incomeRows(report: PersonalReport, currency: string, en: boolean, t: Label): StatementTreeRow[] {
  const documents = report.classifiedActivity?.rows.filter(row => row.base_currency === currency) ?? [];
  const contracts = report.recognizedIncome.filter(row => row.currency === currency);
  const sides = (['INCOME', 'EXPENSE'] as const).map(side => {
    const groups = new Map<string, {label: string; entries: StatementTreeRow[]}>();
    const add = (key: string, label: string, id: string, date: string, value: string, reference: string) => {
      const groupId = side + ':' + key;
      const group = groups.get(groupId) ?? {label, entries: []};
      group.entries.push({id, label: date, value, note: reference, parentId: groupId, kind: 'detail'});
      groups.set(groupId, group);
    };
    for (const row of documents.filter(row => row.kind === side))
      add('classification:' + row.category_code, row.category_code, 'document:' + row.transaction_id, row.entry_date, row.base_amount,
        [row.amount + ' ' + row.currency, row.document_id, row.transaction_id].join(' · '));
    for (const row of contracts.filter(row => row.category.endsWith('_' + side)))
      add(row.category, personalIncomeLabel(row.category, en), 'contract:' + row.id, row.date, row.amount, row.id);
    const base: StatementTreeRow[] = [];
    const totals: string[] = [];
    for (const [id, group] of groups) {
      const subtotal = sum(group.entries.map(row => row.value));
      totals.push(subtotal);
      base.push({id, label: group.label, value: subtotal, kind: 'parent', parentId: side}, ...group.entries);
    }
    const total = totals.length ? sum(totals) : '';
    return {total, rows: [{
      id: side, label: side === 'INCOME' ? t('الإيرادات المثبتة', 'Verified income') : t('المصروفات المثبتة', 'Verified expenses'),
      value: total, kind: 'parent', icon: side === 'INCOME' ? 'coins' : 'layers',
      note: total ? undefined : t('لا توجد بنود مثبتة لهذا القسم', 'No verified items in this section'),
    }, ...base]};
  });
  const [income, expense] = sides;
  return [...income.rows, ...expense.rows, {
    id: 'net', label: t('صافي البنود المثبتة', 'Net of verified items'),
    value: new Money(income.total || '0').minus(expense.total || '0').toString(), kind: 'total', icon: 'coins',
    note: t('تغطية جزئية لتصنيف الإيرادات والمصروفات', 'Partial income and expense coverage'),
  }];
}

function positionRows(report: PersonalReport, currency: string, t: Label): StatementTreeRow[] {
  const current = report.to === report.asOf ? report.positions.find(row => row.currency === currency) : undefined;
  const history = report.to < report.asOf ? report.historicalPosition.find(row => row.currency === currency) : undefined;
  const unavailable = t('الرصيد غير مثبت بتاريخ القطع', 'Balance unverified at the cutoff');
  const partly = t('التقييم التاريخي متاح للأصول المثبتة أدناه', 'Historical valuations are limited to the verified assets below');
  const data = (id: string, label: string, value: string | null | undefined, parentId?: string, note?: string): StatementTreeRow =>
    ({id, label, value: value ?? '', kind: parentId ? 'detail' : 'total', parentId, note: note ?? (value == null ? unavailable : undefined)});
  const assets = current ? sum([current.cash, current.receivables, current.investments, current.otherAssets]) : null;
  const rows = [
    data('assets', t('إجمالي الأصول', 'Total assets'), assets),
    data('cash', t('النقد والبنوك', 'Cash and banks'), current?.cash ?? history?.cash, 'assets'),
    data('receivables', t('الذمم المدينة', 'Receivables'), current?.receivables ?? history?.receivables, 'assets'),
    data('investments', t('الاستثمارات', 'Investments'), current?.investments, 'assets'),
    data('other-assets', t('الأصول الأخرى', 'Other assets'), current?.otherAssets, 'assets'),
    data('liabilities', t('إجمالي الالتزامات', 'Total liabilities'), current?.liabilities),
    data('net-worth', t('صافي الثروة', 'Net worth'), current?.netWorth),
  ];
  if (current) {
    for (const kind of ['ASSET','LIABILITY'] as const) {
      const section = kind === 'ASSET' ? 'assets' : 'liabilities';
      const details = report.categories.filter(row => row.kind === kind && row.currency === currency);
      if (!details.length) continue;
      rows.push({id:'register:' + section, label:t('تصنيفات السجل الشخصي', 'Personal register categories'), value:'',
        kind:'section', note:t('تفصيل أرصدة القائمة', 'Supporting balance breakdown')});
      for (const row of details) rows.push(data('register:' + row.id, t(row.ar,row.en), row.amount, 'register:' + section, row.code));
    }
  } else {
    rows.splice(3, 0, data('paid-advances', t('الدفعات المقدمة', 'Advances paid'), history?.supplierAdvances, 'assets'));
    rows.splice(rows.length - 1, 0, data('payables', t('الذمم الدائنة', 'Payables'), history?.liabilities, 'liabilities'),
      data('received-advances', t('الدفعات المستلمة مقدمًا', 'Advances received'), history?.customerAdvances, 'liabilities'));
  }
  const valuations = report.historicalAssetValuations?.filter(row => row.currency === currency && row.date === report.to) ?? [];
  if (valuations.length) {
    rows.push({id:'valuations', label:t('تقييمات الأصول بتاريخ القطع', 'Asset valuations at cutoff'), kind:'section', value:'', note:partly});
    for (const row of valuations) rows.push(data('valuation:' + row.id, row.name, row.market, 'valuations',
      [t('التكلفة الدفترية', 'Carrying cost'), row.cost, row.source].join(' · ')));
  }
  const debts = report.cutoffSources?.asOf === report.to ? report.cutoffSources.rows.filter(row => row.currency === currency) : [];
  if (debts.length) {
    rows.push({id:'debt-evidence', label:t('أدلة الذمم من V2', 'V2 debt evidence'), kind:'section', value:'',
      note:t('أرصدة مصادر جزئية', 'Partial source balances')});
    for (const row of debts) rows.push(data('debt:' + row.id, row.side === 'RECEIVABLE' ? t('ذمة مدينة', 'Receivable') : t('ذمة دائنة', 'Payable'),
      row.balance, 'debt-evidence', [row.id, row.gap ?? row.source].join(' · ')));
  }
  return rows;
}

function cashRows(report: PersonalReport, currency: string, en: boolean, t: Label): StatementTreeRow[] {
  const accounts = report.cashAccounts.filter(row => row.currency === currency);
  const activities = report.cashByActivity.filter(row => row.currency === currency);
  const transfers = report.cashTransferReconciliation.find(row => row.currency === currency);
  const value = (key: 'opening' | 'netMovement' | 'closing') => accounts.length ? sum(accounts.map(row => row[key])) : '';
  const rows: StatementTreeRow[] = [{id:'opening', label:t('النقد أول الفترة', 'Opening cash'), value:value('opening'), kind:'detail'}];
  for (const activity of ['OPERATING', 'INVESTING', 'FINANCING', 'UNCLASSIFIED'] as const) {
    const entry = activities.find(row => row.activity === activity);
    rows.push({id:activity, label:personalCashActivityLabel(activity, en), value:entry?.net ?? '', kind:'parent',
      note:entry ? undefined : t('لا توجد حركات مثبتة في هذا النشاط', 'No verified movements for this activity')});
    if (entry) rows.push(
      {id:activity + ':in', label:t('مقبوضات', 'Receipts'), value:entry.inflows, kind:'detail', parentId:activity},
      {id:activity + ':out', label:t('مدفوعات', 'Payments'), value:entry.outflows, kind:'detail', parentId:activity});
  }
  rows.push(
    {id:'movement', label:t('صافي التغيّر في النقد', 'Net change in cash'), value:value('netMovement'), kind:'subtotal',
      note:transfers?.unverifiedLegs ? t('توجد أطراف تحويل تحتاج مطابقة', 'Some transfer legs require reconciliation') : undefined},
    {id:'closing', label:t('النقد آخر الفترة', 'Closing cash'), value:value('closing'), kind:'total'});
  for (const account of accounts) rows.push({id:'account:' + account.id, label:account.name, value:account.closing, kind:'detail', parentId:'closing'});
  if (transfers?.verifiedPairs) rows.push(
    {id:'matched-transfers', label:t('إيضاح التحويلات الداخلية المطابقة', 'Matched internal transfers'), value:'', kind:'section'},
    {id:'matched-transfers-in', label:t('التحويلات الداخلة', 'Internal receipts'), value:transfers.verifiedInternalInflows, kind:'detail', parentId:'matched-transfers'},
    {id:'matched-transfers-out', label:t('التحويلات الخارجة', 'Internal payments'), value:transfers.verifiedInternalOutflows, kind:'detail', parentId:'matched-transfers'});
  const funding = report.purchaseFunding?.filter(row => row.baseCurrency === currency) ?? [];
  if (funding.length) rows.push({id:'funding', label:t('فرق الصرف المحقق من تمويل شراء الأصول', 'Realized FX on funded asset purchases'), value:'', kind:'section',
    note:t('إيضاح لقيمة التمويل وتكلفة الدفعات', 'Disclosure of funding amounts and cash lot costs')},
    ...funding.map(row => ({
      id:'funding:' + row.id, label:row.reversed ? t('عكس تمويل الشراء', 'Purchase funding reversal') : t('تمويل الشراء', 'Purchase funding'),
      value:row.realizedFx, kind:'detail', parentId:'funding',
      note:[row.date, row.payment + ' ' + row.currency, t('تكلفة الأصل', 'Asset cost') + ' ' + row.assetBasis,
        t('تكلفة النقد', 'Cash lot cost') + ' ' + row.cashBasis, row.id].join(' · '),
    })));
  return rows;
}

export function personalStatementExport(report: PersonalReport, view: PersonalStatementView, en: boolean, comparison: PersonalReport | null) {
  const t: Label = (ar, english) => en ? english : ar;
  const validComparison = personalStatementComparison(report, comparison);
  const currencyList = personalStatementCurrencies(report, view);
  const output = [
    [t('النطاق', 'Scope'), t('شخصي', 'Personal')],
    [t('التقرير', 'Report'), STATEMENT_HUB_TITLES[view][en ? 1 : 0]],
    [t('الفترة الحالية', 'Current period'), report.from, report.to],
    ...(validComparison ? [[t('الفترة السابقة', 'Previous period'), validComparison.from, validComparison.to]] : []),
    [t('المصدر', 'Source'), t('السجلات الشخصية', 'Personal registers')],
  ];
  let hasFigures = false;
  for (const currency of currencyList) {
    const rows = personalStatementRows(report, view, currency, en);
    const previous = validComparison ? personalStatementRows(validComparison, view, currency, en) : [];
    const index = new Map(previous.map(row => [row.id, row]));
    hasFigures ||= rows.some(row => row.value !== '');
    output.push([], [t('العملة', 'Currency'), currency], [t('البند', 'Item'), t('إيضاح', 'Note'), t('الفترة الحالية', 'Current period'),
      t('الفترة السابقة', 'Previous period'), t('التغير', 'Change'), t('نسبة التغير', 'Change %')]);
    for (const row of rows) {
      const {before, change} = statementRowComparison(row.value, index.get(row.id)?.value, true);
      output.push([row.label, row.note ?? '', row.value, before ?? '', change?.delta ?? '', change?.percentage ?? '']);
    }
  }
  if (!hasFigures) throw Error('PERSONAL_EXPORT_DATA_REQUIRED');
  if (output.length > 25_000) throw Error('PERSONAL_EXPORT_TOO_LARGE');
  return output;
}
