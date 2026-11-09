import type {PostingRule,RecognitionEvent} from './financial-event-ledger';
import {validatePostingRuleAccounts} from './financial-posting-rule-validation';

export type DefaultPostingRule=Pick<PostingRule,'eventType'|'sourceModule'|'classificationId'|'cashDirection'|'debitAccountId'|'creditAccountId'|'cashActivity'>;
export type PostingClassification={id:string;code:string;name:string;classification_type:string;active:boolean};
export type DefaultPostingAccount={id:string;code:string;cash:boolean;reportingCode?:string;isActive?:boolean;isPostable?:boolean};
export const POSTING_BASE_CLASSIFICATIONS=[
 ['REVENUE','الإيرادات'],['OPEX','المصروفات التشغيلية'],['CAPEX','شراء الأصول الثابتة'],
 ['INVESTMENT','شراء الاستثمارات'],['TAX','الضرائب'],['ZAKAT','الزكاة'],
 ['RECEIVABLE','تحصيل الذمم المدينة'],['PAYABLE','سداد الذمم الدائنة'],
] as const;
export const postingRuleKey=(r:Pick<DefaultPostingRule,'eventType'|'sourceModule'|'classificationId'|'cashDirection'>)=>JSON.stringify([r.eventType,r.sourceModule,r.classificationId,r.cashDirection]);

/** Draft proposals only. Uses the tenant's authorized posting chart and real
 * classifications. Never changes vouchers, amounts, policy approval or balances.
 * Custom source modules/complex allocations require explicit user mappings. */
export function defaultPostingRules(classifications:readonly PostingClassification[],chart:readonly DefaultPostingAccount[],events:readonly RecognitionEvent[]=[],existing:readonly DefaultPostingRule[]=[]){
 const accounts=chart.filter(a=>a.isActive!==false&&a.isPostable!==false);
 function account(control:string){
  const leaves=accounts.filter(a=>a.code!==control&&(a.reportingCode?a.reportingCode===control:a.code.startsWith(control)));
  if(leaves.length===1)return leaves[0].id;
  return accounts.find(a=>a.code===control)?.id??'';
 }
 const proposals=new Map<string,DefaultPostingRule>();
 const unresolved:{classificationId:string;eventType:string;sourceModule:string;cashDirection:DefaultPostingRule['cashDirection'];reason:'ACCOUNTS_REQUIRED'}[]=[];
 function add(c:PostingClassification,eventType:string,sourceModule:string,part:string,direction:DefaultPostingRule['cashDirection'],debit:string,credit:string,activity?:DefaultPostingRule['cashActivity']){
  const rule:DefaultPostingRule={eventType,sourceModule,classificationId:c.id+':'+part,cashDirection:direction,debitAccountId:account(debit),creditAccountId:account(credit),...(activity?{cashActivity:activity}:{})};
  const key=postingRuleKey(rule);if(proposals.has(key))return;
  if(validatePostingRuleAccounts([rule],accounts)){unresolved.push({classificationId:rule.classificationId,eventType,sourceModule,cashDirection:direction,reason:'ACCOUNTS_REQUIRED'});return;}
  proposals.set(key,rule);
 }
 for(const c of classifications.filter(c=>c.active)){
  const type=c.classification_type;
  // Liquidity detail classifications split expense recognition. Settlement
  // still follows the payable, and VAT continues to use generic OPEX.
  if(type==='OPEX'&&c.code.startsWith('OPEX_')){
   add(c,'EXPENSE','OPERATIONAL_CONSOLE','BASE','NON_CASH','6100','2100');
   continue;
  }
  // These signatures match the native operational editor's actual contract.
  if(type==='REVENUE'){
   add(c,'REVENUE','OPERATIONAL_CONSOLE','BASE','NON_CASH','1100','4100');
   add(c,'SETTLEMENT','OPERATIONAL_CONSOLE','BASE','INFLOW','1000','1100','OPERATING');
  }
  const expenseTemplates:Record<string,readonly [string,string,NonNullable<DefaultPostingRule['cashActivity']>]>= {OPEX:['6100','2100','OPERATING'],CAPEX:['1500','2100','INVESTING'],INVESTMENT:['1600','2100','INVESTING'],TAX:['8100','2300','OPERATING'],ZAKAT:['8100','2300','OPERATING']};
  const expense=expenseTemplates[type];
  if(expense){
   const assetPurchase=type==='CAPEX'||type==='INVESTMENT';
   add(c,assetPurchase?'ASSET_PURCHASE':'EXPENSE','OPERATIONAL_CONSOLE','BASE','NON_CASH',expense[0],expense[1]);
   // Support historical console expenses only when that signature actually occurs.
   // An already saved rule with either signature is preserved below.
   if(assetPurchase&&events.some(event=>event.eventType==='EXPENSE'&&event.sourceModule==='OPERATIONAL_CONSOLE'&&
     event.lines.some(line=>line.classificationId===c.id+':BASE'&&line.cashDirection==='NON_CASH'))){
    add(c,'EXPENSE','OPERATIONAL_CONSOLE','BASE','NON_CASH',expense[0],expense[1]);
   }
   add(c,'SETTLEMENT','OPERATIONAL_CONSOLE','BASE','OUTFLOW',expense[1],'1000',expense[2]);
  }
  if(type==='RECEIVABLE')add(c,'SETTLEMENT','OPERATIONAL_CONSOLE','BASE','INFLOW','1000','1100','OPERATING');
  if(type==='PAYABLE')add(c,'SETTLEMENT','OPERATIONAL_CONSOLE','BASE','OUTFLOW','2100','1000','OPERATING');
  // Original VAT adapter uses real OPEX/TAX/REVENUE classifications and
  // normalized parts. Do not map generic BASE tax to recoverable VAT.
  if(type==='OPEX')add(c,'EXPENSE','VAT_INTEGRATION','NET_RECOGNITION','NON_CASH','6100','2100');
  if(type==='TAX'){
   add(c,'EXPENSE','VAT_INTEGRATION','INPUT_VAT_RECOVERABLE','NON_CASH','1400','2100');
   add(c,'EXPENSE','VAT_INTEGRATION','INPUT_VAT_NONRECOVERABLE','NON_CASH','6100','2100');
  }
 }
 // Existing user rules always win, including deliberately incomplete drafts.
 const stored=new Set(existing.map(postingRuleKey));
 const rules=[...proposals.values()].filter(r=>!stored.has(postingRuleKey(r)));
 const observed=new Set(events.flatMap(e=>e.lines.map(l=>postingRuleKey({...e,...l}))));
 return {version:1 as const,rules,unresolved:unresolved.filter(r=>!stored.has(postingRuleKey(r))),testedRuleCount:rules.filter(r=>observed.has(postingRuleKey(r))).length};
}
