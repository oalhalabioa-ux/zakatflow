'use client';

export default function PrintReportButton({ar}:{ar:boolean}){
 return <button type="button" className="btn" onClick={()=>window.print()}>{ar?'طباعة / PDF':'Print / PDF'}</button>;
}
