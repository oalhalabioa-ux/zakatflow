export type BudgetLine={
 id?:string;category:'REVENUE'|'COGS'|'OPEX'|'CAPEX'|'FINANCING'|'ZAKAT';
 name:string;line_type:'REVENUE'|'EXPENSE'|'CASH';sort_order:number;
 monthly_budget:number[];monthly_actual:number[];monthly_forecast?:number[];active?:boolean;
};

export type BudgetPlan={
 id?:string;name:string;fiscal_year:number;currency:string;
 scenario:'BASE'|'DOWNSIDE'|'UPSIDE';status:'DRAFT'|'IN_REVIEW'|'APPROVED'|'ARCHIVED';
 organization_name:string;cost_center:string;opening_cash:number;minimum_cash_target:number;
 assumptions:Record<string,unknown>;notes:string;lines:BudgetLine[];
};

export type BudgetCostCenter=string;

export function budgetVariancePercent(variance:number,budget:number):number|null{
 return Number(budget)===0?null:Number(variance)/Number(budget);
}

export function isBudgetVarianceFavorable(category:BudgetLine['category'],budget:number,actual:number):boolean|null{
 if(Number(budget)===0&&Number(actual)===0)return null;
 const variance=Number(actual)-Number(budget);
 return category==='REVENUE'?variance>=0:variance<=0;
}

export const MONTH_KEYS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'] as const;
const sum=(values:number[])=>values.reduce((total,value)=>total+(Number(value)||0),0);
export const budgetScenarioFactor=(scenario:BudgetPlan['scenario'],category:BudgetLine['category'])=>{
 if(scenario==='BASE')return 1;
 if(scenario==='DOWNSIDE')return category==='REVENUE'?0.90:category==='OPEX'?1.05:1;
 return category==='REVENUE'?1.10:category==='OPEX'?1.03:1;
};

/**
 * Converts an annual growth assumption into a monthly factor.
 * January is the budget baseline; December reaches the full annual rate.
 */
export const annualGrowthFactor=(annualGrowth:number,monthIndex:number)=>{
 const growth=Math.max(-0.999,Number(annualGrowth)||0);
 const month=Math.max(0,Math.min(11,Number(monthIndex)||0));
 return Math.pow(1+growth,month/11);
};

/**
 * Rebuilds forecasts from the entered budget and performance drivers.
 * It never changes monthly_budget, monthly_actual, or cash settings.
 */
export function applyPerformanceDrivers(plan:BudgetPlan):BudgetLine[]{
 const revenueGrowth=Number(plan.assumptions.revenue_growth??0);
 const cogsRatio=Math.max(0,Number(plan.assumptions.cogs_ratio??0));
 const opexGrowth=Number(plan.assumptions.opex_growth??0);
 const revenueLines=plan.lines.filter(line=>line.category==='REVENUE');
 const cogsLines=plan.lines.filter(line=>line.category==='COGS');
 const cogsBudgetByMonth=MONTH_KEYS.map((_,month)=>sum(cogsLines.map(line=>Number(line.monthly_budget[month]||0))));
 const revenueForecastByMonth=MONTH_KEYS.map((_,month)=>sum(revenueLines.map(line=>Number(line.monthly_budget[month]||0)*budgetScenarioFactor(plan.scenario,'REVENUE')*annualGrowthFactor(revenueGrowth,month))));

 return plan.lines.map(line=>{
  const scenario=budgetScenarioFactor(plan.scenario,line.category);
  const forecast=line.monthly_budget.map((budget,month)=>{
   if(line.category==='REVENUE')return Math.round(Number(budget||0)*scenario*annualGrowthFactor(revenueGrowth,month));
   if(line.category==='COGS'){
    const totalCogs=revenueForecastByMonth[month]*cogsRatio;
    const budgetBasis=cogsBudgetByMonth[month];
    const share=budgetBasis>0?Number(budget||0)/budgetBasis:(cogsLines.length?1/cogsLines.length:0);
    return Math.round(totalCogs*share);
   }
   if(line.category==='OPEX')return Math.round(Number(budget||0)*scenario*annualGrowthFactor(opexGrowth,month));
   // CAPEX growth is a five-year driver. Monthly forecasts stay aligned to
   // the entered monthly budget, while financing and Zakat remain untouched.
   return Math.round(Number(budget||0)*scenario);
  });
  return {...line,monthly_forecast:forecast};
 });
}
const at=(line:BudgetLine,field:'monthly_budget'|'monthly_actual'|'monthly_forecast',month:number)=>{
 const source=field==='monthly_forecast'?(line.monthly_forecast??line.monthly_budget):line[field];
 return Number(source[month]??0);
};
const category=(lines:BudgetLine[],name:BudgetLine['category'],field:'monthly_budget'|'monthly_actual'|'monthly_forecast',month:number)=>
 sum(lines.filter(line=>line.category===name).map(line=>at(line,field,month)));

