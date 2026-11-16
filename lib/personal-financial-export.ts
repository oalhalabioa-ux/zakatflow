import type {PersonalReport} from './personal-financial-reports';

export type PersonalExportView='overview'|'position'|'cash'|'accounts';

/** Export from one authorized snapshot. Never synthesize income or aggregate currencies. */
export function personalFinancialExportRows(report:PersonalReport,view:PersonalExportView,en:boolean):string[][]{
 if(report.scope!=='PERSONAL'||report.basis!=='CURRENT_PERSONAL_REGISTER_ESTIMATE')throw Error('PERSONAL_EXPORT_SCOPE_INVALID');
 if(!['overview','position','cash','accounts'].includes(view))throw Error('PERSONAL_EXPORT_VIEW_INVALID');
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
 if(view==='overview'||view==='cash'){
  rows.push([],[t('حركة الحسابات النقدية — ليست قائمة تدفقات نقدية معيارية','Cash-account activity — not a statutory cash-flow statement')]);
  rows.push([t('الحساب','Account'),t('العملة','Currency'),t('أول الفترة','Opening'),t('المقبوضات الإجمالية','Gross inflows'),t('المدفوعات الإجمالية','Gross outflows'),t('صافي الحركة','Net movement'),t('آخر الفترة','Closing')]);
  for(const a of report.cashAccounts)rows.push([a.name,a.currency,a.opening,a.inflows,a.outflows,a.netMovement,a.closing]);
  if(report.cashTransferReconciliation?.length){
   rows.push([],[t('تسوية التحويلات بمعرّف المصدر — الباقي غير مصنّف','Source-ID transfer reconciliation — remainder unclassified')]);
   rows.push([t('العملة','Currency'),t('التحويلات الداخلة المثبتة','Verified internal inflows'),t('التحويلات الخارجة المثبتة','Verified internal outflows'),t('الداخل غير المصنّف','Unclassified inflows'),t('الخارج غير المصنّف','Unclassified outflows'),t('الأزواج المثبتة','Verified pairs'),t('الأطراف غير المثبتة','Unverified legs')]);
   for(const a of report.cashTransferReconciliation)rows.push([a.currency,a.verifiedInternalInflows,a.verifiedInternalOutflows,a.remainingUnclassifiedInflows,a.remainingUnclassifiedOutflows,String(a.verifiedPairs),String(a.unverifiedLegs)]);
  }
 }
 if(view==='accounts'){
  rows.push([t('تصنيفات عرض تلقائية — ليست حسابات ترحيل فعلية','Automatic display classifications — not posted ledger accounts')]);
  rows.push([t('الرمز','Code'),t('التصنيف','Category'),t('طبيعة الرصيد','Balance type'),t('العملة','Currency'),t('الرصيد','Balance')]);
  for(const c of report.categories)rows.push([c.code,en?c.en:c.ar,c.kind,c.currency,c.amount]);
 }
 if(report.issues.length){rows.push([],[t('تنبيهات المصدر','Source cautions')]);for(const issue of report.issues)rows.push([issue]);}
 if(rows.length>25_000)throw Error('PERSONAL_EXPORT_TOO_LARGE');
 return rows;
}
