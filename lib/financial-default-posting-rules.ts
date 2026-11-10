import {ASSET_LIFECYCLE_POSTING_TEMPLATES} from './financial-asset-posting-templates';
import {inheritAccountPostingRules,type AccountRuleBinding} from './financial-account-rule-inheritance';
import type {PostingRule,RecognitionEvent} from './financial-event-ledger';
import {validatePostingRuleAccounts} from './financial-posting-rule-validation';

export type DefaultPostingRule=Pick<PostingRule,'eventType'|'sourceModule'|'classificationId'|'cashDirection'|'debitAccountId'|'creditAccountId'|'cashActivity'>;
export type PostingClassification={id:string;code:string;name:string;classification_type:string;active:boolean;is_system?:boolean;metadata?:{accountInheritance?:AccountRuleBinding}};
export type DefaultPostingAccount={id:string;code:string;cash:boolean;reportingCode?:string;isActive?:boolean;isPostable?:boolean};
export const POSTING_BASE_CLASSIFICATIONS=[
 ['REVENUE','الإيرادات'],['OPEX','المصروفات التشغيلية'],['CAPEX','شراء الأصول الثابتة'],
 ['INVESTMENT','شراء الاستثمارات'],['TAX','الضرائب'],['ZAKAT','الزكاة'],
 ['ASSET','الأصول'],['RECEIVABLE','تحصيل الذمم المدينة'],['PAYABLE','سداد الذمم الدائنة'],
] as const;
export const postingRuleKey=(r:Pick<DefaultPostingRule,'eventType'|'sourceModule'|'classificationId'|'cashDirection'>)=>JSON.stringify([r.eventType,r.sourceModule,r.classificationId,r.cashDirection]);

/** Draft proposals only. Uses the tenant's authorized posting chart and real
 * classifications. Never changes vouchers, amounts, policy approval or balances.
 * Custom source modules/complex allocations require explicit user mappings. */