export function buildBudgetMetrics(plan:BudgetPlan){
 const actualThroughMonth=Math.max(0,Math.min(12,Number(plan.assumptions.actual_through_month??0)));
 const monthly=MONTH_KEYS.map((_,month)=>{
  const revenue=category(plan.lines,'REVENUE','monthly_budget',month);
  const cogs=category(plan.lines,'COGS','monthly_budget',month);
  const opex=category(plan.lines,'OPEX','monthly_budget',month);
  const capex=category(plan.lines,'CAPEX','monthly_budget',month);
  const financing=category(plan.lines,'FINANCING','monthly_budget',month);
  const zakat=category(plan.lines,'ZAKAT','monthly_budget',month);
  const actualRevenue=category(plan.lines,'REVENUE','monthly_actual',month);
  const actualCogs=category(plan.lines,'COGS','monthly_actual',month);
  const actualOpex=category(plan.lines,'OPEX','monthly_actual',month);
  const actualCapex=category(plan.lines,'CAPEX','monthly_actual',month);
  const actualFinancing=category(plan.lines,'FINANCING','monthly_actual',month);
  const actualZakat=category(plan.lines,'ZAKAT','monthly_actual',month);
  const actualOutflow=sum(plan.lines.filter(line=>line.category!=='REVENUE').map(line=>at(line,'monthly_actual',month)));
  const forecastRevenue=category(plan.lines,'REVENUE','monthly_forecast',month);
  const forecastOutflow=sum(plan.lines.filter(line=>line.category!=='REVENUE').map(line=>at(line,'monthly_forecast',month)));
  return {revenue,cogs,opex,capex,financing,zakat,grossProfit:revenue-cogs,ebitda:revenue-cogs-opex,
   netCash:revenue-cogs-opex-capex-financing-zakat,actualRevenue,actualCogs,actualOpex,actualCapex,actualFinancing,actualZakat,actualOutflow,actualNetCash:actualRevenue-actualOutflow,
   forecastRevenue,forecastOutflow,forecastNetCash:forecastRevenue-forecastOutflow,rollingRevenue:month<actualThroughMonth?actualRevenue:forecastRevenue,rollingNetCash:month<actualThroughMonth?actualRevenue-actualOutflow:forecastRevenue-forecastOutflow};
 });
 let cash=plan.opening_cash;
 const closingCash=monthly.map(month=>(cash+=month.netCash));
 let forecastCash=plan.opening_cash;
 const forecastClosingCash=monthly.map(month=>(forecastCash+=month.rollingNetCash));
 const annual={
  revenue:sum(monthly.map(m=>m.revenue)),cogs:sum(monthly.map(m=>m.cogs)),opex:sum(monthly.map(m=>m.opex)),
  capex:sum(monthly.map(m=>m.capex)),financing:sum(monthly.map(m=>m.financing)),zakat:sum(monthly.map(m=>m.zakat)),
  grossProfit:sum(monthly.map(m=>m.grossProfit)),ebitda:sum(monthly.map(m=>m.ebitda)),
  netCash:sum(monthly.map(m=>m.netCash)),actualRevenue:sum(monthly.map(m=>m.actualRevenue)),actualCogs:sum(monthly.map(m=>m.actualCogs)),actualOpex:sum(monthly.map(m=>m.actualOpex)),actualCapex:sum(monthly.map(m=>m.actualCapex)),actualFinancing:sum(monthly.map(m=>m.actualFinancing)),actualZakat:sum(monthly.map(m=>m.actualZakat)),actualOutflow:sum(monthly.map(m=>m.actualOutflow)),actualNetCash:sum(monthly.map(m=>m.actualNetCash)),
  forecastRevenue:sum(monthly.map(m=>m.rollingRevenue)),forecastNetCash:sum(monthly.map(m=>m.rollingNetCash)),
  ytdBudgetRevenue:sum(monthly.slice(0,actualThroughMonth).map(m=>m.revenue)),ytdActualRevenue:sum(monthly.slice(0,actualThroughMonth).map(m=>m.actualRevenue)),
  ytdBudgetOpex:sum(monthly.slice(0,actualThroughMonth).map(m=>m.opex)),ytdActualOpex:sum(monthly.slice(0,actualThroughMonth).map(m=>m.actualOpex))
 };
 return {...annual,monthly,closingCash,
  grossMargin:annual.revenue?annual.grossProfit/annual.revenue:0,
  ebitdaMargin:annual.revenue?annual.ebitda/annual.revenue:0,
  budgetUtilization:annual.revenue?annual.actualRevenue/annual.revenue:0,
  revenueVariance:annual.actualRevenue-annual.revenue,
  revenueVariancePct:annual.revenue?(annual.actualRevenue-annual.revenue)/annual.revenue:0,
  opexVariance:annual.actualOpex-annual.opex,
  opexVariancePct:annual.opex?(annual.actualOpex-annual.opex)/annual.opex:0,
  netCashVariance:annual.actualNetCash-annual.netCash,
  forecastVariance:annual.revenue?(annual.forecastRevenue-annual.revenue)/annual.revenue:0,
  actualThroughMonth,ytdRevenueVariance:annual.ytdActualRevenue-annual.ytdBudgetRevenue,ytdRevenueVariancePct:annual.ytdBudgetRevenue?(annual.ytdActualRevenue-annual.ytdBudgetRevenue)/annual.ytdBudgetRevenue:0,
  ytdOpexVariance:annual.ytdActualOpex-annual.ytdBudgetOpex,ytdOpexVariancePct:annual.ytdBudgetOpex?(annual.ytdActualOpex-annual.ytdBudgetOpex)/annual.ytdBudgetOpex:0,
  endingCash:closingCash[11]??plan.opening_cash,
  minimumCashBuffer:Math.min(...closingCash)-plan.minimum_cash_target,
  forecastClosingCash,
  forecastEndingCash:forecastClosingCash[11]??plan.opening_cash,
  forecastMinimumCashBuffer:Math.min(...forecastClosingCash)-plan.minimum_cash_target
 };
}


