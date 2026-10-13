"use client";
import {use} from 'react';
import {useRouter} from 'next/navigation';
import AssetOperationDetails from '@/components/assets/AssetOperationDetails';
export default function TxDetail({params}:{params:Promise<{locale:string;id:string}>}){const{locale,id}=use(params);const router=useRouter();return <main className="container"><AssetOperationDetails record={{id}} ar={locale==='ar'} onClose={()=>router.push(`/${locale}/transactions`)} onChanged={()=>router.refresh()}/></main>}
