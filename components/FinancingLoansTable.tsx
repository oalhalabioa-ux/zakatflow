'use client';

import {useEffect,useId,useMemo,useRef,useState,type ReactNode,type PointerEvent} from 'react';
import {createPortal} from 'react-dom';
import ActionButton from './ActionButton';
import {sourceVoucher} from '../lib/source-voucher';
import {reportReference} from '../lib/payable-presentation';
import {sortTableRows,type TableSortValue} from '../lib/table-sort';
import type {contractSettlement} from '../lib/debt-workspace';
import './financing-loans-table.css';

type Contract = {
  id:string;counterparty_id:string;organization_name?:string;status:string;side:string;
  principal:number|string;currency:string;base_currency?:string;description?:string;reference?:string|null;
  [key:string]:unknown;
};
type Fact = ReturnType<typeof contractSettlement>;
type Column = {id:string;ar:string;en:string;width:number;min:number;value?:(c:Contract)=>TableSortValue;cell:(c:Contract)=>ReactNode};
type Props = {
  records:Contract[];parties:Map<string,string>;facts:Map<string,Fact>;base:string;group:boolean;locale:string;
  page:number;onPageChange:(page:number)=>void;money:(value:number|string,currency:string)=>ReactNode;sortMoney:(value:number|string,currency:string)=>number|null;onOpen:(id:string)=>void;
};
const amountTitle=new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const stateNames:Record<string,[string,string]>={COMMITTED:['غير منفذ','Not posted'],ACTUAL:['منفذ','Posted'],CANCELLED:['ملغى','Cancelled'],REVERSED:['معكوس','Reversed']};
const settlementNames:Record<string,string>={'غير منفذ':'Not posted','معكوس':'Reversed','ملغى':'Cancelled','مسدد بالكامل':'Fully settled','متأخر':'Overdue','مسدد جزئيًا':'Partially settled','غير مسدد':'Unsettled'};