export const BUDGET_GROUPS:Record<string,string>={
 'الإيرادات التشغيلية':'الإيرادات التشغيلية','إيرادات أخرى':'إيرادات أخرى','تكلفة المبيعات':'تكلفة المبيعات',
 'إيرادات المشروع':'إيرادات المشروع','إيرادات أخرى للمشروع':'إيرادات المشروع','تكاليف مباشرة للمشروع':'التكاليف المباشرة للمشروع',
 'رواتب إدارية':'الرواتب','رواتب تشغيلية':'الرواتب','الرواتب':'الرواتب',
 'رواتب وأجور المشروع':'رواتب وأجور المشروع','إيجار ومرافق المشروع':'إيجار ومرافق المشروع','تسويق المشروع':'تسويق المشروع',
 'صيانة وتشغيل المشروع':'صيانة وتشغيل المشروع','مواد ومستلزمات المشروع':'مواد ومستلزمات المشروع','نقل ولوجستيات المشروع':'نقل ولوجستيات المشروع',
 'تقنية وأنظمة المشروع':'تقنية وأنظمة المشروع','أتعاب واستشارات المشروع':'أتعاب واستشارات المشروع','إنفاق رأسمالي للمشروع':'الإنفاق الرأسمالي للمشروع',
 'إيجار المقر والخدمات':'الإيجارات والخدمات','إيجارات المواقع التشغيلية':'الإيجارات والخدمات','الإيجار والخدمات':'الإيجارات والخدمات',
 'التسويق والعلامة التجارية':'التسويق','تسويق تشغيلي':'التسويق','التسويق':'التسويق',
 'أتعاب مهنية واستشارات':'المصاريف المهنية','المصاريف المهنية':'المصاريف المهنية',
 'تقنية وأنظمة إدارية':'التقنية والأنظمة','أنظمة وتقنية تشغيلية':'التقنية والأنظمة','التقنية':'التقنية والأنظمة',
 'صيانة وتشغيل':'الصيانة والتشغيل','مواد ومستلزمات تشغيل':'المواد والمستلزمات','نقل ولوجستيات':'النقل واللوجستيات',
 'الإنفاق الرأسمالي':'الإنفاق الرأسمالي','خدمة الدين':'خدمة الدين','مخصص ومدفوعات الزكاة':'الزكاة'
};
export const budgetGroupName=(line:BudgetLine)=>BUDGET_GROUPS[line.name]??line.name;

