import Decimal from 'decimal.js';
const D=Decimal.clone({precision:50});
import type {StatementSourceSnapshot} from './financial-statement-source';
import {preflightControlledGroup} from './financial-group-preconsolidation';
import type {GroupControlPreflight} from './financial-group-control';
import type {ReportingParent} from './financial-group-rollup';
/** Adapter for independently authorized LIVE legal-company snapshots. It never
 * treats a branch projection as a company, scales ownership into balances, or
 * labels a pre-elimination worksheet as consolidated financial statements. */
export function reviewControlledGroupSources(control:GroupControlPreflight,snapshots:StatementSourceSnapshot[]){
 if(!snapshots.length)throw Error('GROUP_SOURCE_REQUIRED');
 const currency=snapshots[0].statements.currency,parents=new Map<string,ReportingParent>();
 const members=snapshots.map(s=>{
  if(s.origin!=='LIVE_CANONICAL_EVENTS'||s.scope!=='ORGANIZATION_ALL_ENTITIES'||s.branchId!==undefined||s.statements.from!==control.from||s.statements.to!==control.to)throw Error('GROUP_SOURCE_SCOPE_INVALID');
  const details=s.accounts.map(a=>{
   const code=a.reportingCode??a.id;
   if(parents.has(code)&&parents.get(code)!.kind!==a.kind)throw Error('GROUP_SOURCE_CHART_CONFLICT');
   parents.set(code,{code,kind:a.kind});const n=new D(a.balance);
   return{accountId:a.id,code:a.id,reportingCode:code,kind:a.kind,debit:D.max(n,0).toFixed(4),credit:D.max(n.negated(),0).toFixed(4)};
  });
  return{organizationId:s.statements.organizationId,from:s.statements.from,to:s.statements.to,currency:s.statements.currency,details};
 });
 return preflightControlledGroup({control,currency,parents:[...parents.values()],members});
}
