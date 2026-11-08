'use client';
import {useCallback,useEffect,useState} from 'react';
import type {Organization} from '@/services/organizations';
import {rememberedOrganization} from '@/lib/workspace-organization';

/** One explicit tenant per settings workspace; invalid requested tenants never fall back. */
export function useSettingsOrganization(preferredOrg='',locked=false){
 const [organizations,setOrganizations]=useState<Organization[]>([]);
 const [organizationId,setOrganizationId]=useState(preferredOrg);
 const [loading,setLoading]=useState(true),[error,setError]=useState(false),[revision,setRevision]=useState(0);
 const refresh=useCallback(()=>setRevision(v=>v+1),[]);
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setError(false);
  fetch('/api/organizations',{cache:'no-store',signal:controller.signal}).then(async r=>{
   if(!r.ok)throw Error('UNAVAILABLE');return r.json() as Promise<Organization[]>;
  }).then(rows=>{
   if(controller.signal.aborted)return;
   const requested=(locked?preferredOrg:new URLSearchParams(location.search).get('organization'))||preferredOrg||rememberedOrganization();
   if(!Array.isArray(rows)||requested&&!rows.some(o=>o.id===requested))throw Error('ACCESS_DENIED');
   setOrganizations(rows);setOrganizationId(requested||rows[0]?.id||'');
  }).catch(()=>{if(!controller.signal.aborted){setOrganizations([]);setOrganizationId('');setError(true);}})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[preferredOrg,revision,locked]);
 useEffect(()=>{
  const changed=()=>{if(!locked){const next=new URLSearchParams(location.search).get('organization')||rememberedOrganization();if(next&&next!==organizationId){setOrganizations([]);setOrganizationId(next);setLoading(true);}}refresh();};
  window.addEventListener('zf-organization-selection',changed);window.addEventListener('popstate',changed);
  return()=>{window.removeEventListener('zf-organization-selection',changed);window.removeEventListener('popstate',changed);};
 },[refresh,locked,organizationId]);
 return {organizations,organizationId,setOrganizationId,organization:organizations.find(o=>o.id===organizationId),loading,error,refresh};
}