export type BudgetCenterType='ADMIN'|'OPERATING'|'PROJECT_OPERATING'|'INVESTMENT'|'TREASURY'|'FINANCING';

export const BUDGET_CENTER_TYPE_LABELS:Record<BudgetCenterType,{ar:string;en:string}>={
 ADMIN:{ar:'إداري',en:'Administrative'},
 OPERATING:{ar:'تشغيلي',en:'Operating'},
 PROJECT_OPERATING:{ar:'مشاريع تشغيلية',en:'Operating Projects'},
 INVESTMENT:{ar:'استثماري',en:'Investment'},
 TREASURY:{ar:'خزينة ورأس المال العامل',en:'Treasury & Working Capital'},
 FINANCING:{ar:'تمويلي',en:'Financing'}
};

export function createCostCenterBudgetPlan(costCenter:string,year=new Date().getFullYear()+1,centerType?:BudgetCenterType):BudgetPlan{
 const base=createDefaultBudgetPlan(year),zero=()=>Array(12).fill(0);
 const resolvedCenterType=centerType??(costCenter==='HQ'?'ADMIN':'OPERATING');
 const line=(category:BudgetLine['category'],name:string,line_type:BudgetLine['line_type'],sort_order:number):BudgetLine=>({category,name,line_type,sort_order,monthly_budget:zero(),monthly_actual:zero(),monthly_forecast:zero()});
 const capex=line('CAPEX','الإنفاق الرأسمالي','CASH',90),financing=line('FINANCING','خدمة الدين','CASH',100),zakat=line('ZAKAT','مخصص ومدفوعات الزكاة','CASH',110);
 const lines=resolvedCenterType==='ADMIN'?[
  line('REVENUE','إيرادات أخرى','REVENUE',20),
  line('OPEX','رواتب إدارية','EXPENSE',40),line('OPEX','إيجار المقر والخدمات','EXPENSE',50),
  line('OPEX','التسويق والعلامة التجارية','EXPENSE',60),line('OPEX','أتعاب مهنية واستشارات','EXPENSE',70),
  line('OPEX','تقنية وأنظمة إدارية','EXPENSE',80),capex,financing,zakat
 ]:resolvedCenterType==='PROJECT_OPERATING'?[
  line('REVENUE','إيرادات المشروع','REVENUE',10),line('REVENUE','إيرادات أخرى للمشروع','REVENUE',20),
  line('COGS','تكاليف مباشرة للمشروع','EXPENSE',30),
  line('OPEX','رواتب وأجور المشروع','EXPENSE',40),line('OPEX','إيجار ومرافق المشروع','EXPENSE',50),
  line('OPEX','تسويق المشروع','EXPENSE',60),line('OPEX','صيانة وتشغيل المشروع','EXPENSE',70),
  line('OPEX','مواد ومستلزمات المشروع','EXPENSE',75),line('OPEX','نقل ولوجستيات المشروع','EXPENSE',78),
  line('OPEX','تقنية وأنظمة المشروع','EXPENSE',80),line('OPEX','أتعاب واستشارات المشروع','EXPENSE',85),
  line('CAPEX','إنفاق رأسمالي للمشروع','CASH',90)
 ]:resolvedCenterType==='INVESTMENT'?[
  line('REVENUE','إيرادات استثمارية','REVENUE',10),
  line('CAPEX','اقتناء الأصول','CASH',90),line('CAPEX','استثمارات ومشاريع','CASH',92),
  line('FINANCING','تمويل المشاريع','CASH',100),zakat
 ]:resolvedCenterType==='TREASURY'?[
  line('REVENUE','تحصيلات العملاء','REVENUE',10),
  line('OPEX','سداد الموردين','EXPENSE',30),
  line('FINANCING','تحويلات الخزينة','CASH',100)
 ]:resolvedCenterType==='FINANCING'?[
  line('FINANCING','القروض والتمويل','CASH',100),
  line('FINANCING','سداد أصل الدين','CASH',102),
  line('FINANCING','تكلفة التمويل','EXPENSE',104)
 ]:[
  line('REVENUE','الإيرادات التشغيلية','REVENUE',10),line('COGS','تكلفة المبيعات','EXPENSE',30),
  line('OPEX','رواتب تشغيلية','EXPENSE',40),line('OPEX','إيجارات المواقع التشغيلية','EXPENSE',50),
  line('OPEX','تسويق تشغيلي','EXPENSE',60),line('OPEX','صيانة وتشغيل','EXPENSE',70),
  line('OPEX','مواد ومستلزمات تشغيل','EXPENSE',75),line('OPEX','نقل ولوجستيات','EXPENSE',78),
  line('OPEX','أنظمة وتقنية تشغيلية','EXPENSE',80),capex
 ];
 const typeLabel=BUDGET_CENTER_TYPE_LABELS[resolvedCenterType]?.ar??resolvedCenterType;
 return {...base,id:undefined,name:`الخطة المالية - ${typeLabel} - ${costCenter}`+' '+year,cost_center:costCenter,opening_cash:0,lines};
}

