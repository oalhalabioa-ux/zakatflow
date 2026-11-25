"use client";
import {use} from 'react';
import {useRouter} from 'next/navigation';
import AssetOperationDetails from '@/components/assets/AssetOperationDetails';
import {CurrencyScope} from '@/components/DisplayCurrency';
import RecordWorkspaceNotice from '@/components/RecordWorkspaceNotice';
import {useRecordWorkspace} from '@/hooks/useRecordWorkspace';
import {recordWorkspaceHref} from '@/lib/record-workspace-scope';

export default function TxDetail({params}:{params:Promise<{locale:string;id:string}>}){
 const{locale,id}=use(params),router=useRouter();
 const {data,owner,selection,loading,error,matches}=useRecordWorkspace('transactions',id);
 if(loading)return <main className="container"><p role="status">{locale==='ar'?'جارٍ تحميل السجل والتحقق من نطاقه…':'Loading and checking the record workspace…'}</p></main>;
 if(error||!matches||!selection||!owner)return <main className="container"><RecordWorkspaceNotice {...{locale,id,owner,selection,error}} collection="transactions"/></main>;
 const href=(replacementId?:string)=>recordWorkspaceHref(locale,'transactions',selection,replacementId);
 return <main className="container"><CurrencyScope currency={data.record.base_currency??data.asset.currency??'SAR'} organizationId={owner.organizationId??undefined}/><AssetOperationDetails key={id+selection.scope+selection.organizationId+selection.group} record={data.record} ar={locale==='ar'} onClose={()=>router.push(href())} onChanged={replacementId=>{if(replacementId)router.replace(href(replacementId));else router.refresh()}}/></main>;
}
