import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export const FORMAT='yaqeen-financial-schema-parity-v1';
// Only QA-exclusive fixtures and old production data backups are ancillary.
// Subscriptions, voucher controls, private accounting guards and every business
// schema are ALWAYS included. This tool never edits a database.
const ANCILLARY=['private_budget_backups.','qa_legacy.'];
export function compareInventories(production,core,{includeAncillary=false}={}){
 function indexed(inventory){
  if(!inventory||inventory.format!==FORMAT||!Array.isArray(inventory.objects))
   throw Error('SCHEMA_PARITY_INPUT_INVALID');
  const result=new Map();
  for(const row of inventory.objects){
   if(!row||typeof row.category!=='string'||typeof row.key!=='string'||
      !/^[a-f0-9]{32}$/.test(row.fingerprint))throw Error('SCHEMA_PARITY_RECORD_INVALID');
   if(!includeAncillary&&ANCILLARY.some(prefix=>row.key.startsWith(prefix)))continue;
   const key=row.category+'\0'+row.key;
   if(result.has(key))throw Error('SCHEMA_PARITY_DUPLICATE_OBJECT');
   result.set(key,row.fingerprint);
  }
  return result;
 }
 const p=indexed(production),q=indexed(core);
 const miss=[],extra=[],changed=[];
 for(const [key,sig] of p){
  if(!q.has(key))miss.push(key);
  else if(q.get(key)!==sig)changed.push(key);
 }
 for(const key of q.keys())if(!p.has(key))extra.push(key);
 const decoded=keys=>keys.sort().map(k=>{const [category,key]=k.split('\0');return {category,key}});
 const missing=decoded(miss),coreOnly=decoded(extra),different=decoded(changed);
 const counts={};
 for(const [kind,items] of Object.entries({missing,coreOnly,different})){
  counts[kind]={};
  for(const item of items)counts[kind][item.category]=(counts[kind][item.category]??0)+1;
 }
 return {status:missing.length||coreOnly.length||different.length?'BLOCKED':'SCHEMA_PARITY_MATCH',
  productionObjects:p.size,coreObjects:q.size,counts,missing,coreOnly,different,
  warning:'Schema parity does not certify data correctness, user permissions, atomic revisions or business UAT.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [productionPath,corePath]=process.argv.slice(2);
 if(!productionPath||!corePath){
  console.error('Usage: node compare-production-core-schema.mjs production.json core.json');
  process.exitCode=2;
 }else{
  try{
   const production=JSON.parse(await readFile(productionPath,'utf8'));
   const core=JSON.parse(await readFile(corePath,'utf8'));
   // A truncation or a restricted metadata export must NEVER accidentally pass.
   const required=['migration','relation','column','function','policy','trigger','constraint','index','table_grant','enum','extension'];
   for(const source of [production,core]){
    if(!source.objects||source.objects.length<2000||
       required.some(kind=>!source.objects.some(x=>x.category===kind))||
       !source.objects.some(x=>x.category==='relation'&&x.key==='public.financial_events')||
       !source.objects.some(x=>x.category==='relation'&&x.key==='public.organizations'))
     throw Error('SCHEMA_PARITY_EXPORT_INCOMPLETE');
   }
   const result=compareInventories(production,core);
   console.log(JSON.stringify(result,null,2));
   if(result.status!=='SCHEMA_PARITY_MATCH')process.exitCode=1;
  }catch(e){console.error(e?.message||'SCHEMA_PARITY_FAILED');process.exitCode=2}
 }
}
