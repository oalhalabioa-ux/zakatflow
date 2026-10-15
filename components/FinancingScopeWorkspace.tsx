'use client';
import {useWorkspaceScope} from '../hooks/useWorkspaceScope';
import dynamic from 'next/dynamic';
const PersonalFinancingWorkspace=dynamic(()=>import('./PersonalFinancingWorkspace'));
const LoansWorkspace=dynamic(()=>import('./LoansWorkspace'));
const DebtAdvancesWorkspace=dynamic(()=>import('./DebtAdvancesWorkspace'));
export default function FinancingScopeWorkspace({locale,kind}:{locale:string;kind:'LOAN'|'ADVANCE'}){const [scope]=useWorkspaceScope('ORGANIZATION');return scope==='PERSONAL'?<PersonalFinancingWorkspace key={kind} locale={locale} kind={kind}/>:kind==='LOAN'?<LoansWorkspace locale={locale}/>:<DebtAdvancesWorkspace locale={locale}/>}
