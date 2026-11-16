/** Accounting compatibility, not authorization. Tenant membership, RLS and
 * financial approval permissions remain enforced by the existing API/RPCs.
 * The canonical party-type table stores code; it has no allowed-classifications
 * column. Custom/unspecified types retain their existing unrestricted semantics.
 */
const allowed:Record<string,readonly string[]>={
 CUSTOMER:['REVENUE','RECEIVABLE'],
 SUPPLIER:['OPEX','PAYABLE','CAPEX','ASSET','INVESTMENT'],
 BOTH:['REVENUE','RECEIVABLE','OPEX','PAYABLE','CAPEX','ASSET','INVESTMENT'],

};
export function liquidityPartyClassifications(code:string):readonly string[]{return Object.hasOwn(allowed,code)?allowed[code]:[];}
export function liquidityPartyAllowsClassification(code:string,treatment:string){const choices=liquidityPartyClassifications(code);return choices.length===0||choices.includes(treatment);}
