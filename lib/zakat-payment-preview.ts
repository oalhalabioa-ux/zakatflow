/** Display-only preview; the authenticated payment command remains authoritative. */
export function zakatPaymentPreview({amount,finalRemaining,carriedCredit,accountBalance,posted=false,previousAllocated=0,previousCarried=0,cashAmount}:{amount:number;finalRemaining:number;carriedCredit:number;accountBalance:number|null;posted?:boolean;previousAllocated?:number;previousCarried?:number;cashAmount?:number}) {
 const valid=Number.isFinite(amount)&&amount>0;
 const payment=valid?amount:0;
 const remaining=Math.max(0,finalRemaining+(posted?0:previousAllocated));
 const debit=posted?0:(cashAmount??payment);
 return {
  debit,valid,
  before:accountBalance,
  after:accountBalance===null?null:accountBalance-debit,
  insufficient:accountBalance!==null&&debit>accountBalance+0.000001,
  remaining:posted?Math.max(0,finalRemaining):Math.max(0,remaining-payment),
  carried:posted?Math.max(0,carriedCredit):Math.max(0,carriedCredit-previousCarried)+Math.max(0,payment-remaining),
 };
}
