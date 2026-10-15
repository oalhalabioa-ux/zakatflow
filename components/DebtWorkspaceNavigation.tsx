'use client';
import Link from 'next/link';
import {debtWorkspaceLinks} from '../lib/debt-workspace';
export default function DebtWorkspaceNavigation({locale,scope,current,sidebar=false}:{locale:string;scope:string;current?:string;sidebar?:boolean}){
 const ar=locale==='ar';return <nav className={sidebar?'corp-subnav debt-sidebar-nav':'finance-module-nav debt-workspace-nav'} aria-label={ar?'الذمم والتمويل':'Receivables, payables & financing'}>{debtWorkspaceLinks.filter(([route])=>sidebar||scope==='ORGANIZATION'||!['loans','employee-advances','debt-advances'].includes(route)).map(([route,arabic,english])=><Link key={route} href={`/${locale}/${route}?scope=${['loans','employee-advances','debt-advances'].includes(route)?'ORGANIZATION':scope}`} aria-label={ar?arabic:english} aria-current={current===route?'page':undefined}>{sidebar&&<svg className="corp-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 4h16v16H4zM8 9h8M8 13h8M8 17h4"/></svg>}<span className={sidebar?'corp-label':undefined}>{ar?arabic:english}</span></Link>)}</nav>;
}
