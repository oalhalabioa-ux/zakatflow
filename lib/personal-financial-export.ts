import type {PersonalReport} from './personal-financial-reports';

export type PersonalExportView='overview'|'position'|'cash'|'accounts'|'income';

/** Export from one authorized snapshot. Never synthesize income or aggregate currencies. */
export function personalFinancialExportRows(report:PersonalReport,view:PersonalExportView,en:boolean):string[][]{
 if(report.scope!=='PERSONAL'||report.basis!=='CURRENT_PERSONAL_REGISTER_ESTIMATE')throw Error('PERSONAL_EXPORT_SCOPE_INVALID');
 if(!['overview','position','cash','accounts','income'].includes(view))throw Error('PERSONAL_EXPORT_VIEW_INVALID');
 const t=(ar:string,english:string)=>en?english:ar;
 const rows:string[][]=[
  [t('الجهة','Scope'),t('شخصي فقط','Personal only')],
  [t('أساس التقرير','Reporting basis'),'CURRENT_PERSONAL_REGISTER_ESTIMATE'],
  [t('حالة التقرير','Report status'),t('تقديري — غير مدقق','Estimate — not audited')],
  [t('تاريخ تقييم المركز المالي','Financial position valuation date'),report.asOf],
  [t('من تاريخ الحركة','Movement from'),report.from],
  [t('إلى تاريخ الحركة','Movement to'),report.to],
  [t('تنبيه','Warning'),t('لا تجمع العملات المختلفة ولا تعتبر التحويلات إيرادات أو مصروفات.','Do not aggregate different currencies or treat transfers as income/expenses.')],
  [],
 ];
 if(view==='overview'||view==='position'){
  rows.push([t('المركز المالي حسب العملة','Financial position by currency')]);
  rows.push([t('العملة','Currency'),t('النقد والبنوك','Cash'),t('الذمم المدينة','Receivables'),t('استثمارات','Investments'),t('أصول أخرى','Other assets'),t('الالتزامات','Liabilities'),t('صافي الثروة','Net worth'),t('حالة التسوية','Reconciliation')]);
  for(const p of report.positions)rows.push([p.currency,p.cash,p.receivables,p.investments,p.otherAssets,p.liabilities,p.complete&&p.netWorth!==null?p.netWorth:'',p.complete?t('متاح','Available'):t('غير مكتمل — صافي الثروة محجوب','Incomplete — net worth withheld')]);
 }
 if((view==='overview'||view==='position')&&report.historicalPosition?.length){
  rows.push([],[t('أرصدة نقدية وذمم تاريخية متحقق منها','Verified historical monetary balances'),report.to]);
  rows.push([t('العملة','Currency'),t('النقد','Cash'),t('الذمم المدينة','Receivables'),t('الالتزامات','Liabilities'),
   t('الدفعات المقدمة','Advances paid'),t('الدفعات المستلمة مقدمًا','Advances received')]);
  for(const p of report.historicalPosition)rows.push([p.currency,p.cash??'',p.receivables??'',p.liabilities??'',p.supplierAdvances??'',p.customerAdvances??'']);
 }
 if((view==='overview'||view==='position')&&report.historicalAssetValuations?.length){
  rows.push([],[t('تقييمات أصول مثبتة بتاريخ القطع · تغطية جزئية','Asset valuations verified at the cutoff · partial coverage'),report.to]);
  rows.push([t('الأصل','Asset'),t('العملة','Currency'),t('التكلفة الدفترية','Carrying cost'),t('قيمة التقييم المسجّلة','Recorded valuation'),t('المصدر','Source')]);
  for(const row of report.historicalAssetValuations)rows.push([row.name,row.currency,row.cost,row.market,row.source]);
 }
 if((view==='overview'||view==='position')&&report.cutoffSources?.rows.length){
  rows.push([],[t('أدلة ذمم V2 بتاريخ القطع · تغطية جزئية','V2 debt evidence at cutoff · partial coverage'),report.cutoffSources.asOf]);
  rows.push([t('المصدر','Source'),t('الطبيعة','Side'),t('العملة','Currency'),t('الرصيد','Balance'),t('الفجوة','Gap')]);
  for(const row of report.cutoffSources.rows)rows.push([row.id,row.side,row.currency,row.balance??'',row.gap??'']);
 }
 if(view==='overview'||view==='cash'){
  rows.push([],[t('حركة الحسابات النقدية — ليست قائمة تدفقات نقدية معيارية','Cash-account activity — not a statutory cash-flow statement')]);
  rows.push([t('الحساب','Account'),t('العملة','Currency'),t('أول الفترة','Opening'),t('المقبوضات الإجمالية','Gross inflows'),t('المدفوعات الإجمالية','Gross outflows'),t('صافي الحركة','Net movement'),t('آخر الفترة','Closing')]);
  for(const a of report.cashAccounts)rows.push([a.name,a.currency,a.opening,a.inflows,a.outflows,a.netMovement,a.closing]);
  if(report.cashTransferReconciliation?.length){
   rows.push([],[t('تسوية التحويلات المثبتة بمعرّف المصدر','Source-ID transfer reconciliation')]);
   rows.push([t('العملة','Currency'),t('التحويلات الداخلة المثبتة','Verified internal inflows'),t('التحويلات الخارجة المثبتة','Verified internal outflows'),t('المقبوضات المتبقية','Remaining inflows'),t('المدفوعات المتبقية','Remaining outflows'),t('الأزواج المثبتة','Verified pairs'),t('الأطراف غير المثبتة','Unverified legs')]);
   for(const a of report.cashTransferReconciliation)rows.push([a.currency,a.verifiedInternalInflows,a.verifiedInternalOutflows,a.remainingUnclassifiedInflows,a.remainingUnclassifiedOutflows,String(a.verifiedPairs),String(a.unverifiedLegs)]);
  }
 }
 if((view==='overview'||view==='cash')&&report.cashByActivity?.length){
  rows.push([],[t('التدفقات حسب النشاط','Cash flows by activity')],[t('العملة','Currency'),t('النشاط','Activity'),t('المقبوضات','Inflows'),t('المدفوعات','Outflows'),t('الصافي','Net')]);
  for(const r of report.cashByActivity)rows.push([r.currency,personalCashActivityLabel(r.activity,en),r.inflows,r.outflows,r.net]);
 }
 if(view==='income'){
  const income=report.recognizedIncome??[];
  const classified=report.classifiedActivity?.rows??[];
  if(!income.length&&!classified.length)throw Error('PERSONAL_EXPORT_INCOME_EVIDENCE_REQUIRED');
  if(income.length){
   rows.push([t('دخل وتكاليف العقود المسجلة · تغطية جزئية','Recognized contract income and costs · partial coverage')]);
   rows.push([t('التاريخ','Date'),t('التصنيف','Category'),t('العملة','Currency'),t('المبلغ','Amount'),t('المصدر','Source')]);
   for(const r of income)rows.push([r.date,personalIncomeLabel(r.category,en),r.currency,r.amount,r.id]);
  }
  if(classified.length){
   rows.push([],[t('الإيرادات والمصروفات المصنفة من المستندات · تغطية جزئية','Document-classified income and expenses · partial coverage')]);
   rows.push([t('التاريخ','Date'),t('الطبيعة','Kind'),t('التصنيف','Category'),t('المبلغ','Amount'),t('العملة','Currency'),
    t('المبلغ الأساسي','Base amount'),t('العملة الأساسية','Base currency'),t('المستند','Document'),t('حركة النقد','Cash transaction')]);
   for(const r of classified)rows.push([r.entry_date,r.kind==='INCOME'?t('إيراد','Income'):t('مصروف','Expense'),
    r.category_code,r.amount,r.currency,r.base_amount,r.base_currency,r.document_id,r.transaction_id]);
  }
 }
 if(view==='accounts'){
  rows.push([t('تصنيفات عرض تلقائية — ليست حسابات ترحيل فعلية','Automatic display classifications — not posted ledger accounts')]);
  rows.push([t('الرمز','Code'),t('التصنيف','Category'),t('طبيعة الرصيد','Balance type'),t('العملة','Currency'),t('الرصيد','Balance')]);
  for(const c of report.categories)rows.push([c.code,en?c.en:c.ar,c.kind,c.currency,c.amount]);
 }
 if((view==='overview'||view==='cash')&&report.purchaseFunding?.length){
  rows.push([],[t('تمويل شراء الأصول وفرق الصرف','Asset purchase funding and FX difference')],
   [t('التاريخ','Date'),t('الحركة','Movement'),t('مبلغ التمويل','Funding amount'),t('عملة التمويل','Funding currency'),
    t('تكلفة الأصل','Asset cost'),t('تكلفة دفعات النقد','Cash lot cost'),t('فرق الصرف المحقق','Realized FX'),t('العملة الأساسية','Base currency')]);
  for(const row of report.purchaseFunding)rows.push([row.date,row.reversed?t('عكس','Reversal'):t('شراء','Purchase'),
   row.payment,row.currency,row.assetBasis,row.cashBasis,row.realizedFx,row.baseCurrency]);
 }
 if(report.issues.length){rows.push([],[t('تنبيهات المصدر','Source cautions')]);for(const issue of report.issues)rows.push([issue]);}
 if(rows.length>25_000)throw Error('PERSONAL_EXPORT_TOO_LARGE');
 return rows;
}

export function personalCashActivityLabel(category:import('./personal-report-evidence').PersonalCashClass,en:boolean){
 const labels={OPERATING:['تشغيلي','Operating'],INVESTING:['استثماري','Investing'],FINANCING:['تمويلي','Financing'],UNCLASSIFIED:['غير مصنّف','Unclassified']};
 return labels[category][Number(en)];
}

export function personalIncomeLabel(category:import('./personal-report-evidence').PersonalIncomeClass,en:boolean){
 const labels={FINANCE_INCOME:['عائد تمويل','Finance income'],FINANCE_EXPENSE:['تكلفة تمويل','Finance cost'],
  PARTICIPATION_INCOME:['دخل مشاركة','Participation income'],PARTICIPATION_EXPENSE:['تكلفة مشاركة','Participation cost'],
  INVESTMENT_INCOME:['دخل استثمار','Investment income']};
 return labels[category][Number(en)];
}
