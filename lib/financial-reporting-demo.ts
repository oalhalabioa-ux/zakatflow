/** Isolated known-answer fixtures; never an alternative production balance store. All amounts are M SAR. */
export const FINANCIAL_SCREENS = [
 ['overview','لوحة التقارير والقوائم المالية','Financial reports overview','01-financial-reports-overview'],
 ['statements','القوائم المالية','Financial statements','07-financial-statements-index'],
 ['income','قائمة الدخل','Income statement','08-income-statement'],
 ['position','قائمة المركز المالي','Statement of financial position','09-financial-position'],
 ['cash-flow','قائمة التدفقات النقدية','Cash flow statement','02-cash-flow-statement'],
 ['kpis','مؤشرات الأداء المالية (KPI)','Financial performance indicators (KPI)','03-executive-kpis'],
 ['budget-monitoring','الموازنات','Budget monitoring','04-budget-monitoring'],
 ['budget-entry','إعداد الموازنة التفصيلية','Detailed budget preparation','05-budget-entry'],
 ['analysis','التقارير الإدارية والتحليل','Management reports & analysis','06-management-analysis'],
] as const;
export type FinancialScreen = typeof FINANCIAL_SCREENS[number][0];
export type ReportLine={id:string;ar:string;en:string;current:number|null;previous:number|null;kind?:'section'|'subtotal'|'total'|'detail';unfavorableIncrease?:boolean};
const row=(id:string,ar:string,en:string,current:number|null,previous:number|null,kind:ReportLine['kind']='detail',unfavorableIncrease=false):ReportLine=>({id,ar,en,current,previous,kind,unfavorableIncrease});
export const REPORT_CASH={previousOpening:9.85,opening:18.75,closing:28.45} as const;
export const INCOME_LINES:ReportLine[]=[
 row('revenue','الإيرادات التشغيلية','Operating revenue',291.8,258.4,'section'),row('goods','إيرادات من بيع السلع','Sales of goods',259.5,228.6),row('services','إيرادات من تقديم الخدمات','Services',32.3,29.8),
 row('cogs','تكلفة المبيعات','Cost of sales',-161.6,-146.7,'section',true),row('goods-cost','تكلفة البضاعة المباعة','Cost of goods sold',-145.4,-131.8),row('service-cost','تكلفة الخدمات المقدمة','Cost of services',-16.2,-14.9),
 row('gross','مجمل الربح','Gross profit',130.2,111.7,'subtotal'),row('opex','المصروفات التشغيلية','Operating expenses',-61.8,-54.7,'section',true),row('selling','مصروفات البيع والتسويق','Selling & marketing',-22.5,-18.4),row('admin','المصروفات العمومية والإدارية','General & administrative',-36.3,-33.6),row('other','مصروفات تشغيلية أخرى','Other operating expenses',-3,-2.7),
 row('operating','الربح التشغيلي','Operating profit',68.4,57,'subtotal'),row('finance','تكاليف التمويل','Finance costs',-25.4,-21.1,'detail',true),row('tax','مصروف الزكاة والضريبة','Zakat & tax expense',-9.8,-9.2,'detail',true),row('net','صافي الربح','Net profit',33.2,26.7,'total')
];
export const POSITION_LINES:ReportLine[]=[
 row('ca','الأصول المتداولة','Current assets',null,null,'section'),row('cash','نقد وما في حكمه','Cash & cash equivalents',REPORT_CASH.closing,REPORT_CASH.opening),row('ar','ذمم مدينة تجارية','Trade receivables',37.6,32.7),row('stock','مخزون','Inventories',41.2,37.9),row('prepaid','مدفوعات مقدماً وأصول متداولة أخرى','Prepayments & other current assets',21.35,22.55),row('ca-total','إجمالي الأصول المتداولة','Total current assets',128.6,111.9,'subtotal'),
 row('nca','الأصول غير المتداولة','Non-current assets',null,null,'section'),row('ppe','ممتلكات وآلات ومعدات','Property, plant & equipment',61.74,60.24),row('intangibles','أصول غير ملموسة','Intangible assets',7.95,6.9),row('investments','أصول حق الاستخدام','Right-of-use assets',6.38,5.81),row('long-assets','استثمارات طويلة الأجل','Long-term investments',3.15,2.65),row('nca-total','إجمالي الأصول غير المتداولة','Total non-current assets',79.22,75.6,'subtotal'),row('assets','إجمالي الأصول','Total assets',207.82,187.5,'total'),
 row('cl','الخصوم المتداولة','Current liabilities',null,null,'section'),row('ap','ذمم دائنة تجارية','Trade payables',24.6,22.4),row('short-debt','قروض قصيرة الأجل','Short-term borrowings',28.5,26.9),row('accrued','مستحقات ومصاريف مستحقة','Accrued liabilities',12.35,10),row('cl-total','إجمالي الخصوم المتداولة','Total current liabilities',65.45,59.3,'subtotal'),
 row('ncl','الخصوم غير المتداولة','Non-current liabilities',null,null,'section'),row('long-debt','قروض طويلة الأجل','Long-term borrowings',17.8,16.9),row('leases','التزامات الإيجار','Lease liabilities',3.2,2.9),row('benefits','منافع الموظفين المحددة','Employee benefit obligations',.87,1.2),row('ncl-total','إجمالي الخصوم غير المتداولة','Total non-current liabilities',21.87,21,'subtotal'),row('liabilities','إجمالي الخصوم','Total liabilities',87.32,80.3,'total'),
 row('equity-head','حقوق الملكية','Equity',null,null,'section'),row('capital','رأس المال','Share capital',50,50),row('reserves','الاحتياطيات','Reserves',12.4,11.2),row('retained','الأرباح المبقاة','Retained earnings',58.1,46),row('equity','إجمالي حقوق الملكية','Total equity',120.5,107.2,'subtotal'),row('le','إجمالي الخصوم وحقوق الملكية','Total liabilities & equity',207.82,187.5,'total')
];
export const CASH_LINES:ReportLine[]=[
 row('op','التدفقات من الأنشطة التشغيلية','Operating activities',null,null,'section'),row('collections','المتحصلات النقدية من العملاء','Cash receipts from customers',185.4,162.7),row('suppliers','المدفوعات النقدية للموردين','Payments to suppliers',-112.8,-98.7),row('employees','المدفوعات النقدية للموظفين','Payments to employees',-22.6,-20.8),row('other-cash','مصروفات تشغيلية أخرى','Other operating payments',-16.8,-14.6),row('op-total','صافي النقد من الأنشطة التشغيلية','Net operating cash flow',33.2,28.6,'subtotal'),
 row('invest','التدفقات من الأنشطة الاستثمارية','Investing activities',null,null,'section'),row('ppe-buy','شراء ممتلكات وآلات ومعدات','Purchase of property & equipment',-20,-18.4),row('ppe-sale','متحصلات بيع أصول','Proceeds from asset disposals',2.5,1.1),row('investment','استثمارات أخرى','Other investments',-1,-.6),row('invest-total','صافي النقد من الأنشطة الاستثمارية','Net investing cash flow',-18.5,-17.9,'subtotal'),
 row('fin','التدفقات من الأنشطة التمويلية','Financing activities',null,null,'section'),row('borrowings','متحصلات من التمويل (قروض جديدة)','Proceeds from borrowings',14.7,10),row('repayments','سداد قروض','Repayment of borrowings',-18.5,-10),row('dividends','توزيعات أرباح مدفوعة','Dividends paid',-1.2,-1.8),row('fin-total','صافي النقد من الأنشطة التمويلية','Net financing cash flow',-5,-1.8,'subtotal'),row('change','صافي التغير في النقد','Net change in cash',9.7,8.9,'total'),row('opening','رصيد النقد الافتتاحي','Opening cash',REPORT_CASH.opening,REPORT_CASH.previousOpening,'section'),row('closing','رصيد النقد الختامي','Closing cash',REPORT_CASH.closing,REPORT_CASH.opening,'section')
];
export const MONTHLY_NET_CASH=[1.1,2.2,-.8,1.4,2.2,.9,3.1,-1.7,7.5,1.3,2.5,5.9];
export const MONTHLY_CASH_BALANCES=MONTHLY_NET_CASH.map((_,i)=>2.85+MONTHLY_NET_CASH.slice(0,i+1).reduce((a,b)=>a+b,0));
export const MONTHLY_BUDGET=[80,85,90,92,96,98,100,102,105,110,118,124];
export const MONTHLY_BUDGET_ACTUAL=[70,74,78,80,83,85,87,89,92,96,103,109.8];
export const BUDGET_MONITORING=[
 {ar:'المصروفات التشغيلية',en:'Operating expenses',budget:420,actual:353.5,icon:'settings'},
 {ar:'الرواتب والمزايا',en:'Salaries & benefits',budget:310,actual:262,icon:'users'},
 {ar:'التسويق',en:'Marketing',budget:80,actual:41.3,icon:'trend'},
 {ar:'التقنية',en:'Technology',budget:70,actual:70.4,icon:'chart'},
 {ar:'الإنفاق الرأسمالي (CAPEX)',en:'Capital expenditure (CAPEX)',budget:320,actual:319.6,icon:'layers'},
];
export type EditableBudgetRow={id:string;ar:string;en:string;values:number[];category:'revenue'|'expense'};
export function initialBudgetRows():EditableBudgetRow[]{const rev=[110,112,115,118,120,123,124,121,120,120,126,131];return[
 {id:'sales',ar:'المبيعات',en:'Sales',values:rev,category:'revenue'},
 {id:'cogs',ar:'تكلفة المبيعات',en:'Cost of sales',values:rev.map(n=>n*.6),category:'expense'},
 ...[['salary','الرواتب','Salaries',228.5],['rent','الإيجارات','Rent',60],['marketing','التسويق','Marketing',81],['technology','تقنية المعلومات','Information technology',30],['admin','مصروفات إدارية','Administration',42]].map(([id,ar,en,total])=>({id:String(id),ar:String(ar),en:String(en),values:Array.from({length:12},()=>Number(total)/12),category:'expense' as const}))
]}
export function budgetComputed(rows:EditableBudgetRow[]){const sum=(id:string,i:number)=>rows.find(r=>r.id===id)!.values[i];return{
 gross:Array.from({length:12},(_,i)=>sum('sales',i)-sum('cogs',i)),
 opex:Array.from({length:12},(_,i)=>rows.filter(r=>!['sales','cogs'].includes(r.id)).reduce((a,r)=>a+r.values[i],0)),
 operating:Array.from({length:12},(_,i)=>sum('sales',i)-rows.filter(r=>r.category==='expense').reduce((a,r)=>a+r.values[i],0))
}}
export function reportVariance(current:number,previous:number){return previous===0?null:(current-previous)/Math.abs(previous)*100}
export function fixtureIntegrity(){const value=(lines:ReportLine[],id:string)=>lines.find(r=>r.id===id)!.current!;return{
 balance:value(POSITION_LINES,'assets')-value(POSITION_LINES,'liabilities')-value(POSITION_LINES,'equity'),
 cash:value(CASH_LINES,'opening')+value(CASH_LINES,'op-total')+value(CASH_LINES,'invest-total')+value(CASH_LINES,'fin-total')-value(CASH_LINES,'closing'),
 income:value(INCOME_LINES,'revenue')+value(INCOME_LINES,'cogs')+value(INCOME_LINES,'opex')+value(INCOME_LINES,'finance')+value(INCOME_LINES,'tax')-value(INCOME_LINES,'net')
}}
