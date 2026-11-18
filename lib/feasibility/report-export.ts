const spreadsheetFormula=/^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/u;

export function feasibilityCsv(rows:readonly (readonly (string|number|null|undefined)[])[]){
 return '\uFEFF'+rows.map(row=>row.map(value=>{
  const safe=typeof value==='string'&&spreadsheetFormula.test(value)?"'"+value:String(value??'');
  return '"'+safe.replaceAll('"','""')+'"';
 }).join(',')).join('\r\n');
}

export function downloadFeasibilityCsv(filename:string,rows:Parameters<typeof feasibilityCsv>[0]){
 downloadReportBlob(filename,new Blob([feasibilityCsv(rows)],{type:'text/csv;charset=utf-8'}));
}

function downloadReportBlob(filename:string,blob:Blob){
 const url=URL.createObjectURL(blob);
 const link=document.createElement('a');
 link.href=url;
 link.download=filename;
 link.click();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export async function downloadFeasibilityXlsx(filename:string,sheetName:string,rows:Parameters<typeof feasibilityCsv>[0],rightToLeft:boolean){
 const {Workbook}=await import('exceljs');
 const workbook=new Workbook();
 const sheet=workbook.addWorksheet(sheetName,{views:[{rightToLeft,state:'frozen',ySplit:1}]});
 // Plain strings remain text cells, including strings that start with formula characters.
 for(const row of rows)sheet.addRow([...row]);
 sheet.getRow(1).font={bold:true};
 sheet.columns.forEach(column=>{column.width=24;});
 const bytes=await workbook.xlsx.writeBuffer();
 downloadReportBlob(filename,new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
}
