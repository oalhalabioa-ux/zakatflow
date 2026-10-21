'use client';
import {useEffect,useState} from 'react';
import ActionButton from './ActionButton';
import type {RegisterData} from '../lib/financial-register';
import {personalDebtParties} from '../lib/personal-debt-parties';
import type {DebtParty} from '../lib/debt-party-directory';
export default function PersonalDebtPartyField({data,side,name,sourceId='',onChange,disabled=false}:{data:RegisterData;side:string;name:string;sourceId?:string;onChange:(name:string,id:string)=>void;disabled?:boolean}){
 const [adding,setAdding]=useState(false),[search,setSearch]=useState(''),[directory,setDirectory]=useState<DebtParty[]>([]),[loadError,setLoadError]=useState(false);
 useEffect(()=>{const c=new AbortController();fetch('/api/debt-parties?scope=PERSONAL',{signal:c.signal,cache:'no-store'}).then(async r=>{if(!r.ok)throw Error();const d=await r.json();if(!c.signal.aborted)setDirectory(d.parties)}).catch(()=>{if(!c.signal.aborted)setLoadError(true)});return()=>c.abort()},[]);
 const legacy=personalDebtParties(data,side),chosen=data.debts.find(d=>d.id===sourceId);
 const rows=[...legacy.filter(d=>!directory.some(p=>p.party_key===d.partyKey)).map(d=>({...d,selectId:d.id})),...directory.filter(p=>p.active).map(p=>({id:p.id??'',partyKey:p.party_key,partyName:p.name,currency:'',reference:'',selectId:p.id?'party:'+p.id:legacy.find(d=>d.partyKey===p.party_key)?.id??''})).filter(p=>p.selectId)];
 const selected=rows.find(d=>d.selectId===sourceId||d.partyKey===chosen?.partyKey),visible=rows.filter(d=>d.selectId===sourceId||d.partyKey===chosen?.partyKey||d.partyName.includes(search));

 return <div className="finance-wide debt-party-picker">{loadError&&<p role="alert">تعذر تحديث دليل الجهات. أغلق السند وأعد المحاولة قبل اختيار جهة.</p>}<div className="finance-form"><label>بحث عن جهة<input type="search" value={search} disabled={disabled} onChange={e=>setSearch(e.target.value)} placeholder="ابحث في جهات الذمم الشخصية"/></label><label>الجهة<select required={!adding} value={adding?'':selected?.selectId??sourceId} disabled={disabled||adding} onChange={e=>{const d=rows.find(d=>d.selectId===e.target.value);onChange(d?.partyName??'',d?.selectId??'')}}><option value="">اختر جهة قائمة</option>{visible.map(d=><option key={d.partyKey} value={d.selectId}>{d.partyName}{d.currency?' · '+d.currency:''}</option>)}</select></label></div><ActionButton icon="plus" label={adding?'اختيار جهة قائمة':'إضافة جهة'} showLabel disabled={disabled} onClick={()=>{setAdding(!adding);onChange('','')}}/>{adding&&<label>اسم الجهة الجديدة<input required maxLength={120} value={name} disabled={disabled} onChange={e=>onChange(e.target.value,'')}/><small>تُحفظ الجهة مع السند؛ لا ينشأ رصيد أو حركة نقدية قبل حفظه.</small></label>}{chosen&&<small>الحركة الجديدة سند مستقل على حساب {chosen.partyName}، ولا تعدّل الرصيد الافتتاحي.</small>}</div>;
}
