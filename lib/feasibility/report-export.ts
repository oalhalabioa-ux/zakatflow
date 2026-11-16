const spreadsheetFormula=/^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/u;

export function feasibilityCsv(rows:readonly (readonly (string|number|null|undefined)[])[]){
 return '\uFEFF'+rows.map(row=>row.map(value=>{
  const safe=typeof value==='string'&&spreadsheetFormula.test(value)?"'"+value:String(value??'');
  return '"'+safe.replaceAll('"','""')+'"';
 }).join(',')).join('\r\n');
}

export function downloadFeasibilityCsv(filename:string,rows:Parameters<typeof feasibilityCsv>[0]){
 const url=URL.createObjectURL(new Blob([feasibilityCsv(rows)],{type:'text/csv;charset=utf-8'}));
 const link=document.createElement('a');
 link.href=url;
 link.download=filename;
 link.click();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
