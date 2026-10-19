export type FinancialSignal={id:string;label:string;value:number;currency:string;note:string;href:string};
type Terms={ownership_scope:string;organization_id?:string|null;instrument:string;currency:string;principal:number;maturity_date:string};
type Contract={id:string;status:string;terms:Terms;projection?:{coupon:number}};
type Operation={contract_id:string;kind:string;status:string;amount:number;settlement_status?:string};
type Loan={status:string;side:string;currency:string;base_currency?:string;schedule?:Array<{due_date:string}>;installments?:Array<{obligation_key:string;outstanding_base_amount:number;base_currency?:string}>};
/** Presentation totals only: posted cash, active investments and obligation balances stay separate. */
export function financialSignals({investments,loans,personalDebts,scope,organizationIds,today,ar,locale}:{investments:{contracts:Contract[];operations:Operation[]}|null;loans:{contracts:Loan[]}|null;personalDebts?:Array<{category?:string;side:string;currency:string;amount:number;dueDate:string|null}>;scope:string;organizationIds:string[];today:string;ar:boolean;locale:string}):FinancialSignal[]{
 const out:FinancialSignal[]=[],through=new Date(Date.parse(today+'T00:00:00Z')+30*86400000).toISOString().slice(0,10);
 const add=(id:string,arLabel:string,enLabel:string,items:Array<{currency:string;value:number}>,note:string,path:string)=>{
  const totals=new Map<string,number>();for(const row of items){if(!Number.isFinite(Number(row.value)))continue;totals.set(row.currency,(totals.get(row.currency)??0)+Number(row.value));}
  for(const [currency,value] of totals)out.push({id:id+':'+currency,label:ar?arLabel:enLabel,value,currency,note,href:`/${locale}/${path}`});
 };
 if(investments){
  const deposits=investments.contracts.filter(c=>c.terms.instrument==='DEPOSIT'&&c.status!=='CANCELLED'&&c.terms.ownership_scope===scope&&(scope==='PERSONAL'||organizationIds.includes(c.terms.organization_id??'')));
  const active=deposits.filter(c=>c.status==='ACTIVE'),currencies=[...new Set(deposits.map(c=>c.terms.currency))];
  const values=(rows:Contract[],fn:(c:Contract)=>number)=>currencies.map(currency=>({currency,value:rows.filter(c=>c.terms.currency===currency).reduce((s,c)=>s+fn(c),0)}));
  add('deposits','الودائع النشطة','Active deposits',values(active,c=>c.terms.principal),ar?'رأس المال النشط؛ المسودات مستبعدة':'Active principal; drafts excluded','investments');
  add('deposit-estimate','عوائد الودائع المتوقعة','Expected deposit returns',values(active,c=>Number(c.projection?.coupon??0)),ar?'تقدير كامل مدة العقود؛ ليس إيرادًا محققًا':'Full contract-term estimate; not recognized revenue','investments');
  add('deposit-received','عوائد الودائع المقبوضة','Deposit cash returns received',values(deposits,c=>investments.operations.filter(o=>o.contract_id===c.id&&o.kind==='INCOME'&&o.status==='POSTED'&&o.settlement_status!=='REVERSED'&&o.settlement_status!=='CANCELLED').reduce((s,o)=>s+Number(o.amount),0)),ar?'صافي المقبوض من العمليات المنفذة؛ تراكمي':'Posted cash receipts; cumulative','investments');
  add('deposit-maturity','ودائع تستحق خلال 30 يومًا','Deposits maturing within 30 days',values(active.filter(c=>c.terms.maturity_date>=today&&c.terms.maturity_date<=through),c=>c.terms.principal),ar?'رأس المال فقط دون العائد المتوقع':'Principal only; excludes estimated returns','investments');
 }
 if(loans){
  const balances=loans.contracts.filter(c=>c.status==='ACTUAL').flatMap(c=>(c.installments??[]).map(i=>({side:c.side,currency:i.base_currency??c.base_currency??c.currency,value:Number(i.outstanding_base_amount),due:c.schedule?.[Number(i.obligation_key?.split(':')[1])-1]?.due_date})));
  for(const side of ['PAYABLE','RECEIVABLE']){
   const rows=balances.filter(b=>b.side===side),currencies=[...new Set(rows.map(b=>b.currency))],totals=(fn:(r:typeof rows[number])=>boolean)=>currencies.map(currency=>({currency,value:rows.filter(r=>r.currency===currency&&fn(r)).reduce((s,r)=>s+Math.max(0,r.value),0)}));
   add('loan-'+side,side==='PAYABLE'?'القروض المستحقة علينا':'القروض الممنوحة المتبقية',side==='PAYABLE'?'Borrowed loans outstanding':'Granted loans outstanding',totals(()=>true),ar?'الرصيد المتبقي من الالتزامات المنفذة':'Outstanding executed obligations','loans');
   add('loan-due-'+side,side==='PAYABLE'?'أقساط دفع خلال 30 يومًا':'أقساط قبض خلال 30 يومًا',side==='PAYABLE'?'Loan payments within 30 days':'Loan collections within 30 days',totals(r=>!!r.due&&r.due>=today&&r.due<=through),ar?'الأقساط غير المسددة فقط':'Unpaid installments only','loans');
   add('loan-overdue-'+side,side==='PAYABLE'?'أقساط دفع متأخرة':'أقساط قبض متأخرة',side==='PAYABLE'?'Overdue loan payments':'Overdue loan collections',totals(r=>!!r.due&&r.due<today),ar?'بحسب تواريخ جدول السداد':'Based on repayment schedule','loans');
  }
 }
 if(scope==='PERSONAL'&&personalDebts){
  for(const side of ['PAYABLE','RECEIVABLE']){
   const rows=personalDebts.filter(d=>d.side===side&&d.category===(side==='PAYABLE'?'P_AP_LOAN':'P_AR_LOAN'));
   add('personal-loan-'+side,side==='PAYABLE'?'القروض الشخصية المستلمة':'السلف والقروض الشخصية الممنوحة',side==='PAYABLE'?'Personal borrowings':'Personal loans granted',rows.map(r=>({currency:r.currency,value:r.amount})),ar?'رصيد الذمم المسجل ضمن تصنيف القروض':'Registered balances classified as loans',side==='PAYABLE'?'payables':'receivables');
   add('personal-loan-due-'+side,side==='PAYABLE'?'قروض شخصية تستحق خلال 30 يومًا':'قروض شخصية للتحصيل خلال 30 يومًا',side==='PAYABLE'?'Personal loans due within 30 days':'Personal loan collections within 30 days',rows.filter(r=>!!r.dueDate&&r.dueDate>=today&&r.dueDate<=through).map(r=>({currency:r.currency,value:r.amount})),ar?'بحسب تاريخ استحقاق الذمة؛ ليس جدول أقساط':'By balance due date; not an installment schedule',side==='PAYABLE'?'payables':'receivables');
  }
 }
 return out;
}
