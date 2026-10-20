
'use client';
import {useState} from 'react';
import dynamic from 'next/dynamic';
import {useWorkspaceScope} from '../hooks/useWorkspaceScope';
import ActionButton from './ActionButton';
const Instruments=dynamic(()=>import('./InvestmentWorkspace'));
const Contracts=dynamic(()=>import('./ParticipationWorkspace'));
export default function InvestmentsHome({locale}:{locale:string}){const [scope]=useWorkspaceScope(),[view,setView]=useState('instruments');return <>{scope==='ORGANIZATION'&&<nav className="finance-module-nav finance-tabs" aria-label="أنواع الاستثمار"><ActionButton icon="bank" label="الودائع والسندات والصكوك" showLabel aria-pressed={view==='instruments'} onClick={()=>setView('instruments')}/><ActionButton icon="investment" label="عقود الاستثمار الخارجي" showLabel aria-pressed={view==='contracts'} onClick={()=>setView('contracts')}/></nav>}{scope==='ORGANIZATION'&&view==='contracts'?<Contracts locale={locale} direction="OUTGOING"/>:<Instruments locale={locale}/>}</>}
