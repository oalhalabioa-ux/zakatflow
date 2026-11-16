'use client';
import {useWorkspaceScope} from '../hooks/useWorkspaceScope';
import {useEffect,useState} from 'react';
import dynamic from 'next/dynamic';
const PersonalContractsWorkspace=dynamic(()=>import('./PersonalContractsWorkspace'));
const PersonalFinancingWorkspace=dynamic(()=>import('./PersonalFinancingWorkspace'));
const LoansWorkspace=dynamic(()=>import('./CorporateFinancingWorkspace'));
const DebtAdvancesWorkspace=dynamic(()=>import('./DebtAdvancesWorkspace'));
export default function FinancingScopeWorkspace({locale,kind}:{locale:string;kind:'LOAN'|'ADVANCE'}){const [scope]=useWorkspaceScope('ORGANIZATION'),[ready,setReady]=useState(false);useEffect(()=>setReady(true),[]);if(!ready)return <p role="status">جارٍ تجهيز نطاق العمل…</p>;return scope==='PERSONAL'?(kind==='LOAN'?<PersonalContractsWorkspace locale={locale}/>:<PersonalFinancingWorkspace key={kind} locale={locale} kind={kind}/>):kind==='LOAN'?<LoansWorkspace locale={locale}/>:<DebtAdvancesWorkspace locale={locale}/>}
