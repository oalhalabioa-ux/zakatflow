export type BudgetLine={
 id?:string;category:'REVENUE'|'COGS'|'OPEX'|'CAPEX'|'FINANCING'|'ZAKAT';
 name:string;line_type:'REVENUE'|'EXPENSE'|'CASH';sort_order:number;
 monthly_budget:number[];monthly_actual:number[];monthly_forecast?:number[];
};

export type BudgetPlan={
 id?:string;name:string;fiscal_year:number;currency:string;
 scenario:'BASE'|'DOWNSIDE'|'UPSIDE';status:'DRAFT'|'IN_REVIEW'|'APPROVED'|'ARCHIVED';
 organization_name:string;cost_center:string;opening_cash:number;minimum_cash_target:number;
 assumptions:Record<string,unknown>;notes:string;lines:BudgetLine[];
};

export const MONTH_KEYS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'] as const;
const sum=(values:number[])=>values.reduce((total,value)=>total+(Number(value)||0),0);
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
 'رواتب إدارية':'الرواتب','رواتب تشغيلية':'الرواتب','الرواتب':'الرواتب',
 'إيجار المقر والخدمات':'الإيجارات والخدمات','إيجارات المواقع التشغيلية':'الإيجارات والخدمات','الإيجار والخدمات':'الإيجارات والخدمات',
 'التسويق والعلامة التجارية':'التسويق','تسويق تشغيلي':'التسويق','التسويق':'التسويق',
 'أتعاب مهنية واستشارات':'المصاريف المهنية','المصاريف المهنية':'المصاريف المهنية',
 'تقنية وأنظمة إدارية':'التقنية والأنظمة','أنظمة وتقنية تشغيلية':'التقنية والأنظمة','التقنية':'التقنية والأنظمة',
 'صيانة وتشغيل':'الصيانة والتشغيل','مواد ومستلزمات تشغيل':'المواد والمستلزمات','نقل ولوجستيات':'النقل واللوجستيات',
 'الإنفاق الرأسمالي':'الإنفاق الرأسمالي','خدمة الدين':'خدمة الدين','مخصص ومدفوعات الزكاة':'الزكاة'
};
export const budgetGroupName=(line:BudgetLine)=>BUDGET_GROUPS[line.name]??line.name;

export function createCostCenterBudgetPlan(costCenter:'HQ'|'OPERATIONS',year=new Date().getFullYear()+1):BudgetPlan{
 const base=createDefaultBudgetPlan(year),zero=()=>Array(12).fill(0);
 const line=(category:BudgetLine['category'],name:string,line_type:BudgetLine['line_type'],sort_order:number):BudgetLine=>({category,name,line_type,sort_order,monthly_budget:zero(),monthly_actual:zero(),monthly_forecast:zero()});
 const capex=line('CAPEX','الإنفاق الرأسمالي','CASH',90),financing=line('FINANCING','خدمة الدين','CASH',100),zakat=line('ZAKAT','مخصص ومدفوعات الزكاة','CASH',110);
 const lines=costCenter==='HQ'?[
  line('REVENUE','إيرادات أخرى','REVENUE',20),
  line('OPEX','رواتب إدارية','EXPENSE',40),line('OPEX','إيجار المقر والخدمات','EXPENSE',50),
  line('OPEX','التسويق والعلامة التجارية','EXPENSE',60),line('OPEX','أتعاب مهنية واستشارات','EXPENSE',70),
  line('OPEX','تقنية وأنظمة إدارية','EXPENSE',80),capex,financing,zakat
 ]:[
  line('REVENUE','الإيرادات التشغيلية','REVENUE',10),line('COGS','تكلفة المبيعات','EXPENSE',30),
  line('OPEX','رواتب تشغيلية','EXPENSE',40),line('OPEX','إيجارات المواقع التشغيلية','EXPENSE',50),
  line('OPEX','تسويق تشغيلي','EXPENSE',60),line('OPEX','صيانة وتشغيل','EXPENSE',70),
  line('OPEX','مواد ومستلزمات تشغيل','EXPENSE',75),line('OPEX','نقل ولوجستيات','EXPENSE',78),
  line('OPEX','أنظمة وتقنية تشغيلية','EXPENSE',80),capex
 ];
 return {...base,id:undefined,name:`${costCenter==='HQ'?'الخطة المالية - الإدارة العامة':'الخطة المالية - التشغيل'} ${year}`,cost_center:costCenter,opening_cash:0,lines};
}

export function createDefaultBudgetPlan(year=new Date().getFullYear()+1):BudgetPlan{
 const annualGrowth=0.012,monthlyRate=Math.pow(1+annualGrowth,1/12)-1;
 const monthly=(value:number)=>Array.from({length:12},(_,i)=>Math.round(value*Math.pow(1+monthlyRate,i)));
 const flat=(value:number)=>Array(12).fill(value);
 const line=(category:BudgetLine['category'],name:string,line_type:BudgetLine['line_type'],sort_order:number,values:number[]):BudgetLine=>
  ({category,name,line_type,sort_order,monthly_budget:values,monthly_actual:Array(12).fill(0),monthly_forecast:[...values]});
 return {name:`الخطة المالية ${year}`,fiscal_year:year,currency:'SAR',scenario:'BASE',status:'DRAFT',
  organization_name:'منشأتي',cost_center:'ALL',opening_cash:1000000,minimum_cash_target:500000,
  assumptions:{revenue_growth:annualGrowth,cogs_ratio:0.35,zakat_rate:0.025,actual_through_month:0},notes:'',lines:[
   line('REVENUE','الإيرادات التشغيلية','REVENUE',10,monthly(500000)),
   line('REVENUE','إيرادات أخرى','REVENUE',20,flat(25000)),
   line('COGS','تكلفة المبيعات','EXPENSE',30,monthly(175000)),
   line('OPEX','الرواتب','EXPENSE',40,monthly(120000)),
   line('OPEX','الإيجار والخدمات','EXPENSE',50,flat(35000)),
   line('OPEX','التسويق','EXPENSE',60,flat(20000)),
   line('OPEX','المصاريف المهنية','EXPENSE',70,flat(15000)),
   line('OPEX','التقنية','EXPENSE',80,flat(12000)),
   line('CAPEX','الإنفاق الرأسمالي','CASH',90,flat(150000)),
   line('FINANCING','خدمة الدين','CASH',100,flat(40000)),
   line('ZAKAT','مخصص ومدفوعات الزكاة','CASH',110,flat(20000))
  ]};
}