const LEGACY_COST_CENTER_LINE_ALIASES:Record<'HQ'|'OPERATIONS',Record<string,string>>={
 HQ:{'الرواتب':'رواتب إدارية','الإيجار والخدمات':'إيجار المقر والخدمات','التسويق':'التسويق والعلامة التجارية','المصاريف المهنية':'أتعاب مهنية واستشارات','التقنية':'تقنية وأنظمة إدارية'},
 OPERATIONS:{'الرواتب':'رواتب تشغيلية','الإيجار والخدمات':'إيجارات المواقع التشغيلية','التسويق':'تسويق تشغيلي','التقنية':'أنظمة وتقنية تشغيلية'}
};
const twelve=(values:unknown)=>Array.from({length:12},(_,index)=>Math.max(0,Number(Array.isArray(values)?values[index]??0:0)||0));
const persistedLineDate=(line:BudgetLine)=>{
 const value=(line as BudgetLine & {updated_at?:string}).updated_at;
 const timestamp=value?Date.parse(value):Number.NaN;
 return Number.isFinite(timestamp)?timestamp:0;
};

/** Selects one persisted row for a canonical line without deleting duplicates. */
export function selectPersistedBudgetLine(line:BudgetLine,persisted:Array<BudgetLine & {id?:string;updated_at?:string}>,usedIds=new Set<string>()){
 const direct=line.id?persisted.find(old=>old.active!==false&&old.id===line.id):undefined;
 if(direct)return direct;
 return persisted.filter(old=>old.active!==false&&old.category===line.category&&Number(old.sort_order)===Number(line.sort_order)&&!!old.id&&!usedIds.has(old.id))
  .sort((a,b)=>persistedLineDate(b)-persistedLineDate(a))[0];
}

