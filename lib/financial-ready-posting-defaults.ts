import {defaultPostingRules,postingRuleKey,type DefaultPostingRule,type DefaultPostingAccount,type PostingClassification} from './financial-default-posting-rules';
import {detailedPostingDraft,validateDetailedPostingRule} from './financial-posting-rule-validation';
import type {RecognitionEvent} from './financial-event-ledger';

/** Role bindings are persisted per organization by the database. Never choose
 * the first child, infer a party from a name, or replace an explicit leaf edit. */
export type PostingAccountRoles=Record<string,string>;
export function readyPostingDefaults(classifications:PostingClassification[],chart:DefaultPostingAccount[],events:RecognitionEvent[],existing:DefaultPostingRule[],roles:PostingAccountRoles){
 const generated=defaultPostingRules(classifications,chart,events,[],roles);
 const templates=new Map(generated.rules.map(r=>[postingRuleKey(r),r]));
 const repaired=existing.map(rule=>{
  const template=templates.get(postingRuleKey(rule));
  const next={...rule};
  for(const field of ['debitAccountId','creditAccountId'] as const){
   const current=chart.find(a=>a.id===rule[field]);
   // Only replace a known legacy parent. Missing/disabled/custom accounts need
   // an explicit correction; silently changing those could change user intent.
   if(current&&current.code.length===4&&current.code===(current.reportingCode??current.code)&&current.code!=='1000'&&template)
    next[field]=template[field];
  }
  return detailedPostingDraft(next,chart);
 });
 const keys=new Set(repaired.map(postingRuleKey));
 const rules=[...repaired,...generated.rules.filter(r=>!keys.has(postingRuleKey(r))).map(r=>detailedPostingDraft(r,chart))];
 const issue=rules.map(r=>validateDetailedPostingRule(r,chart)).find(Boolean);
 return {rules,issue:issue??(rules.length?null:'REPORTING_DEFAULT_ACCOUNTS_REQUIRED'),unresolved:generated.unresolved};
}
