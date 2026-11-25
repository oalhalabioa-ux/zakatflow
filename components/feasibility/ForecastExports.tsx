'use client';

import {useState} from 'react';
import {downloadFeasibilityCsv,downloadFeasibilityXlsx} from '@/lib/feasibility/report-export';

export default function ForecastExports({locale,filename,rows,formats}:{
 locale:string;
 filename:string;
 rows:Parameters<typeof downloadFeasibilityCsv>[1];
 formats?:Parameters<typeof downloadFeasibilityCsv>[2];
}){
 const [excel,setExcel]=useState<'idle'|'working'|'error'>('idle');
 const ar=locale==='ar';
 return <div className="fs-actions">
  <button type="button" className="fs-btn fs-btn--secondary"
   onClick={()=>downloadFeasibilityCsv(filename+'.csv',rows,formats)}>
   {ar?'تصدير التوقعات CSV':'Export forecast CSV'}
  </button>
  <button type="button" className="fs-btn fs-btn--secondary" disabled={excel==='working'} onClick={async()=>{
   setExcel('working');
   try{
    await downloadFeasibilityXlsx(filename+'.xlsx',ar?'التوقعات المالية':'Financial forecast',rows,ar);
    setExcel('idle');
   }catch{setExcel('error');}
  }}>
   {ar?'تصدير التوقعات Excel':'Export forecast Excel'}
  </button>
  {excel==='error'&&<p role="alert">{ar?'تعذر تصدير ملف Excel.':'Could not export the Excel file.'}</p>}
 </div>;
}
