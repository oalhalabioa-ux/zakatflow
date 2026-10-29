'use client';
import {useEffect} from 'react';
import {usePathname,useSearchParams} from 'next/navigation';
import {requestLocale} from '../lib/routing';

/** App Router keeps the root layout mounted when a language link is followed. */
export default function DocumentLanguage(){
 const pathname=usePathname(),query=useSearchParams();
 useEffect(()=>{
  const locale=requestLocale(new URL(`${pathname}?${query.toString()}`,location.origin),document.documentElement.lang);
  document.documentElement.lang=locale;
  document.documentElement.dir=locale==='ar'?'rtl':'ltr';
 },[pathname,query]);
 return null;
}
