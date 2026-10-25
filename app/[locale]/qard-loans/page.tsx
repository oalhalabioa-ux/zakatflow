import {redirect} from 'next/navigation';
export default async function Page({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const query=new URLSearchParams();
 for(const [key,value] of Object.entries(await searchParams))if(typeof value==='string')query.set(key,value);
 query.set('scope','ORGANIZATION');query.set('product','QARD');
 redirect('/'+(await params).locale+'/loans?'+query);
}
