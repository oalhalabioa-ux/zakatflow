import {financialPostingCoverage} from './financial-posting-coverage';
import type {RecognitionEvent} from './financial-event-ledger';
import {validatePostingRuleAccounts,type PostingChartAccount,type PostingRuleForValidation} from './financial-posting-rule-validation';

/** An approved empty policy may be valid for an empty historical source,
 * but it is NOT evidence that posting rules have been configured.
 * This check is read-only and never fabricates accounting mappings. */
export type PostingPolicyReadiness={
 approvalStatus:'MISSING'|'DRAFT'|'APPROVED'|'UNKNOWN';
 ruleCount:number;
 sourceLines:number;
 mappedLines:number;
 missingLines:number;
 ambiguousLines:number;
 emptyEvents:number;
 configured:boolean;
};
export type PostingPolicyRecord={status:string;rules:unknown};
export function evaluatePostingPolicy(
 policy:PostingPolicyRecord|null,
 events:readonly RecognitionEvent[]|null,
 accounts:readonly PostingChartAccount[]|null,
):PostingPolicyReadiness{
 const unavailable:PostingPolicyReadiness={
  approvalStatus:policy===null?'MISSING':policy.status==='DRAFT'?'DRAFT':
   policy.status==='APPROVED'?'APPROVED':'UNKNOWN',
  ruleCount:0,sourceLines:0,mappedLines:0,missingLines:0,ambiguousLines:0,
  emptyEvents:0,configured:false,
 };
 if(!events||!Array.isArray(policy?.rules)||!Array.isArray(accounts))return unavailable;
 const raw=policy.rules as unknown[];
 if(!raw.every(r=>typeof r==='object'&&r!==null&&
  ['eventType','sourceModule','classificationId','cashDirection','debitAccountId','creditAccountId']
   .every(k=>typeof (r as Record<string,unknown>)[k]==='string'&&
     ((r as Record<string,string>)[k]).length>0)))return unavailable;
 const rules=raw as PostingRuleForValidation[];
 const coverage=financialPostingCoverage([...events],rules);
 const keys=rules.map(r=>JSON.stringify([r.eventType,r.sourceModule,r.classificationId,r.cashDirection]));
 const valid=keys.length===new Set(keys).size;
 const approved=policy.status==='APPROVED';
 const configured=approved&&valid&&rules.length>0&&
  validatePostingRuleAccounts(rules,accounts)===null&&coverage.missingLines===0&&
  coverage.ambiguousLines===0&&coverage.emptyEvents===0;
 return {
  approvalStatus:unavailable.approvalStatus,ruleCount:rules.length,
  sourceLines:coverage.lineCount,mappedLines:coverage.mappedLines,
  missingLines:coverage.missingLines,ambiguousLines:coverage.ambiguousLines,
  emptyEvents:coverage.emptyEvents,configured,
 };
}