export default function FinancingLoansTable({records,parties,facts,base,group,locale,page,onPageChange,money,sortMoney,onOpen}:Props){
  const ar=locale==='ar',menuId=useId(),trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null);
  const [hidden,setHidden]=useState<string[]>([]),[widths,setWidths]=useState<Record<string,number>>({}),[sort,setSort]=useState<{id:string;direction:'ascending'|'descending'}|null>(null);
  const [position,setPosition]=useState<{left:number;top:number;width:number;maxHeight:number;host:HTMLElement}|null>(null);
  const label=(c:Column)=>ar?c.ar:c.en;
  const columns=useMemo<Column[]>(()=>{
  const state=(c:Contract)=>stateNames[c.status]?.[ar?0:1]??(ar?'غير معروف':'Unknown');
  const fact=(c:Contract)=>facts.get(c.id)!;
  const settled=(c:Contract)=>ar?fact(c).label:(settlementNames[fact(c).label]??fact(c).label);
  return [
    {id:'party',ar:'الجهة',en:'Counterparty',width:290,min:110,value:c=>parties.get(c.counterparty_id),cell:c=><><strong>{parties.get(c.counterparty_id)??'—'}</strong>{group&&<small>{c.organization_name}</small>}</>},
    {id:'type',ar:'نوع السند',en:'Voucher type',width:220,min:80,value:c=>sourceVoucher('DEBT',c,ar).voucherType,cell:c=>sourceVoucher('DEBT',c,ar).voucherType},
    {id:'number',ar:'رقم السند',en:'Voucher number',width:210,min:80,value:c=>sourceVoucher('DEBT',c,ar).voucherNumber,cell:c=><bdi>{sourceVoucher('DEBT',c,ar).voucherNumber}</bdi>},
    {id:'reference',ar:'المرجع الخارجي',en:'External reference',width:250,min:80,value:c=>c.reference,cell:c=><bdi>{reportReference(c.reference,c.id)}</bdi>},
    {id:'description',ar:'البيان',en:'Description',width:360,min:80,value:c=>c.description,cell:c=>c.description||'—'},
    {id:'side',ar:'الاتجاه',en:'Direction',width:170,min:80,value:c=>c.side==='RECEIVABLE'?(ar?'لنا':'Receivable'):(ar?'علينا':'Payable'),cell:c=>c.side==='RECEIVABLE'?(ar?'لنا':'Receivable'):(ar?'علينا':'Payable')},
    {id:'principal',ar:'أصل المبلغ',en:'Principal',width:220,min:80,value:c=>sortMoney(c.principal,c.currency),cell:c=>money(c.principal,c.currency)},
    {id:'state',ar:'حالة المستند',en:'Document status',width:220,min:80,value:state,cell:c=><span className="debt-status">{state(c)}</span>},
    {id:'settlement',ar:'حالة تسوية الأصل',en:'Principal settlement',width:245,min:80,value:settled,cell:c=><span className={'debt-status '+(fact(c).overdue>0?'is-overdue':'')}>{settled(c)}</span>},
    {id:'due',ar:'الاستحقاق القادم',en:'Next due date',width:205,min:80,value:c=>fact(c).nextDue,cell:c=>fact(c).nextDue??'—'},
    {id:'balance',ar:'المتبقي بعملة الأساس',en:'Remaining in base currency',width:300,min:80,value:c=>c.status==='ACTUAL'?sortMoney(fact(c).outstanding,c.base_currency??base):null,cell:c=>c.status==='ACTUAL'?money(fact(c).outstanding,c.base_currency??base):'—'},
    {id:'actions',ar:'التفاصيل',en:'Details',width:140,min:80,cell:c=><ActionButton icon="details" label={ar?'التفاصيل والإجراءات':'Details and actions'} onClick={()=>onOpen(c.id)}/>},
  ];
  },[parties,facts,ar,base,group,money,sortMoney,onOpen]);
  const shown=columns.filter(c=>!hidden.includes(c.id));
  const ordered=useMemo(()=>{const active=columns.find(c=>c.id===sort?.id);return sort&&active?.value?sortTableRows(records,active.value,sort.direction,locale):records;},[records,sort,locale,columns]);
  const totalWidth=shown.reduce((sum,c)=>sum+(widths[c.id]??c.width),0);
  useEffect(()=>{
    if(!position)return;
    menu.current?.querySelector('input')?.focus({preventScroll:true});
    function escape(e:KeyboardEvent){if(e.key==='Escape'){setPosition(null);trigger.current?.focus();}}
    function outside(e:globalThis.PointerEvent){if(!menu.current?.contains(e.target as Node)&&!trigger.current?.contains(e.target as Node))setPosition(null);}
    function reposition(e:Event){if(!menu.current?.contains(e.target as Node))setPosition(null);}
    document.addEventListener('keydown',escape);document.addEventListener('pointerdown',outside);
    window.addEventListener('resize',reposition);window.addEventListener('scroll',reposition,true);
    return()=>{document.removeEventListener('keydown',escape);document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',reposition);window.removeEventListener('scroll',reposition,true);};
  },[position]);
  function toggleMenu(){
    if(position){setPosition(null);return;}
    const button=trigger.current;if(!button)return;const rect=button.getBoundingClientRect(),width=Math.min(290,window.innerWidth-24),maxHeight=Math.min(640,window.innerHeight-24);
    setPosition({left:Math.max(12,Math.min(ar?rect.right-width:rect.left,window.innerWidth-width-12)),top:Math.max(12,Math.min(rect.bottom+6,window.innerHeight-maxHeight-12)),width,maxHeight,host:button.closest<HTMLElement>('.corp-shell')??document.body});
  }
  function resize(e:PointerEvent<HTMLButtonElement>,col:Column){
    e.preventDefault();e.stopPropagation();const handle=e.currentTarget,start=e.clientX,initial=widths[col.id]??col.width;
    handle.setPointerCapture(e.pointerId);
    const move=(event:globalThis.PointerEvent)=>setWidths(old=>({...old,[col.id]:Math.round(Math.max(col.min,Math.min(900,initial+(ar?-1:1)*(event.clientX-start))))}));
    const end=(event:globalThis.PointerEvent)=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',end);handle.removeEventListener('pointercancel',end);if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);};
    handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);
  }
  const choices=position&&createPortal(<div ref={menu} id={menuId} className="loan-table-column-menu" style={{left:position.left,top:position.top,width:position.width,maxHeight:position.maxHeight}} role="group" dir={ar?'rtl':'ltr'} aria-label={ar?'أعمدة جدول القروض':'Loan table columns'}>
    <strong>{ar?'إظهار وإخفاء الأعمدة':'Show and hide columns'}</strong>
    {columns.map(col=><label key={col.id}><input type="checkbox" checked={!hidden.includes(col.id)} disabled={shown.length===1&&!hidden.includes(col.id)} onChange={e=>setHidden(old=>e.target.checked?old.filter(id=>id!==col.id):[...old,col.id])}/><span>{label(col)}</span></label>)}
  </div>,position.host);
  return <><div className="card finance-table loan-configurable-table" dir={ar?'rtl':'ltr'}><table aria-label={ar?'قروض بعائد':'Interest-bearing loans'} style={{width:totalWidth,minWidth:0}}>
    <colgroup>{shown.map(col=><col key={col.id} data-loan-column={col.id} style={{width:widths[col.id]??col.width}}/>)}</colgroup>
    <thead><tr>{shown.map((col,index)=><th key={col.id} scope="col" data-loan-header={col.id} data-compact={(widths[col.id]??col.width)<140||undefined} aria-sort={col.value?(sort?.id===col.id?sort.direction:'none'):undefined}>
      {index===0&&<button ref={trigger} type="button" className="loan-table-menu-trigger" aria-label={ar?'خيارات أعمدة الجدول':'Table column options'} aria-expanded={!!position} aria-controls={position?menuId:undefined} onClick={toggleMenu}><span aria-hidden="true">⋮</span></button>}
      {col.value?<button type="button" className="loan-table-sort" title={label(col)} onClick={()=>{setSort(old=>({id:col.id,direction:old?.id===col.id&&old.direction==='ascending'?'descending':'ascending'}));onPageChange(0);}}><span>{label(col)}</span><span aria-hidden="true">{sort?.id===col.id?(sort.direction==='ascending'?'↑':'↓'):'↕'}</span></button>:<span className="loan-table-heading">{label(col)}</span>}
      <button type="button" className="loan-table-resize" role="separator" aria-label={(ar?'تعديل عرض عمود ':'Resize column ')+label(col)} aria-orientation="vertical" aria-valuemin={col.min} aria-valuemax={900} aria-valuenow={widths[col.id]??col.width} onPointerDown={e=>resize(e,col)} onKeyDown={e=>{if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;e.preventDefault();const delta=(e.key==='ArrowRight'?1:-1)*(ar?-1:1)*20;setWidths(old=>({...old,[col.id]:Math.max(col.min,Math.min(900,(old[col.id]??col.width)+delta))}));}}/>
    </th>)}</tr></thead>
    <tbody>{ordered.slice(page*20,page*20+20).map(c=><tr key={c.id} data-contract-id={c.id}>{shown.map(col=>{const value=col.value?.(c);return <td key={col.id} data-loan-cell={col.id} title={value==null?undefined:typeof value==='number'?amountTitle.format(value):String(value)}>{col.cell(c)}</td>})}</tr>)}</tbody>
  </table>{!records.length&&<p className="finance-empty">{ar?'لا توجد سجلات ضمن التصفية الحالية.':'No records match the current filters.'}</p>}</div>{choices}</>;
}
