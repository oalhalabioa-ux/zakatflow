'use client';
import {useEffect,useState} from 'react';
import Decimal from 'decimal.js';
import type {OpeningWorkspaceData} from '../../lib/financial-opening-workspace';

export default function AvailableRegisterBalances({organization,en}:{organization:string;en:boolean}){
 const [data,setData]=useState<OpeningWorkspaceData|null>(null);
 const [failed,setFailed]=useState(false);
 const [needsCalendar,setNeedsCalendar]=useState(false);
 useEffect(()=>{
  const controller=new AbortController();setData(null);setFailed(false);setNeedsCalendar(false);
  const load=async()=>{
   const contextResponse=await fetch('/api/financial-reporting/fiscal?organization='+encodeURIComponent(organization),{cache:'no-store',signal:controller.signal});
   const context=await contextResponse.json();if(!contextResponse.ok)throw Error();
   if(!context.period?.start){if(!controller.signal.aborted)setNeedsCalendar(true);return null;}
   const params=new URLSearchParams({organization,fiscalStart:context.period.start});
   const response=await fetch('/api/financial-reporting/openings?'+params,{cache:'no-store',signal:controller.signal});
   if(!response.ok)throw Error();return response.json() as Promise<OpeningWorkspaceData>;
  };
  load()
   .then(result=>{if(!controller.signal.aborted&&result?.organizationId===organization)setData(result)})
   .catch(()=>{if(!controller.signal.aborted)setFailed(true)});
  return ()=>controller.abort();
 },[organization]);
 if(failed)return <p role="alert">{en?'Could not read the selected register.':'تعذرت قراءة سجل المؤسسة المختارة.'}</p>;
 if(needsCalendar)return <p role="status">{en?'Configure this organization’s fiscal calendar in Opening balances to read its period balances.':'حدد إعداد السنة المالية للمؤسسة في الأرصدة الافتتاحية لقراءة أرصدة الفترة.'}</p>;
 if(!data||data.organizationId!==organization)return <p role="status">{en?'Loading register balances…':'جارٍ قراءة أرصدة السجل…'}</p>;
 const rows=data.source.rows.filter(row=>row.tab==='cash'&&data.bankRegister?.[row.id]?.balance!=null);
 if(!rows.length)return null;
 return <div className="fs-table-scroll"><table className="fs-table"><caption>{en?'Current cash and bank balances':'أرصدة النقد والبنوك الحالية'} · {data.registerAsOf} · {data.currency}</caption><thead><tr><th>{en?'Account':'الحساب'}</th><th>{en?'Register balance':'رصيد السجل'}</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><th scope="row">{en?row.en:row.ar}</th><td><bdi>{new Decimal(data.bankRegister![row.id].balance!).toFixed(2).replace(/\B(?=(\d{3})+\.)/g,',')}</bdi></td></tr>)}</tbody></table></div>;
}
