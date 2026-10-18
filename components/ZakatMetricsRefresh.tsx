'use client';
import {useEffect,useRef,useTransition} from 'react';
import {subscribeDashboardRefresh} from '../lib/dashboard-refresh';
import {useRouter} from 'next/navigation';
export default function ZakatMetricsRefresh(){
 const router=useRouter(),[pending,startTransition]=useTransition(),busy=useRef(false);busy.current=pending;
 useEffect(()=>subscribeDashboardRefresh(()=>startTransition(()=>router.refresh()),{isBusy:()=>busy.current}),[router]);
 return null;
}
