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
 const monthly=MONTH_KEYS.map((_,month)=>{
  const revenue=category(plan.lines,'REVENUE','monthly_budget',month);
  const cogs=category(plan.lines,'COGS','monthly_budget',month);
  const opex=category(plan.lines,'OPEX','monthly_budget',month);
  const capex=category(plan.lines,'CAPEX','monthly_budget',month);
  const financing=category(plan.lines,'FINANCING','monthly_budget',month);
  const zakat=category(plan.lines,'ZAKAT','monthly_budget',month);
  const actualRevenue=category(plan.lines,'REVENUE','monthly_actual',month);
  const actualOutflow=sum(plan.lines.filter(line=>line.category!=='REVENUE').map(line=>at(line,'monthly_actual',month)));
  const forecastRevenue=category(plan.lines,'REVENUE','monthly_forecast',month);
  const forecastOutflow=sum(plan.lines.filter(line=>line.category!=='REVENUE').map(line=>at(line,'monthly_forecast',month)));
  return {revenue,cogs,opex,capex,financing,zakat,grossProfit:revenue-cogs,ebitda:revenue-cogs-opex,
   netCash:revenue-cogs-opex-capex-financing-zakat,actualRevenue,actualOutflow,
   forecastRevenue,forecastOutflow,forecastNetCash:forecastRevenue-forecastOutflow};
 });
 let cash=plan.opening_cash;
 const closingCash=monthly.map(month=>(cash+=month.netCash));
 let forecastCash=plan.opening_cash;
 const forecastClosingCash=monthly.map(month=>(forecastCash+=month.forecastNetCash));
 const annual={
  revenue:sum(monthly.map(m=>m.revenue)),cogs:sum(monthly.map(m=>m.cogs)),opex:sum(monthly.map(m=>m.opex)),
  capex:sum(monthly.map(m=>m.capex)),financing:sum(monthly.map(m=>m.financing)),zakat:sum(monthly.map(m=>m.zakat)),
  grossProfit:sum(monthly.map(m=>m.grossProfit)),ebitda:sum(monthly.map(m=>m.ebitda)),
  netCash:sum(monthly.map(m=>m.netCash)),actualRevenue:sum(monthly.map(m=>m.actualRevenue)),
  forecastRevenue:sum(monthly.map(m=>m.forecastRevenue)),forecastNetCash:sum(monthly.map(m=>m.forecastNetCash))
 };
 return {...annual,monthly,closingCash,
  grossMargin:annual.revenue?annual.grossProfit/annual.revenue:0,
  ebitdaMargin:annual.revenue?annual.ebitda/annual.revenue:0,
  budgetUtilization:annual.revenue?annual.actualRevenue/annual.revenue:0,
  forecastVariance:annual.revenue?(annual.forecastRevenue-annual.revenue)/annual.revenue:0,
  endingCash:closingCash[11]??plan.opening_cash,
  minimumCashBuffer:Math.min(...closingCash)-plan.minimum_cash_target,
  forecastClosingCash,
  forecastEndingCash:forecastClosingCash[11]??plan.opening_cash,
  forecastMinimumCashBuffer:Math.min(...forecastClosingCash)-plan.minimum_cash_target
 };
}

export function createDefaultBudgetPlan(year=new Date().getFullYear()+1):BudgetPlan{
 const monthly=(value:number)=>Array.from({length:12},(_,i)=>Math.round(value*Math.pow(1.012,i)));
 const flat=(value:number)=>Array(12).fill(value);
 const line=(category:BudgetLine['category'],name:string,line_type:BudgetLine['line_type'],sort_order:number,values:number[]):BudgetLine=>
  ({category,name,line_type,sort_order,monthly_budget:values,monthly_actual:Array(12).fill(0),monthly_forecast:[...values]});
 return {name:`الخطة المالية ${year}`,fiscal_year:year,currency:'SAR',scenario:'BASE',status:'DRAFT',
  organization_name:'منشأتي',cost_center:'ALL',opening_cash:1000000,minimum_cash_target:500000,
  assumptions:{revenue_growth:0.012,cogs_ratio:0.35,zakat_rate:0.025},notes:'',lines:[
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
