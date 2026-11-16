'use client';
import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import dynamic from 'next/dynamic';
import ActionButton from './ActionButton';
const Loans=dynamic(()=>import('./LoansWorkspace'),{loading:()=><p role="status">جارٍ تحميل التمويل…</p>});
const Participation=dynamic(()=>import('./ParticipationWorkspace'),{loading:()=><p role="status">جارٍ تحميل المشاركة…</p>});
export default function CorporateFinancingWorkspace({locale}:{locale:string}){
 const catalogRequest=useRef<Promise<{organizations:any[]}>|null>(null);
 const loadCatalog=useCallback(()=>{
  if(!catalogRequest.current)catalogRequest.current=fetch('/api/debt-catalog').then(async response=>{
   if(!response.ok)throw new Error('CATALOG_UNAVAILABLE');
   return response.json();
  }).catch(error=>{catalogRequest.current=null;throw error});
  return catalogRequest.current;
 },[]);
 const [product,setProduct]=useState(''),tabs=[['ALL','جميع القروض','bank'],['QARD','القروض الحسنة','bank'],['FINANCING','التمويل بعائد','bank'],['PARTICIPATION','عقود الاستثمار والمشاركة','investment'],['LEGACY','السجلات السابقة','history']];
 useEffect(()=>{const read=()=>{const v=new URLSearchParams(location.search).get('product');setProduct(['QARD','FINANCING','PARTICIPATION','LEGACY','ALL'].includes(v??'')?v!:'FINANCING')};read();addEventListener('popstate',read);return()=>removeEventListener('popstate',read)},[]);
 function choose(v:string){const u=new URL(location.href);u.searchParams.set('product',v);u.searchParams.delete('contract_id');u.searchParams.set('scope','ORGANIZATION');history.pushState(null,'',u);setProduct(v)}
 const productNavigation:ReactNode=<nav className="finance-module-nav finance-tabs" aria-label="القروض والتمويل والاستثمار">{tabs.map(([key,label,icon])=><ActionButton key={key} icon={icon as 'bank'} label={label} showLabel aria-pressed={product===key} onClick={()=>choose(key)}/>)}</nav>;
 return product==='PARTICIPATION'?<Participation locale={locale} loadCatalog={loadCatalog} productNavigation={productNavigation}/>:product?<Loans key={product} locale={locale} productMode={product==='QARD'?'QARD':product==='LEGACY'?'LEGACY':product==='ALL'?'ALL':'FINANCING'} loadCatalog={loadCatalog} productNavigation={productNavigation}/>:<p role="status">جارٍ تجهيز الصفحة…</p>
}
