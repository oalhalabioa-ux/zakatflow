import {z} from 'zod';
export const groupStatementLabels:Record<string,[string,string]>={revenue:['الإيرادات','Revenue'],costOfSales:['تكلفة المبيعات','Cost of sales'],grossProfit:['مجمل الربح','Gross profit'],operatingExpenses:['المصروفات التشغيلية','Operating expenses'],operatingProfit:['الربح التشغيلي','Operating profit'],finance:['تكاليف التمويل','Finance costs'],tax:['الضرائب','Tax'],netProfit:['صافي الربح','Net profit'],assets:['الأصول','Assets'],liabilities:['الالتزامات','Liabilities'],equity:['حقوق الملكية','Equity'],fiscalProfit:['ربح السنة حتى تاريخ التقرير','Fiscal profit to date'],opening:['النقد أول الفترة','Opening cash'],operating:['التدفقات التشغيلية','Operating cash flow'],investing:['التدفقات الاستثمارية','Investing cash flow'],financing:['التدفقات التمويلية','Financing cash flow'],movement:['صافي التغير في النقد','Net cash movement'],closing:['النقد آخر الفترة','Closing cash']};
const amount=z.string().regex(/^-?\d{1,20}(\.\d{1,4})?$/);
const row=z.object({key:z.string().regex(/^[a-zA-Z]+$/),before:amount,adjustment:amount,after:amount}).strict();
const query=z.object({organization:z.string().uuid(),from:z.string().date(),to:z.string().date()}).strict();
const approval=z.object({id:z.string().uuid(),version:z.number().int().positive(),approvedBy:z.string().uuid(),approvedAt:z.string().datetime({offset:true})});
const keys={income:['revenue','costOfSales','grossProfit','operatingExpenses','operatingProfit','finance','tax','netProfit'],
 position:['assets','liabilities','equity','fiscalProfit'],cash:['opening','operating','investing','financing','movement','closing']};
type CsvRows=(string|number)[][];
function serialize(rows:CsvRows){
 return '\uFEFF'+rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\r\n')+'\r\n';
}
const acquisitionReview=z.discriminatedUnion('status',[
 z.object({status:z.literal('ACQUISITIONS_NOT_INSTALLED'),query}),
 z.object({status:z.literal('APPROVED_ACQUISITION_REVIEW'),query,rows:z.array(z.object({
  id:z.string().uuid(),subsidiaryName:z.string().min(1),approvedAt:z.string().datetime({offset:true}),
  documentCount:z.number().int().positive(),calculation:z.object({
   status:z.literal('ACQUISITION_MEASUREMENT_ONLY'),consolidated:z.literal(false),
   issuanceReady:z.literal(false),reassessmentRequired:z.literal(false),
   parentOrganizationId:z.string().uuid(),subsidiaryOrganizationId:z.string().uuid(),
   acquisitionDate:z.string().date(),currency:z.string().regex(/^[A-Z]{3}$/),
   consideration:amount,identifiableNetAssets:amount,goodwill:amount,nciAtAcquisition:amount,
  }),
 })).max(99)}),
]);
const payload=z.object({status:z.literal('APPROVED_GROUP_ADJUSTMENT_WORKSHEET'),consolidated:z.literal(false),
 acquisitionReview:acquisitionReview.optional(),
 approval,
 control:z.object({rootOrganizationId:z.string().uuid()}),
 statementWorksheet:z.object({status:z.literal('GROUP_STATEMENT_WORKSHEET_ONLY'),consolidated:z.literal(false),from:z.string().date(),to:z.string().date(),currency:z.string().regex(/^[A-Z]{3}$/),memberIds:z.array(z.string().uuid()).min(1),income:z.array(row).length(8),position:z.array(row).length(4),cash:z.array(row).length(6)}),
});
/** Call only with a freshly authorized API response. This is deliberately a
 * labelled review export, not final consolidated financial statements. */
