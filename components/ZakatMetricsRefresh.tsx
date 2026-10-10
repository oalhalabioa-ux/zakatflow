'use client';
import {useEffect} from 'react';
import {useRouter} from 'next/navigation';
export default function ZakatMetricsRefresh(){
 const router=useRouter();
 useEffect(()=>{
  const refresh=()=>{if(document.visibilityState==='visible')router.refresh()};
  window.addEventListener('focus',refresh);
  const timer=window.setInterval(refresh,30000);
  return()=>{window.removeEventListener('focus',refresh);window.clearInterval(timer)};
 },[router]);
 return null;
}
