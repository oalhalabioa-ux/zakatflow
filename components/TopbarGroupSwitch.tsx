'use client';
export default function TopbarGroupSwitch({checked,onChange,disabled=false,ar=true}:{checked:boolean;onChange:(checked:boolean)=>void;disabled?:boolean;ar?:boolean}){
 return <button type="button" role="switch" aria-checked={checked} disabled={disabled} className="finance-scope-switch" onClick={()=>onChange(!checked)}><span className="finance-switch-track" aria-hidden="true"><span/></span><span>{ar?'شامل الفروع':'Include subsidiaries'}</span></button>;
}
