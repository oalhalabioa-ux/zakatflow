/**
 * Compare two COMPLETE reporting snapshots by their financial content.
 *
 * A second read can catch visible writes during independent RLS source
 * verification, but can NEVER certify a database-atomic snapshot revision.
 * Array ordering is intentionally normalized: an unordered JSON aggregate
 * must not cause a false reporting outage when its financial rows are the same.
 * Only readAt (a clock, not accounting data) is ignored.
 */
function canonical(value:unknown):string{
 if(value===null)return 'null';
 if(Array.isArray(value))return '['+value.map(canonical).sort().join(',')+']';
 if(typeof value==='object'){
  const v=value as Record<string,unknown>;
  return '{'+Object.keys(v).filter(k=>k!=='readAt').sort()
   .map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
 }
 if(typeof value==='string'||typeof value==='boolean'||typeof value==='number')
  return JSON.stringify(value);
 throw Error('REPORTING_SOURCE_REPLAY_INVALID');
}
export function assertStableFinancialReplay(first:unknown,second:unknown):void{
 if(!first||!second||typeof first!=='object'||typeof second!=='object'||
  Array.isArray(first)||Array.isArray(second)||
  canonical(first)!==canonical(second))
  throw Error('REPORTING_SOURCE_CHANGED_DURING_VERIFICATION');
}
