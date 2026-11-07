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
