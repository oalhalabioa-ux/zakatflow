import {validatePostingRuleAccounts} from './financial-posting-rule-validation';
import type {DefaultPostingRule,DefaultPostingAccount} from './financial-default-posting-rules';
const postingRuleKey=(r:DefaultPostingRule)=>JSON.stringify([r.eventType,r.sourceModule,r.classificationId,r.cashDirection]);

// Legacy lifecycle BASE conflates depreciation, disposal loss and sale loss.
// It is unsafe to multiply that signature into newly generated account rules.
export function isInheritableSourceTemplate(rule:DefaultPostingRule){
 return !(rule.sourceModule==='ASSET_LIFECYCLE'&&rule.eventType==='ADJUSTMENT'&&rule.classificationId.endsWith(':BASE'));
}

export type InheritanceAccount=DefaultPostingAccount&{normalSide?:string};
export type AccountRuleBinding={accountCode:string;reportingCode:string;baseClassificationId:string;classificationId:string};
export type InheritanceIssue={accountCode:string;reason:'ACCOUNT_INVALID'|'SOURCE_MANAGED'|'NO_TEMPLATE'|'AMBIGUOUS_TEMPLATE'|'COUNTERPART_REQUIRED'};

/** A child inherits a known source signature, not a guessed business transaction.
 * The caller supplies persisted, tenant-scoped bindings. Cash continues to be
 * selected by the voucher; retained earnings is selected by fiscal configuration.
 */
export function inheritAccountPostingRules(
 bindings:readonly AccountRuleBinding[],chart:readonly InheritanceAccount[],
 templates:readonly DefaultPostingRule[],existing:readonly DefaultPostingRule[]=[],
){
 const accounts=chart.filter(a=>a.isActive!==false&&a.isPostable!==false);
 const byId=new Map(chart.map(a=>[a.id,a]));
 const stored=new Set(existing.map(postingRuleKey));
 const proposals=new Map<string,DefaultPostingRule>();
 const issues:InheritanceIssue[]=[];
 for(const binding of bindings){
  const leaf=accounts.find(a=>a.code===binding.accountCode);
  if(!leaf||leaf.code===binding.reportingCode||leaf.reportingCode!==binding.reportingCode){
   issues.push({accountCode:binding.accountCode,reason:'ACCOUNT_INVALID'});continue;
  }
  if(leaf.cash||binding.reportingCode==='3300'){
   issues.push({accountCode:binding.accountCode,reason:'SOURCE_MANAGED'});continue;
  }
  let matched=false;
  for(const template of templates){
   if(!isInheritableSourceTemplate(template))continue;
   const prefix=binding.baseClassificationId+':';
   if(!template.classificationId.startsWith(prefix))continue;
   // The caller supplies only base-classification templates. A configured
   // default may already use a leaf; preserve its counterpart when specializing.
   const debit=byId.get(template.debitAccountId),credit=byId.get(template.creditAccountId);
   const matches=(a:InheritanceAccount|undefined)=>a&&(a.reportingCode??a.code)===binding.reportingCode;
   const debitMatches=matches(debit),creditMatches=matches(credit);
   if(!debitMatches&&!creditMatches)continue;
   matched=true;
   if(debitMatches&&creditMatches){issues.push({accountCode:binding.accountCode,reason:'AMBIGUOUS_TEMPLATE'});continue;}
   const proposal:DefaultPostingRule={...template,
    classificationId:binding.classificationId+':'+template.classificationId.slice(prefix.length),
    ...(debitMatches?{debitAccountId:leaf.id}:{creditAccountId:leaf.id}),
   };
   const key=postingRuleKey(proposal);
   if(stored.has(key))continue;
   if(validatePostingRuleAccounts([proposal],accounts)){
    issues.push({accountCode:binding.accountCode,reason:'COUNTERPART_REQUIRED'});continue;
   }
   const previous=proposals.get(key);
   if(previous&&JSON.stringify(previous)!==JSON.stringify(proposal)){
    proposals.delete(key);stored.add(key);
    issues.push({accountCode:binding.accountCode,reason:'AMBIGUOUS_TEMPLATE'});continue;
   }
   proposals.set(key,proposal);
  }
  if(!matched)issues.push({accountCode:binding.accountCode,reason:'NO_TEMPLATE'});
 }
 return {rules:[...proposals.values()],issues};
}
