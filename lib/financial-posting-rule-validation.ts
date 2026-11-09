import type {PostingCoverageRule} from './financial-posting-coverage';

export type PostingRuleForValidation=PostingCoverageRule&{cashActivity?:string};
export type PostingChartAccount={id:string;cash:boolean};
/** Mirrors the live ledger's cash-direction checks before a policy is saved.
 * No amounts or financial source records are manufactured or changed.
 */
export function validatePostingRuleAccounts(
 rules:readonly PostingRuleForValidation[],accounts:readonly PostingChartAccount[]
):string|null{
 const byId=new Map(accounts.map(a=>[a.id,a]));
 const keys=new Set<string>();
 for(const rule of rules){
  const signature=JSON.stringify([rule.eventType,rule.sourceModule,rule.classificationId,rule.cashDirection]);
  if(keys.has(signature))return 'REPORTING_POLICY_DUPLICATE';
  keys.add(signature);
  const debit=byId.get(rule.debitAccountId??'');
  const credit=byId.get(rule.creditAccountId??'');
  if(!debit||!credit)return 'REPORTING_POLICY_ACCOUNT_INVALID';
  if(debit.id===credit.id&&(!debit.cash||rule.cashDirection==='NON_CASH'))
   return 'REPORTING_POLICY_ACCOUNT_INVALID';
  const cashDebit=debit.cash===true,cashCredit=credit.cash===true;
  if(rule.cashDirection==='NON_CASH'&&(cashDebit||cashCredit))
   return 'REPORTING_POLICY_CASH_DIRECTION_INVALID';
  if(rule.cashDirection==='INFLOW'&&(!cashDebit||!cashDebit&&!cashCredit))
   return 'REPORTING_POLICY_CASH_DIRECTION_INVALID';
  if(rule.cashDirection==='OUTFLOW'&&(!cashCredit||!cashDebit&&!cashCredit))
   return 'REPORTING_POLICY_CASH_DIRECTION_INVALID';
  if(!['NON_CASH','INFLOW','OUTFLOW'].includes(rule.cashDirection))
   return 'REPORTING_POLICY_CASH_DIRECTION_INVALID';
  if(cashDebit!==cashCredit&&(!rule.cashActivity||
   !['OPERATING','INVESTING','FINANCING'].includes(rule.cashActivity)))
   return 'REPORTING_POLICY_CASH_ACTIVITY_REQUIRED';
 }
 return null;
}

export type DetailedPostingChartAccount=PostingChartAccount&{
 reportingCode?:string;
 isActive?:boolean;
 isPostable?:boolean;
};

export function isPostingLeaf(account:DetailedPostingChartAccount){
 return Boolean(account.reportingCode&&account.id!==account.reportingCode&&account.isActive!==false&&account.isPostable!==false);
}

export function voucherCashSide(direction:PostingRuleForValidation['cashDirection']){
 if(direction==='INFLOW')return 'debitAccountId' as const;
 if(direction==='OUTFLOW')return 'creditAccountId' as const;
 return null;
}

/** Replacing a single existing cash leg with the voucher selector is safe.
 * Two-cash-leg legacy rules require a separate, source-specific mapping. */
export function detailedPostingDraft<T extends PostingRuleForValidation>(rule:T,accounts:readonly DetailedPostingChartAccount[]){
 const side=voucherCashSide(rule.cashDirection);
 const other=side==='debitAccountId'?'creditAccountId':'debitAccountId';
 const dynamic=side&&accounts.some(a=>a.id===rule[side]&&a.cash)&&!accounts.some(a=>a.id===rule[other]&&a.cash);
 return {...rule,...(dynamic?{[side]:'1000'}:{}),detailed:true as const};
}

export function validateDetailedPostingRule(rule:PostingRuleForValidation,accounts:readonly DetailedPostingChartAccount[]){
 const issue=validatePostingRuleAccounts([rule],accounts);
 if(issue)return issue;
 const side=voucherCashSide(rule.cashDirection);
 for(const field of ['debitAccountId','creditAccountId'] as const){
  if(field===side){
   if(rule[field]!=='1000')return 'REPORTING_VOUCHER_CASH_SELECTOR_REQUIRED';
  }else if(!accounts.some(a=>a.id===rule[field]&&!a.cash&&isPostingLeaf(a))){
   return 'REPORTING_DETAIL_ACCOUNT_REQUIRED';
  }
 }
 return null;
}
