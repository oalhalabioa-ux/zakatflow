'use client';
import Link from './WorkspaceLink';
import {usePathname,useSearchParams} from 'next/navigation';
import {Suspense,type ReactNode} from 'react';

type Props={href:string;title:string;children:ReactNode};
function CurrentLink(props:Props){
 const pathname=usePathname();
 const search=useSearchParams();
 const [target,query]=props.href.split('?');
 const expected=new URLSearchParams(query);
 const key=expected.has('section')?'section':'tab';
 const fallback=key==='section'?'dashboard':target.endsWith('/liquidity')?'overview':'dashboard';
 const active=pathname===target&&(search.get(key)||fallback)===expected.get(key);
 return <Link {...props} aria-current={active?'page':undefined}/>;
}
export default function SidebarQueryLink(props:Props){
 return <Suspense fallback={<Link {...props}/>}><CurrentLink {...props}/></Suspense>;
}
