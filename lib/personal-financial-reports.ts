import Decimal from 'decimal.js';
import {cashStatement,registerPosition,type RegisterData} from './financial-register';

/** Personal reports are a read-only register view, not corporate journal postings. */
export type PersonalCategory='CASH'|'RECEIVABLE'|'LOAN_RECEIVABLE'|'SUPPLIER_ADVANCE'|'OTHER_ASSET'|'INVESTMENT'|'PAYABLE'|'LOAN_PAYABLE'|'CUSTOMER_ADVANCE';
export const PERSONAL_DEFAULT_CHART:ReadonlyArray<{id:PersonalCategory;code:string;ar:string;en:string;kind:'ASSET'|'LIABILITY'}>=[
 {id:'CASH',code:'1000',ar:'النقد والبنوك',en:'Cash and banks',kind:'ASSET'},
 {id:'RECEIVABLE',code:'1100',ar:'ذمم شخصية مدينة',en:'Personal receivables',kind:'ASSET'},
 {id:'LOAN_RECEIVABLE',code:'1200',ar:'قروض شخصية ممنوحة',en:'Personal loans receivable',kind:'ASSET'},
 {id:'SUPPLIER_ADVANCE',code:'1300',ar:'دفعات مقدمة',en:'Advance payments',kind:'ASSET'},
 // Personal valuables are not automatically corporate fixed assets (1500).
 {id:'OTHER_ASSET',code:'P-OTHER',ar:'أصول شخصية أخرى غير مصنفة',en:'Other unclassified personal assets',kind:'ASSET'},
 {id:'INVESTMENT',code:'1600',ar:'الاستثمارات',en:'Investments',kind:'ASSET'},
 {id:'PAYABLE',code:'2100',ar:'التزامات شخصية',en:'Personal payables',kind:'LIABILITY'},
 {id:'LOAN_PAYABLE',code:'2200',ar:'قروض شخصية مستحقة',en:'Personal borrowings',kind:'LIABILITY'},
 {id:'CUSTOMER_ADVANCE',code:'2400',ar:'دفعات مستلمة مقدمًا',en:'Advances received',kind:'LIABILITY'},
] as const;

export type PersonalReport={
 scope:'PERSONAL';basis:'CURRENT_PERSONAL_REGISTER_ESTIMATE';asOf:string;from:string;to:string;baseCurrency:string;
 categories:Array<{id:PersonalCategory;code:string;ar:string;en:string;currency:string;amount:string;kind:'ASSET'|'LIABILITY'}>;
 positions:Array<{currency:string;cash:string;receivables:string;otherAssets:string;investments:string;liabilities:string;netWorth:string|null;complete:boolean;unreconciled:number;unallocated:string}>;
 cashAccounts:Array<{id:string;name:string;currency:string;opening:string;inflows:string;outflows:string;closing:string;netMovement:string;movementCount:number}>;
 issues:string[];
};

const D=Decimal.clone({precision:40});
const money=(value:number|string)=>{const d=new D(value);if(!d.isFinite())throw Error('PERSONAL_REPORT_AMOUNT_INVALID');return d.toDecimalPlaces(2).toFixed(2)};
const add=(values:Array<number|string>)=>money(values.reduce((sum,value)=>sum.plus(value),new D(0)).toString());

/** Never interpret money moving into a personal bank account as income.
 * A personal P&L requires separately classified, recognized income/expenses. */
export function personalFinancialReports(data:RegisterData,from:string,to:string):PersonalReport{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to||to>data.asOf)throw Error('PERSONAL_REPORT_PERIOD_INVALID');
 if(data.organizationIds.length||data.accounts.some(a=>a.organizationId!==null||a.entityId!==null)||
  data.debts.some(d=>d.organizationId!==null)||data.assets.some(a=>a.organizationId!==null))throw Error('PERSONAL_REPORT_SCOPE_INVALID');
 const chart=PERSONAL_DEFAULT_CHART;
 const amounts=new Map<string,number[]>();
 const include=(id:PersonalCategory,currency:string,value:number)=>{if(!/^[A-Z]{3}$/.test(currency)||!Number.isFinite(value))throw Error('PERSONAL_REPORT_AMOUNT_INVALID');
  const key=id+':'+currency;amounts.set(key,[...(amounts.get(key)??[]),value]);};
 for(const a of data.accounts)include('CASH',a.baseCurrency,a.baseBalance);
 for(const d of data.debts){if(d.side==='UNAPPLIED')continue;
  const code:PersonalCategory=d.side==='RECEIVABLE'?(d.category==='P_AR_LOAN'?'LOAN_RECEIVABLE':'RECEIVABLE'):
   d.side==='SUPPLIER_ADVANCE'?'SUPPLIER_ADVANCE':d.side==='PAYABLE'?(d.category==='P_AP_LOAN'?'LOAN_PAYABLE':'PAYABLE'):'CUSTOMER_ADVANCE';
  include(code,d.currency,d.amount);}
 for(const a of data.assets){if(a.category==='LEGACY_CASH'||a.category==='LEGACY_RECEIVABLE')continue;
  include(a.category==='INVESTMENT'?'INVESTMENT':'OTHER_ASSET',a.currency,a.market);}
 const categories=[...amounts.entries()].map(([key,values])=>{
  const [id,currency]=key.split(':') as [PersonalCategory,string],template=chart.find(c=>c.id===id);
  if(!template)throw Error('PERSONAL_REPORT_CATEGORY_INVALID');return{...template,currency,amount:add(values)};
 }).sort((a,b)=>a.code.localeCompare(b.code)||a.currency.localeCompare(b.currency));
 const sourceUnverified=data.warnings.some(code=>code==='PERSONAL_CONTRACT_SCHEDULE_UNAVAILABLE');
 const positions=registerPosition(data.accounts,data.debts,data.assets).map(p=>{
  const investment=add(data.assets.filter(a=>a.category==='INVESTMENT'&&a.currency===p.currency).map(a=>a.market));
  const otherAssets=new D(p.market?money(p.market):'0').minus(investment).toString();
  const unallocated=add(data.debts.filter(d=>d.currency===p.currency&&d.side==='UNAPPLIED').map(d=>d.amount));
  return{currency:p.currency,cash:money(p.cash),receivables:money(p.receivables),otherAssets:money(otherAssets),investments:investment,
   liabilities:money(p.liabilities),netWorth:p.net===null||sourceUnverified?null:money(p.net),complete:p.net!==null&&!sourceUnverified,unreconciled:p.unreconciled,unallocated};
 });
 const cashAccounts=data.accounts.map(a=>{
  const s=cashStatement(a,data.cashMovements,from,to);return{id:a.id,name:a.name,currency:a.currency,
   opening:money(s.opening),inflows:money(s.inflows),outflows:money(s.outflows),closing:money(s.closing),
   netMovement:money(new D(s.closing).minus(s.opening).toString()),movementCount:s.lines.length};
 });
 const issues=[...data.warnings];
 if(positions.some(p=>!p.complete))issues.push('PERSONAL_POSITION_RECONCILIATION_REQUIRED');
 if(positions.length>1)issues.push('PERSONAL_MULTI_CURRENCY_NOT_AGGREGATED');
 issues.push('PERSONAL_INCOME_EXPENSE_CLASSIFICATION_PENDING','PERSONAL_CASH_GROSS_INCLUDES_INTERNAL_TRANSFERS');
 return{scope:'PERSONAL',basis:'CURRENT_PERSONAL_REGISTER_ESTIMATE',asOf:data.asOf,from,to,baseCurrency:data.baseCurrency,categories,positions,cashAccounts,issues:[...new Set(issues)]};
}