/** Keeps each cost-center plan on its own approved line-item list, including legacy plans. */
export function normalizeCostCenterBudgetPlan(saved:BudgetPlan,costCenter:'HQ'|'OPERATIONS'):BudgetPlan{
 const template=createCostCenterBudgetPlan(costCenter,saved.fiscal_year,costCenter==='HQ'?'ADMIN':'OPERATING');
 const aliases=LEGACY_COST_CENTER_LINE_ALIASES[costCenter];
 const lineWeight=(line:BudgetLine)=>[...line.monthly_budget,...line.monthly_actual,...(line.monthly_forecast??[])].reduce((total,value)=>total+Math.abs(Number(value)||0),0);
 const byName=new Map<string,BudgetLine>();
 saved.lines.forEach(line=>{
  const name=aliases[line.name]??line.name;
  const previous=byName.get(name);
  const lineDate=persistedLineDate(line),previousDate=previous?persistedLineDate(previous):0;
  // Prefer the most recently edited persisted row. This keeps an intentional
  // zero or reduction visible when legacy duplicate rows still exist.
  if(!previous||lineDate>previousDate||(lineDate===previousDate&&lineWeight(line)>=lineWeight(previous)))byName.set(name,line);
 });
 return {...saved,cost_center:costCenter,lines:template.lines.map(line=>{
  const old=byName.get(line.name);
  return old?{...line,id:old.id,name:line.name,category:line.category,line_type:line.line_type,sort_order:line.sort_order,monthly_budget:twelve(old.monthly_budget),monthly_actual:twelve(old.monthly_actual),monthly_forecast:twelve(old.monthly_forecast??old.monthly_budget)}:line;
 })};
}

export function createDefaultBudgetPlan(year=new Date().getFullYear()+1):BudgetPlan{
 const empty=()=>Array(12).fill(0);
 const line=(category:BudgetLine['category'],name:string,line_type:BudgetLine['line_type'],sort_order:number,values:number[]):BudgetLine=>
  ({category,name,line_type,sort_order,monthly_budget:values,monthly_actual:Array(12).fill(0),monthly_forecast:[...values]});
 return {name:`الخطة المالية ${year}`,fiscal_year:year,currency:'SAR',scenario:'BASE',status:'DRAFT',
  organization_name:'',cost_center:'ALL',opening_cash:0,minimum_cash_target:0,
  assumptions:{actual_through_month:0},notes:'',lines:[
   line('REVENUE','الإيرادات التشغيلية','REVENUE',10,empty()),
   line('REVENUE','إيرادات أخرى','REVENUE',20,empty()),
   line('COGS','تكلفة المبيعات','EXPENSE',30,empty()),
   line('OPEX','الرواتب','EXPENSE',40,empty()),
   line('OPEX','الإيجار والخدمات','EXPENSE',50,empty()),
   line('OPEX','التسويق','EXPENSE',60,empty()),
   line('OPEX','المصاريف المهنية','EXPENSE',70,empty()),
   line('OPEX','التقنية','EXPENSE',80,empty()),
   line('CAPEX','الإنفاق الرأسمالي','CASH',90,empty()),
   line('FINANCING','خدمة الدين','CASH',100,empty()),
   line('ZAKAT','مخصص ومدفوعات الزكاة','CASH',110,empty())
  ]};
}
