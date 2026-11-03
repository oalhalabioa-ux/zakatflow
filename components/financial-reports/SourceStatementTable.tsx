'use client';
import {useId,useState} from 'react';
import Decimal from 'decimal.js';
import {Icon} from './FinancialReportsPilot';
import {statementTreeRows,type StatementSourceSnapshot,type StatementView} from '../../lib/financial-statement-source';

const Money=Decimal.clone({precision:50});
export function statementAmount(value:string){const n=new Money(value),[whole,fraction]=n.abs().toFixed(2).split('.');const text=whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+fraction;return n.isNegative()?'('+text+')':text}
export function StatementGroupToggle({label,icon,en,expanded,controls,onToggle}:{label:string;icon?:string;en:boolean;expanded:boolean;controls:string;onToggle:()=>void}){
 return <button type="button" className="fs-statement-group-toggle" aria-expanded={expanded} aria-controls={controls} aria-label={(en?(expanded?'Hide details: ':'Show details: '):(expanded?'إخفاء تفاصيل: ':'إظهار تفاصيل: '))+label} onClick={onToggle}><span className="fs-group-chevron"><Icon name="chevron" size={17}/></span><span className="fs-statement-row-label">{icon&&<Icon name={icon} size={19}/>}<span>{label}</span></span></button>;
}
export default function SourceStatementTable({snapshot,view,en}:{snapshot:StatementSourceSnapshot;view:StatementView;en:boolean}){
 const[collapsed,setCollapsed]=useState<Set<string>>(()=>new Set()),prefix=useId().replaceAll(':','');
 const rows=statementTreeRows(snapshot,view,en),children=new Map<string,number[]>();
 rows.forEach((row,index)=>{if(row.parentId){const list=children.get(row.parentId)??[];list.push(index);children.set(row.parentId,list)}});
 const t=(ar:string,english:string)=>en?english:ar;
 function toggle(id:string){setCollapsed(previous=>{const next=new Set(previous);if(next.has(id))next.delete(id);else next.add(id);return next})}
 return <div className={'fs-table-scroll fs-source-statement-table fs-statement-tree '+(view==='position'?'fs-position-table':'')}><table className="fs-table"><caption className="fs-sr-only">{t('قائمة من أحداث اختبار محلية — المبالغ','Local test event statement — amounts in')} {snapshot.statements.currency}</caption><thead><tr><th>{t('البند','Item')}</th>{view==='position'&&<th>{t('إيضاح','Note')}</th>}<th>{t('الفترة الحالية','Current period')}</th><th>{t('الفترة السابقة','Previous period')}</th>{view==='position'&&<th>{t('التغير','Change')}</th>}<th>{t('نسبة التغير','Change %')}</th></tr></thead><tbody>{rows.map((row,index)=>{
  const childIndexes=children.get(row.id)??[],rowId=prefix+'-row-'+index,label=<span className="fs-statement-row-label">{row.icon&&<Icon name={row.icon} size={19}/>}<span>{row.label}</span></span>;
  return <tr key={row.id} id={rowId} data-statement-row={row.id} data-parent-row={row.parentId} hidden={Boolean(row.parentId&&collapsed.has(row.parentId))} className={'fs-row-'+row.kind+(row.parentId?' fs-row-child':'')}><th scope="row">{childIndexes.length?<StatementGroupToggle label={row.label} icon={row.icon} en={en} expanded={!collapsed.has(row.id)} controls={childIndexes.map(i=>prefix+'-row-'+i).join(' ')} onToggle={()=>toggle(row.id)}/>:label}</th>{view==='position'&&<td>—</td>}<td data-amount={row.value} dir="ltr">{row.value?statementAmount(row.value):''}</td><td>—</td>{view==='position'&&<td>—</td>}<td>—</td></tr>;
 })}</tbody></table></div>;
}
