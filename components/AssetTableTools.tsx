'use client';
import {useEffect,useState} from 'react';
import {usePathname} from 'next/navigation';

const COLS=[
 ['asset','الأصل','Asset'],
 ['date','تاريخ الشراء','Purchase date'],
 ['weight','الوزن','Weight'],
 ['hawl','الحول','Hawl'],
 ['cost','التكلفة','Cost'],
 ['current','القيمة الحالية','Current value'],
 ['due','الزكاة المستحقة','Zakat due'],
 ['paid','المدفوعة','Paid'],
 ['remaining','المتبقي','Remaining'],
 ['calculation','الاحتساب الزكوي','Zakat calculation'],
 ['action','الإجراء','Action']
] as const;
type Size='compact'|'normal'|'wide';
const defaults=()=>Object.fromEntries(COLS.map(c=>[c[0],true])) as Record<string,boolean>;

export default function AssetTableTools({ar}:{ar:boolean}){
 const path=usePathname();const active=path?.includes('/assets');
 const[open,setOpen]=useState(false);const[size,setSize]=useState<Size>('normal');const[visible,setVisible]=useState<Record<string,boolean>>(defaults);
 useEffect(()=>{if(!active)return;try{const s=localStorage.getItem('zf_asset_table_v2');if(s){const p=JSON.parse(s);if(['compact','normal','wide'].includes(p.size))setSize(p.size);if(p.visible)setVisible({...defaults(),...p.visible})}}catch{}},[active]);
 useEffect(()=>{if(!active)return;try{localStorage.setItem('zf_asset_table_v2',JSON.stringify({size,visible}))}catch{}},[active,size,visible]);
 if(!active)return null;const all=COLS.every(c=>visible[c[0]]!==false);
 const apply=(next:Record<string,boolean>)=>{setVisible(next);window.dispatchEvent(new CustomEvent('zf-asset-table-settings',{detail:{size,visible:next}}))};
 const applySize=(next:Size)=>{setSize(next);window.dispatchEvent(new CustomEvent('zf-asset-table-settings',{detail:{size:next,visible}}))};
 return <><style>{`.asset-table-tools{max-width:1240px;margin:14px auto -10px;padding:0 22px;position:relative}.att-bar{display:flex;gap:8px;align-items:center;justify-content:flex-end;flex-wrap:wrap}.att-panel{position:absolute;z-index:25;top:46px;inset-inline-end:22px;width:min(470px,calc(100vw - 44px));background:#fff;border:1px solid var(--line);border-radius:14px;padding:15px;box-shadow:0 14px 35px #0f231e20}.att-panel h4{margin:0 0 11px}.att-cols{display:grid;grid-template-columns:1fr 1fr;gap:7px}.att-cols label{display:flex;align-items:center;gap:7px;padding:8px;border:1px solid var(--line);border-radius:8px;color:var(--ink)}.att-cols input{width:auto;margin:0}.att-sizes{display:flex;gap:6px;margin-bottom:12px}.att-sizes button{flex:1}.asset-report-table{table-layout:auto;width:max-content;min-width:100%}.asset-report-table th{position:relative;resize:horizontal;overflow:auto;min-width:72px;max-width:520px;cursor:col-resize}.asset-report-table td{cursor:default}.asset-report-table th:first-child{min-width:150px}.asset-report-table th:last-child,.asset-report-table td:last-child{width:72px!important;min-width:72px!important;max-width:82px!important;padding-left:5px!important;padding-right:5px!important;text-align:center;white-space:nowrap}.asset-report-table td:last-child .btn{padding:5px 7px!important;font-size:11px!important;min-width:0!important}.asset-report-table th::-webkit-resizer{background:transparent}.asset-report-table th:hover::-webkit-resizer{background:radial-gradient(circle,currentColor 1px,transparent 1.5px);background-size:4px 4px;opacity:.18}@media(max-width:600px){.att-cols{grid-template-columns:1fr}}`}</style><div className="asset-table-tools"><div className="att-bar"><button className="btn secondary" onClick={()=>applySize(size==='compact'?'normal':size==='normal'?'wide':'compact')}>↔ {ar?'حجم الخانات':'Cell size'}: {size==='compact'?(ar?'صغير':'Compact'):size==='wide'?(ar?'واسع':'Wide'):(ar?'متوسط':'Normal')}</button><button className="btn secondary" onClick={()=>setOpen(x=>!x)}>☷ {ar?'اختيار الأعمدة':'Choose columns'}</button></div>{open&&<div className="att-panel"><h4>{ar?'تخصيص جدول الأصول':'Customize asset table'}</h4><div className="att-sizes"><button className={`btn ${size==='compact'?'':'secondary'}`} onClick={()=>applySize('compact')}>{ar?'صغير':'Compact'}</button><button className={`btn ${size==='normal'?'':'secondary'}`} onClick={()=>applySize('normal')}>{ar?'متوسط':'Normal'}</button><button className={`btn ${size==='wide'?'':'secondary'}`} onClick={()=>applySize('wide')}>{ar?'واسع':'Wide'}</button></div><div className="att-cols">{COLS.map(c=><label key={c[0]}><input type="checkbox" checked={visible[c[0]]!==false} onChange={e=>apply({...visible,[c[0]]:e.target.checked})}/>{ar?c[1]:c[2]}</label>)}</div><div style={{display:'flex',gap:7,marginTop:12}}><button className="btn secondary" onClick={()=>apply(Object.fromEntries(COLS.map(c=>[c[0],!all])))}>{all?(ar?'إخفاء الكل':'Hide all'):(ar?'إظهار الكل':'Show all')}</button><button className="btn" onClick={()=>setOpen(false)}>{ar?'تم':'Done'}</button></div></div>}</div></>;
}