export function approvedGroupWorksheetCsv(input:unknown,requested:unknown){
 const p=payload.parse(input),q=query.parse(requested),s=p.statementWorksheet;
 if(p.control.rootOrganizationId!==q.organization||s.from!==q.from||s.to!==q.to)throw Error('GROUP_EXPORT_SCOPE_MISMATCH');
 if(new Set(s.memberIds).size!==s.memberIds.length||!s.memberIds.includes(q.organization))throw Error('GROUP_EXPORT_SCOPE_MISMATCH');
 for(const section of ['income','position','cash'] as const)if(s[section].some((r,i)=>r.key!==keys[section][i]))throw Error('GROUP_EXPORT_ROWS_INVALID');
 const rows:(string|number)[][]=[['Review worksheet only - NOT final consolidated statements'],['ورقة مراجعة فقط - ليست قوائم مجمعة نهائية'],['Organization',q.organization],['From',s.from],['To',s.to],['Currency',s.currency],['Approved batch',p.approval.id],['Approved version',p.approval.version],['Approved at',p.approval.approvedAt],['Members',s.memberIds.join(' | ')],[],['Statement','Item','البند','Before adjustments','Adjustment','After adjustments']];
 for(const section of ['income','position','cash'] as const)for(const r of s[section])rows.push([section,groupStatementLabels[r.key][1],groupStatementLabels[r.key][0],r.before,r.adjustment,r.after]);
 const acquisitions=p.acquisitionReview;
 if(acquisitions){
  if(acquisitions.query.organization!==q.organization||acquisitions.query.from!==q.from||acquisitions.query.to!==q.to)
   throw Error('GROUP_EXPORT_SCOPE_MISMATCH');
  rows.push([],['Acquisition-date review / مراجعة تقييم الاستحواذ']);
  if(acquisitions.status==='ACQUISITIONS_NOT_INSTALLED'){
   rows.push(['Acquisition review unavailable / مراجعة الاستحواذ غير متاحة']);
  }else if(!acquisitions.rows.length){
   rows.push(['No approved acquisition records for this period / لا توجد تقييمات استحواذ معتمدة لهذه الفترة']);
  }else{
   rows.push(['Subsidiary / الشركة التابعة','Subsidiary ID / معرّف الشركة التابعة','Acquisition date / تاريخ الاستحواذ',
    'Currency / العملة','Consideration / مقابل الاستحواذ','Identifiable net assets / صافي الأصول المحددة',
    'Goodwill / الشهرة','NCI at acquisition / حقوق غير المسيطرين عند الاستحواذ',
    'Documents / المستندات','Approved record / السجل المعتمد','Approved at / تاريخ الاعتماد']);
   const seen=new Set<string>();
   for(const r of acquisitions.rows){
    const a=r.calculation;
    if(a.parentOrganizationId!==q.organization||a.subsidiaryOrganizationId===q.organization||
      !s.memberIds.includes(a.subsidiaryOrganizationId)||a.currency!==s.currency||a.acquisitionDate>q.from||
      seen.has(a.subsidiaryOrganizationId))throw Error('GROUP_EXPORT_SCOPE_MISMATCH');
    seen.add(a.subsidiaryOrganizationId);
    // Spreadsheet applications can evaluate quoted text cells as formulas.
    const name=/^[\s\p{Cf}]*[=+@-]|^[\t\r\n]/u.test(r.subsidiaryName)?"'"+r.subsidiaryName:r.subsidiaryName;
    rows.push([name,a.subsidiaryOrganizationId,a.acquisitionDate,a.currency,a.consideration,
     a.identifiableNetAssets,a.goodwill,a.nciAtAcquisition,r.documentCount,r.id,r.approvedAt]);
   }
  }
 }
 return serialize(rows);
}

const uuid=z.string().uuid();
const positionReview=z.object({
 status:z.enum(['ACQUISITION_CARRY_FORWARD_POSITION_REVIEW','ACQUISITION_DAY_POSITION_REVIEW']),
 query,currency:z.string().regex(/^[A-Z]{3}$/),approval,memberIds:z.array(uuid).min(2),
 acquisitionRecordIds:z.array(uuid).min(1),
 rows:z.array(row).length(3),income:z.array(row).length(8),statementCash:z.array(row).length(6),
 profitAttribution:z.object({total:amount,parent:amount,nci:amount}).nullable(),
 closingNci:amount,closingParentEquity:amount,
 inventoryEliminations:z.array(z.object({
  sellerOrganizationId:uuid,buyerOrganizationId:uuid,inventoryAccountId:z.string().regex(/^1700(?:\d{2}){1,3}$/),
  inventoryReduction:amount,deferredTax:z.object({approvedRecordId:uuid,evidenceDocumentId:uuid,
   deferredTaxAssetIncrease:amount,groupAfterTaxProfitReduction:amount}),
  afterTaxAttribution:z.object({parent:amount,nonControllingInterests:amount}),
 })),
});

