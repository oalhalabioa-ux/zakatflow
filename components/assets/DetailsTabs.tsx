'use client';
import ActionButton from '../ActionButton';
export default function DetailsTabs({prefix,selected,onChange,ar}:{prefix:string;selected:string;onChange:(tab:string)=>void;ar:boolean}){
 const tabs=[['details','التفاصيل','Details','details'],['payment','السداد / القبض','Settlement','pay'],['history','سجل التغييرات','History','history']] as const;
 return <div className="asset-details-tabs" role="tablist" aria-label={ar?'أقسام التفاصيل':'Detail sections'}>{tabs.map(([key,label,en,icon],index)=><ActionButton key={key} id={`${prefix}-${key}-tab`} icon={icon} label={ar?label:en} showLabel role="tab" aria-controls={`${prefix}-${key}`} aria-selected={selected===key} tabIndex={selected===key?0:-1} onClick={()=>onChange(key)} onKeyDown={e=>{let next=index;if(e.key==='Home')next=0;else if(e.key==='End')next=tabs.length-1;else if(e.key==='ArrowLeft')next=(index+(ar?1:tabs.length-1))%tabs.length;else if(e.key==='ArrowRight')next=(index+(ar?tabs.length-1:1))%tabs.length;else return;e.preventDefault();onChange(tabs[next][0]);document.getElementById(`${prefix}-${tabs[next][0]}-tab`)?.focus();}}/>)}</div>;
}
