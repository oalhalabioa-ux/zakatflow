import {requireUser} from './auth';
import {requireOrganizationMember} from './organization-access';
import {organizationScopeIds} from '../lib/workspace-organization';
import {partyFieldsSchema,partyMutationSchema,type DebtParty} from '../lib/debt-party-directory';
async function rows(query:()=>any){const out:any[]=[];for(let i=0;i<50000;i+=500){const r=await query().order('id').range(i,i+499);if(r.error)throw r.error;out.push(...r.data);if(r.data.length<500)return out;}throw Error('PARTY_DIRECTORY_TOO_LARGE');}
export async function canManageParties(supabase:any,org:string){const [a,p]=await Promise.all([supabase.rpc('is_organization_admin',{p_organization_id:org}),supabase.rpc('has_organization_permission',{p_organization_id:org,p_permission:'liquidity.edit'})]);if(a.error||p.error)throw Error('PARTY_DIRECTORY_FAILED');return a.data===true||p.data===true;}
export async function debtPartyDirectory(scope:'PERSONAL'|'ORGANIZATION',org:string|null,group:boolean){
 const {supabase,user}=await requireUser();
 if(scope==='PERSONAL'){
  const [profiles,assets,payables,links]=await Promise.all([
   rows(()=>supabase.from('personal_debt_parties').select('*').eq('user_id',user.id)),
   rows(()=>supabase.from('asset_accounts').select('id,name').eq('user_id',user.id).is('organization_id',null).eq('asset_type','RECEIVABLE')),
   rows(()=>supabase.from('personal_payables').select('id,party').eq('user_id',user.id)),
   rows(()=>supabase.from('personal_debt_links').select('id,record_id,side,party_key,party_name').eq('user_id',user.id)),
  ]);
  const mapped=new Map(links.map(l=>[l.side+':'+l.record_id,l]));const parties=new Map<string,DebtParty>();
  for(const [side,records] of [['RECEIVABLE',assets],['PAYABLE',payables]] as const){for(const r of records){const l=mapped.get(side+':'+r.id),key=l?.party_key??(side==='RECEIVABLE'?r.id:'personal-payable:'+r.party.trim().toLowerCase());parties.set(key,{id:null,party_key:key,organization_id:null,name:l?.party_name??r.name??r.party,party_type:side==='RECEIVABLE'?'CUSTOMER':'SUPPLIER',contact_name:'',phone:'',email:'',notes:'',active:true,legacy:true,linked:true,canWrite:true});}}
  const linkedKeys=new Set(links.map(l=>l.party_key));
  for(const p of profiles)parties.set(p.party_key,{...p,organization_id:null,legacy:false,linked:parties.has(p.party_key)||linkedKeys.has(p.party_key),canWrite:true});
  return {parties:[...parties.values()].sort((a,b)=>a.name.localeCompare(b.name)),organizations:[],canCreate:true};
 }
 if(!org)throw Error('ORGANIZATION_ID_REQUIRED');await requireOrganizationMember(supabase,user.id,org);
 const orgs=await rows(()=>supabase.from('organizations').select('id,name,parent_organization_id,organization_kind'));
 const ids=organizationScopeIds(orgs,org,group);const organizations:Array<{id:string;name:string;canWrite:boolean}>=[];
 for(const o of orgs.filter(o=>ids.has(o.id))){await requireOrganizationMember(supabase,user.id,o.id);organizations.push({...o,canWrite:await canManageParties(supabase,o.id)});}
 const parties=await rows(()=>supabase.from('liquidity_counterparties').select('*').in('organization_id',organizations.map(o=>o.id)));
 return {parties:parties.map(p=>({...p,party_key:p.id,canWrite:organizations.find(o=>o.id===p.organization_id)?.canWrite??false})),organizations,canCreate:organizations.some(o=>o.canWrite)};
}
export async function mutateDebtParty(input:unknown){
 const p=partyMutationSchema.parse(input),{supabase,user}=await requireUser();
 if(p.scope==='PERSONAL'){const {data,error}=await supabase.rpc('manage_personal_debt_party',{p_payload:p});if(error)throw error;return data;}
 await requireOrganizationMember(supabase,user.id,p.organization_id!);if(!await canManageParties(supabase,p.organization_id!))throw Error('PARTY_ACCESS_DENIED');
 let existing:any=null;
 if(p.id){const r=await supabase.from('liquidity_counterparties').select('id,party_type,party_type_id').eq('organization_id',p.organization_id).eq('id',p.id).maybeSingle();if(r.error)throw r.error;if(!r.data)throw Error('PARTY_ACCESS_DENIED');existing=r.data;}
 if(p.action==='DELETE'){const r=await supabase.from('liquidity_counterparties').delete().eq('organization_id',p.organization_id).eq('id',p.id).select('id').single();if(r.error)throw r.error;return {deleted:true};}
 const fields=partyFieldsSchema.parse(p);
 // Preserve custom party taxonomies when the base type has not changed.
 let typeId=existing?.party_type===fields.party_type?existing.party_type_id:null;
 if(!typeId){const t=await supabase.from('liquidity_party_types').select('id').eq('organization_id',p.organization_id).eq('code',fields.party_type).eq('active',true).maybeSingle();if(t.error)throw t.error;typeId=t.data?.id??null;}
 const values={...fields,party_type_id:typeId,updated_at:new Date().toISOString()};
 const r=p.id?await supabase.from('liquidity_counterparties').update(values).eq('organization_id',p.organization_id).eq('id',p.id).select().single():await supabase.from('liquidity_counterparties').insert({organization_id:p.organization_id,...fields,party_type_id:typeId}).select().single();
 if(r.error)throw r.error;return r.data;
}
