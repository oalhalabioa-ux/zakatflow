'use client';
import {useEffect,useState,type ReactNode} from 'react';
import dynamic from 'next/dynamic';
import ActionButton from './ActionButton';
const Loans=dynamic(()=>import('./LoansWorkspace'),{loading:()=><p role="status">جارٍ تحميل التمويل…</p>});
const Participation=dynamic(()=>import('./ParticipationWorkspace'),{loading:()=><p role="status">جارٍ تحميل المشاركة…</p>});
export default function CorporateFinancingWorkspace({locale}:{locale:string}){
 const [product,setProduct]=useState(''),tabs=[['FINANCING','القروض والتمويل','bank'],['PARTICIPATION','عقود الاستثمار والمشاركة','investment']];
 useEffect(()=>{const read=()=>{const v=new URLSearchParams(location.search).get('product');setProduct(['FINANCING','PARTICIPATION'].includes(v??'')?v!:'FINANCING')};read();addEventListener('popstate',read);return()=>removeEventListener('popstate',read)},[]);
 function choose(v:string){const u=new URL(location.href);u.searchParams.set('product',v);u.searchParams.set('scope','ORGANIZATION');history.pushState(null,'',u);setProduct(v)}
 const productNavigation:ReactNode=<nav className="finance-module-nav finance-tabs" aria-label="التمويل والاستثمار الوارد">{tabs.map(([key,label,icon])=><ActionButton key={key} icon={icon as 'bank'} label={label} showLabel aria-pressed={product===key} onClick={()=>choose(key)}/>)}</nav>;
 return product==='PARTICIPATION'?<Participation locale={locale} productNavigation={productNavigation}/>:product?<Loans key={product} locale={locale} productMode="FINANCING" productNavigation={productNavigation}/>:<p role="status">جارٍ تجهيز الصفحة…</p>
}
