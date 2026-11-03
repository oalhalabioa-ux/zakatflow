import Decimal from 'decimal.js';
import {statementSourceExport,type StatementSourceSnapshot,type StatementView} from './financial-statement-source';

export type StatementHubView=StatementView|'overview'|'statements'|'kpis';
export const STATEMENT_HUB_TITLES={overview:['لوحة التقارير والقوائم المالية','Financial reports dashboard'],statements:['القوائم المالية','Financial statements'],income:['قائمة الدخل','Income statement'],position:['قائمة المركز المالي','Statement of financial position'],'cash-flow':['قائمة التدفقات النقدية','Cash flow statement'],kpis:['المؤشرات المالية','Financial indicators']} as const;
const Money=Decimal.clone({precision:50});
export type StatementIndicator={id:string;ar:string;en:string;value:string|null;format:'amount'|'ratio'|'percent';formula:[string,string];reason?:[string,string];icon:string};
/** Read-only views of one reconciled snapshot. No benchmark, comparison or opening is inferred. */
export function statementSummary(s:StatementSourceSnapshot){
 const i=s.statements.income,p=s.statements.position,c=s.statements.cash;
 let currentAssets=new Money(0),currentLiabilities=new Money(0);
 for(const a of s.accounts)if(a.presentation==='CURRENT'){if(a.kind==='ASSET')currentAssets=currentAssets.plus(a.balance);else if(a.kind==='LIABILITY')currentLiabilities=currentLiabilities.minus(a.balance)}
 const expenses=new Money(i.revenue).minus(i.netProfit).toFixed(4);
 const ratio=(a:string,b:string,percent=false)=>new Money(b).gt(0)?new Money(a).div(b).times(percent?100:1).toFixed(4):null;
 const unavailable:[string,string]=['يلزم مصدر معتمد إضافي لحساب المؤشر.','An additional approved source is required to calculate this indicator.'];
 const denominator:[string,string]=['لا يمكن حساب النسبة عندما يكون المقام صفراً أو سالباً.','The ratio is unavailable when its denominator is zero or negative.'];
 const indicators:StatementIndicator[]=[
  {id:'revenue',ar:'الإيرادات',en:'Revenue',value:i.revenue,format:'amount',formula:['الإيرادات المعترف بها خلال الفترة المختارة.','Recognized revenue for the selected period.'],icon:'coins'},
  {id:'receivable-turnover',ar:'دوران الذمم',en:'Receivable turnover',value:null,format:'ratio',formula:['المبيعات الآجلة ÷ متوسط الذمم المدينة؛ المدخلان غير متاحين.','Credit sales / average receivables; neither input is available.'],reason:unavailable,icon:'trend'},
  {id:'current-ratio',ar:'السيولة الجارية',en:'Current ratio',value:ratio(currentAssets.toFixed(4),currentLiabilities.toFixed(4)),format:'ratio',formula:['الأصول المتداولة ÷ الخصوم المتداولة في نهاية الفترة.','Current assets / current liabilities at the reporting date.'],reason:denominator,icon:'target'},
  {id:'expense-ratio',ar:'نسبة المصروفات',en:'Expense ratio',value:ratio(expenses,i.revenue,true),format:'percent',formula:['(تكلفة المبيعات + التشغيل + التمويل + الزكاة والضريبة) ÷ الإيرادات × 100.','(Cost of sales + operating expenses + finance + tax) / revenue × 100.'],reason:denominator,icon:'layers'},
  {id:'ebitda',ar:'EBITDA',en:'EBITDA',value:null,format:'amount',formula:['الربح التشغيلي + الإهلاك والإطفاء؛ لا يوجد تصنيف معتمد للإهلاك والإطفاء.','Operating profit + depreciation and amortization; approved D&A mapping is unavailable.'],reason:unavailable,icon:'coins'},
  {id:'net-margin',ar:'هامش الربح',en:'Profit margin',value:ratio(i.netProfit,i.revenue,true),format:'percent',formula:['صافي ربح الفترة المختارة ÷ الإيرادات × 100.','Selected-period net profit / revenue × 100.'],reason:denominator,icon:'percent'},
  {id:'ebitda-margin',ar:'هامش EBITDA',en:'EBITDA margin',value:null,format:'percent',formula:['EBITDA ÷ الإيرادات × 100؛ EBITDA غير متاح.','EBITDA / revenue × 100; EBITDA is unavailable.'],reason:unavailable,icon:'percent'},
  {id:'collection-days',ar:'أيام التحصيل',en:'Collection days',value:null,format:'ratio',formula:['أيام الفترة ÷ دوران الذمم؛ لا يُفترض معدل سنوي أو مبيعات آجلة.','Period days / receivable turnover; no annualization or credit sales are assumed.'],reason:unavailable,icon:'calendar'},
 ];
 return{revenue:i.revenue,netProfit:i.netProfit,expenses,assets:p.assets,liabilities:p.liabilities,equity:p.equity,closingCash:c.closing,operatingCash:c.operating,currentAssets:currentAssets.toFixed(4),currentLiabilities:currentLiabilities.toFixed(4),indicators};
}