export function defaultPostingRules(classifications:readonly PostingClassification[],chart:readonly DefaultPostingAccount[],events:readonly RecognitionEvent[]=[],existing:readonly DefaultPostingRule[]=[],roles:Readonly<Record<string,string>>={}){
 const accounts=chart.filter(a=>a.isActive!==false&&a.isPostable!==false);
 function account(control:string){
  if(!control)return '';
  if(roles[control])return accounts.find(a=>a.id===roles[control])?.id??'';
  const exact=accounts.find(a=>a.code===control);
  if(control.length>4)return exact?.id??'';
  const leaves=accounts.filter(a=>a.code!==control&&(a.reportingCode?a.reportingCode===control:a.code.startsWith(control)));
  if(leaves.length===1)return leaves[0].id;
  return accounts.find(a=>a.code===control)?.id??'';
 }
 const proposals=new Map<string,DefaultPostingRule>();
 const unresolved:{classificationId:string;eventType:string;sourceModule:string;cashDirection:DefaultPostingRule['cashDirection'];reason:'ACCOUNTS_REQUIRED'}[]=[];
 function add(c:PostingClassification,eventType:string,sourceModule:string,part:string,direction:DefaultPostingRule['cashDirection'],debit:string,credit:string,activity?:DefaultPostingRule['cashActivity'],classificationId=c.id+':'+part){
  const rule:DefaultPostingRule={eventType,sourceModule,classificationId,cashDirection:direction,debitAccountId:account(debit),creditAccountId:account(credit),...(activity?{cashActivity:activity}:{})};
  const key=postingRuleKey(rule);if(proposals.has(key))return;
  if(validatePostingRuleAccounts([rule],accounts)){unresolved.push({classificationId:rule.classificationId,eventType,sourceModule,cashDirection:direction,reason:'ACCOUNTS_REQUIRED'});return;}
  proposals.set(key,rule);
 }
 for(const c of classifications.filter(c=>c.active)){
  if(c.metadata?.accountInheritance)continue;
  const type=c.classification_type;
  // Liquidity detail classifications split expense recognition. Settlement
  // still follows the payable, and VAT continues to use generic OPEX.
  if(type==='OPEX'&&c.code.startsWith('OPEX_')){
   const generated=c.code.startsWith('OPEX_ACCOUNT_');
   const accountCode=generated?c.code.slice('OPEX_ACCOUNT_'.length):'6100';
   // A generated identifier is not authority to post to another chart group.
   // Honor the stored parent before falling back to legacy numeric prefixes.
   const leaf=accounts.find(a=>a.code===accountCode);
   const valid=!generated||(accountCode.length>4&&leaf&&
    (leaf.reportingCode?leaf.reportingCode==='6100':accountCode.startsWith('6100')));
   add(c,'EXPENSE','OPERATIONAL_CONSOLE','BASE','NON_CASH',valid?accountCode:'','2100');
   continue;
  }
  if(c.code==='DEBT_PRINCIPAL_ASSET'&&type==='ASSET'){
   add(c,'ADJUSTMENT','DEBT_CONTRACTS','DEBT_FUNDED_O_AR_LOAN','OUTFLOW','1200','1000','INVESTING');
   add(c,'ADJUSTMENT','DEBT_CONTRACTS','DEBT_FUNDED_O_AR_EMPLOYEE','OUTFLOW',roles.EMPLOYEE?'EMPLOYEE':'1100','1000','OPERATING');continue;
  }
  if(c.code==='DEBT_PRINCIPAL_LIABILITY'&&type==='LIABILITY'){
   add(c,'ADJUSTMENT','DEBT_CONTRACTS','DEBT_FUNDED_O_AP_LOAN','INFLOW','1000','2200','FINANCING');continue;
  }
  // Opening debt is recognized by the opening workspace, not a fabricated
  // second leg in the movement ledger. Legacy BASE signatures stay unchanged.
  if(c.code==='DEBT_RECEIVABLE_CLEARING'||c.code==='DEBT_PAYABLE_CLEARING')continue;
  // Dedicated native contracts must not fall through into generic console
  // signatures. Advance application needs original captured counterpart legs,
  // so clearing classifications are deliberately not guessed here.
  if(c.code==='ADVANCE_SUPPLIER_ASSET'&&type==='ASSET'){
   add(c,'SETTLEMENT','ADVANCE_WORKSPACE','BASE','OUTFLOW','1300','1000','OPERATING');continue;
  }
  if(c.code==='ADVANCE_CUSTOMER_LIABILITY'&&type==='LIABILITY'){
   add(c,'SETTLEMENT','ADVANCE_WORKSPACE','BASE','INFLOW','1000','2400','OPERATING');continue;
  }
  if(c.code==='ADVANCE_PAYABLE_CLEARING'||c.code==='ADVANCE_RECEIVABLE_CLEARING')continue;
  if(c.code==='CONTRACT_FINANCE_COST'&&type==='OPEX'){
   add(c,'EXPENSE','FINANCE_CONTRACTS','BASE','NON_CASH','7100','2100');continue;
  }
  if(c.code==='CONTRACT_FINANCE_RETURN'&&type==='REVENUE'){
   add(c,'REVENUE','FINANCE_CONTRACTS','BASE','NON_CASH','1100','4100');continue;
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
  // Native asset acquisitions carry capitalized cost separately from the
  // already-recoverable VAT amount; no second VAT split is performed here.
  if(type==='CAPEX'||type==='INVESTMENT')add(c,'ASSET_PURCHASE','ASSETS_INTEGRATION','BASE','NON_CASH',type==='CAPEX'?'1500':'1600','2100');
  if(type==='TAX')add(c,'ASSET_PURCHASE','ASSETS_INTEGRATION','BASE','NON_CASH','1400','2100');
  if(type==='RECEIVABLE')add(c,'SETTLEMENT','OPERATIONAL_CONSOLE','BASE','INFLOW','1000','1100','OPERATING');
  if(type==='PAYABLE')add(c,'SETTLEMENT','OPERATIONAL_CONSOLE','BASE','OUTFLOW','2100','1000','OPERATING');
  // Original VAT adapter uses real OPEX/TAX/REVENUE classifications and
  // normalized parts. Do not map generic BASE tax to recoverable VAT.
  if(type==='OPEX'){
   for(const event of ['EXPENSE','ADJUSTMENT'])add(c,event,'VAT_INTEGRATION','NET_RECOGNITION','NON_CASH','6100','2100');
   add(c,'ADJUSTMENT','VAT_INTEGRATION','','NON_CASH','1800','2100',undefined,'VAT_NOTE_REFUND_RECEIVABLE');
  }
  if(type==='REVENUE'){
   for(const event of ['REVENUE','ADJUSTMENT'])add(c,event,'VAT_INTEGRATION','NET_RECOGNITION','NON_CASH','1100','4100');
   add(c,'ADJUSTMENT','VAT_INTEGRATION','','NON_CASH','1100','2500',undefined,'VAT_NOTE_REFUND_PAYABLE');
  }
  if(type==='TAX'){
   for(const event of ['EXPENSE','ADJUSTMENT']){
    add(c,event,'VAT_INTEGRATION','INPUT_VAT_RECOVERABLE','NON_CASH','1400','2100');
    add(c,event,'VAT_INTEGRATION','INPUT_VAT_NONRECOVERABLE','NON_CASH','6100','2100');
   }
   for(const event of ['REVENUE','ADJUSTMENT'])add(c,event,'VAT_INTEGRATION','OUTPUT_VAT','NON_CASH','1100','2300');
  }
  if(c.code===type)for(const template of ASSET_LIFECYCLE_POSTING_TEMPLATES.filter(t=>t.type===type)){
   add(c,'ADJUSTMENT','ASSET_LIFECYCLE',template.role,'NON_CASH',template.debit,template.credit);
  }
 }
 const configuredTemplates=new Set(existing.map(postingRuleKey));
 const inherited=inheritAccountPostingRules(classifications.filter(c=>c.active&&c.metadata?.accountInheritance).map(c=>({...c.metadata!.accountInheritance!,classificationId:c.id})),chart,[...existing,...[...proposals.values()].filter(r=>!configuredTemplates.has(postingRuleKey(r)))],existing);
 for(const rule of inherited.rules)proposals.set(postingRuleKey(rule),rule);
 // Existing user rules always win, including deliberately incomplete drafts.
 const stored=new Set(existing.map(postingRuleKey));
 const rules=[...proposals.values()].filter(r=>!stored.has(postingRuleKey(r)));
 const observed=new Set(events.flatMap(e=>e.lines.map(l=>postingRuleKey({...e,...l}))));
 return {version:1 as const,rules,inheritanceIssues:inherited.issues,unresolved:unresolved.filter(r=>!stored.has(postingRuleKey(r))),testedRuleCount:rules.filter(r=>observed.has(postingRuleKey(r))).length};
}
