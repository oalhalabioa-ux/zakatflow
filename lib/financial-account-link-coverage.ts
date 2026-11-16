import {isInheritableSourceTemplate} from './financial-account-rule-inheritance';
import {validateDetailedPostingRule} from './financial-posting-rule-validation';
import type {DefaultPostingRule,DefaultPostingAccount,PostingClassification} from './financial-default-posting-rules';
export type AccountLinkStatus='LINKED'|'PREPARED'|'PENDING_SYNC'|'SOURCE_MANAGED'|'NO_TEMPLATE'|'NEEDS_COMPLETION';
/** Configuration coverage, not proof that a voucher has been posted/tested. */
export function accountLinkCoverage(chart:readonly DefaultPostingAccount[],classifications:readonly PostingClassification[],rules:readonly DefaultPostingRule[],proposals:readonly DefaultPostingRule[]=[]){
 const byId=new Map(chart.map(a=>[a.id,a]));
 const baseIds=new Set(classifications.filter(c=>c.active&&(c.code===c.classification_type||c.is_system)&&!c.metadata?.accountInheritance&&!c.code.startsWith('OPEX_ACCOUNT_')).map(c=>c.id));
 const touches=(r:DefaultPostingRule,a:DefaultPostingAccount)=>r.debitAccountId===a.id||r.creditAccountId===a.id;
 return chart.filter(a=>a.reportingCode&&a.code!==a.reportingCode&&a.isActive!==false&&a.isPostable!==false).map(account=>{
  let status:AccountLinkStatus;
  if(account.cash||account.reportingCode==='3300')status='SOURCE_MANAGED';
  else if(rules.some(r=>touches(r,account)))status=rules.filter(r=>touches(r,account)).every(r=>validateDetailedPostingRule(r,chart)===null)?'LINKED':'NEEDS_COMPLETION';
  else if(proposals.some(r=>touches(r,account)))status='PREPARED';
  else if(rules.some(r=>isInheritableSourceTemplate(r)&&baseIds.has(r.classificationId.split(':')[0])&&[r.debitAccountId,r.creditAccountId].some(id=>{
   const parent=byId.get(id);return parent&&(parent.reportingCode??parent.code)===account.reportingCode;
  })))status='PENDING_SYNC';
  else status='NO_TEMPLATE';
  return {accountCode:account.code,reportingCode:account.reportingCode!,status};
 });
}