export function statementHubExport(s:StatementSourceSnapshot,view:StatementHubView,en:boolean):string[][]{
 if(view==='income'||view==='position'||view==='cash-flow')return statementSourceExport(s,view,en);
 const t=(ar:string,english:string)=>en?english:ar,summary=statementSummary(s),base=statementSourceExport(s,'income',en);
 const rows=base.slice(0,base.findIndex(r=>r.length===0));
 rows.push([t('التقرير','Report'),STATEMENT_HUB_TITLES[view][en?1:0]],[],[t('المؤشر','Indicator'),t('القيمة','Value'),t('الحالة','Status'),t('الصيغة والتفسير','Formula and explanation')]);
 if(view==='kpis')for(const r of summary.indicators)rows.push([en?r.en:r.ar,r.value??'',r.value===null?t('غير متاح','Unavailable'):t('متاح','Available'),r.formula[en?1:0]+(r.value===null?' '+r.reason?.[en?1:0]:'')]);
 else for(const [label,value]of(view==='overview'?[[t('الإيرادات','Revenue'),summary.revenue],[t('المصروفات','Expenses'),summary.expenses],[t('صافي الربح','Net profit'),summary.netProfit],[t('هامش الربح %','Profit margin %'),summary.indicators.find(r=>r.id==='net-margin')!.value??''],[t('التدفقات النقدية التشغيلية','Operating cash flow'),summary.operatingCash]]:[[t('الإيرادات','Revenue'),summary.revenue],[t('صافي الربح','Net profit'),summary.netProfit],[t('إجمالي الأصول','Total assets'),summary.assets],[t('إجمالي الخصوم','Total liabilities'),summary.liabilities],[t('حقوق الملكية','Equity'),summary.equity],[t('النقد الختامي','Closing cash'),summary.closingCash]]))rows.push([label,value,value===''?t('غير متاح','Unavailable'):t('متاح','Available'),value===''?t('المقام صفر أو سالب.','The denominator is zero or negative.'):'']);
 const cashByMonth=new Map(s.cashMonths.map(m=>[m.month,m.closing]));
 rows.push([],[t('الشهر','Month'),t('الإيرادات','Revenue'),t('المصروفات','Expenses'),t('صافي الربح','Net profit'),t('النقد الختامي','Closing cash')],...s.incomeMonths.map(m=>[m.month,m.revenue,m.expenses,m.netProfit,cashByMonth.get(m.month)??'']));
 rows.push([],[t('القيود المصدرية','Source journals'),...s.statements.sourceJournalIds],[t('القيد','Journal'),t('الحدث','Event'),t('السطر','Line'),t('قاعدة الترحيل','Posting rule')],...s.lineage.map(l=>[l.journalId,l.eventId,l.lineId,l.ruleId]));
 return rows;
}
