'use client';
import Link from './WorkspaceLink';
import {ActionIconGlyph,type ActionIcon} from './ActionButton';
const icons:Record<string,ActionIcon>={debts:'trend',receivables:'collect',payables:'pay',loans:'bank','employee-advances':'users','debt-advances':'receipt','debt-report':'history','debt-collection':'operations'};
import {debtWorkspaceLinks} from '../lib/debt-workspace';
export default function DebtWorkspaceNavigation({locale,scope,current,sidebar=false}:{locale:string;scope:string;current?:string;sidebar?:boolean}){
 const ar=locale==='ar';return <nav className={sidebar?'corp-subnav debt-sidebar-nav':'finance-module-nav debt-workspace-nav'} aria-label={ar?'الذمم والتمويل':'Receivables, payables & financing'}>{debtWorkspaceLinks.filter(([route])=>sidebar||scope==='ORGANIZATION'||route!=='employee-advances').map(([route,arabic,english])=><Link key={route} href={`/${locale}/${route}?scope=${route==='employee-advances'?'ORGANIZATION':scope}`} aria-label={ar?arabic:english} aria-current={current===route?'page':undefined}><span className={sidebar?'corp-icon debt-nav-icon':'debt-nav-icon'}><ActionIconGlyph name={icons[route]}/></span><span className={sidebar?'corp-label':undefined}>{ar?arabic:english}</span></Link>)}</nav>;
}