/** Render the same verified acquisition and adjustments projection used by the
 * on-screen review, never the underlying pre-acquisition trial balance. */
export function groupAcquisitionPositionCsv(input:unknown,requested:unknown){
 const p=positionReview.parse(input),scope=query.parse(requested);
 const members=new Set(p.memberIds),records=new Set(p.acquisitionRecordIds);
 if(p.query.organization!==scope.organization||p.query.from!==scope.from||p.query.to!==scope.to||
   members.size!==p.memberIds.length||!members.has(scope.organization)||records.size!==members.size-1||
   records.size!==p.acquisitionRecordIds.length)throw Error('GROUP_EXPORT_SCOPE_MISMATCH');
 const sections=[['position',p.rows],['income',p.income],['cash',p.statementCash]] as const;
 const rows:CsvRows=[
  ['Group statements review after approved adjustments / مراجعة قوائم المجموعة بعد التسويات المعتمدة'],
  ['Organization / المؤسسة',scope.organization],['From / من',scope.from],['To / إلى',scope.to],
  ['Currency / العملة',p.currency],['Approved batch / الدفعة المعتمدة',p.approval.id],
  ['Approved version / النسخة المعتمدة',p.approval.version],['Approved at / وقت الاعتماد',p.approval.approvedAt],
  ['Acquisition records / سجلات الاستحواذ',p.acquisitionRecordIds.join(' | ')],
  ['Members / أعضاء المجموعة',p.memberIds.join(' | ')],[],
  ['Statement','Item','البند','Before adjustments','Adjustment','After adjustments'],
 ];
 for(const [section,statement] of sections){
  if(statement.some((r,i)=>r.key!==keys[section][i]))throw Error('GROUP_EXPORT_ROWS_INVALID');
  for(const r of statement)rows.push([section,groupStatementLabels[r.key][1],groupStatementLabels[r.key][0],r.before,r.adjustment,r.after]);
 }
 if(p.profitAttribution){
  rows.push([],['Profit attribution / إسناد نتيجة المجموعة'],['Group total / إجمالي المجموعة',p.profitAttribution.total],
   ['Owners of the parent / مالكو الشركة الأم',p.profitAttribution.parent],['Non-controlling interests / غير المسيطرين',p.profitAttribution.nci]);
 }
 rows.push([],['Closing equity / حقوق الملكية الختامية'],
  ['Owners of the parent / مالكو الشركة الأم',p.closingParentEquity],['Non-controlling interests / غير المسيطرين',p.closingNci]);
 if(p.inventoryEliminations.length){
  rows.push([],['Approved inventory margin eliminations / استبعادات هامش المخزون المعتمدة'],
   ['Seller / البائع','Buyer / المشتري','Inventory account / حساب المخزون','Unrealized margin / الربح غير المحقق',
    'Deferred tax asset / أصل الضريبة المؤجلة','After-tax profit reduction / تخفيض الربح بعد الضريبة',
    'Parent share / حصة الأم','NCI share / حصة غير المسيطرين','Approved record / سجل الاعتماد','Evidence / المستند']);
  for(const item of p.inventoryEliminations){
   if(!members.has(item.sellerOrganizationId)||!members.has(item.buyerOrganizationId)||
      item.sellerOrganizationId===item.buyerOrganizationId||!records.has(item.deferredTax.approvedRecordId))
    throw Error('GROUP_EXPORT_SCOPE_MISMATCH');
   rows.push([item.sellerOrganizationId,item.buyerOrganizationId,item.inventoryAccountId,item.inventoryReduction,
    item.deferredTax.deferredTaxAssetIncrease,item.deferredTax.groupAfterTaxProfitReduction,
    item.afterTaxAttribution.parent,item.afterTaxAttribution.nonControllingInterests,
    item.deferredTax.approvedRecordId,item.deferredTax.evidenceDocumentId]);
  }
 }
 return serialize(rows);
}
