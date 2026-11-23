const spreadsheetFormula=/^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/u;

type CsvNumericFormat='integer'|'quantity'|'money';
const csvNumericFormatters:Record<CsvNumericFormat,Intl.NumberFormat>={
 integer:new Intl.NumberFormat('en-US',{useGrouping:false,maximumFractionDigits:0}),
 quantity:new Intl.NumberFormat('en-US',{useGrouping:false,maximumFractionDigits:3}),
 money:new Intl.NumberFormat('en-US',{useGrouping:false,minimumFractionDigits:2,maximumFractionDigits:2})
};

function csvValue(value:string|number|null|undefined,format?:CsvNumericFormat){
 if(typeof value==='number'&&format){
  if(!Number.isFinite(value))return '';
  const formatted=csvNumericFormatters[format].format(value);
  return formatted.startsWith('-')&&Number(formatted)===0?formatted.slice(1):formatted;
 }
 if(typeof value==='string'&&spreadsheetFormula.test(value))return "'"+value;
 return String(value??'');
}

export function feasibilityCsv(rows:readonly (readonly (string|number|null|undefined)[])[],formats?:readonly CsvNumericFormat[]){
 return '\uFEFF'+rows.map(row=>row.map((value,index)=>{
  const safe=csvValue(value,formats?.[index]);
  return '"'+safe.replaceAll('"','""')+'"';
 }).join(',')).join('\r\n');
}

export function downloadFeasibilityCsv(filename:string,rows:Parameters<typeof feasibilityCsv>[0],formats?:readonly CsvNumericFormat[]){
 downloadReportBlob(filename,new Blob([feasibilityCsv(rows,formats)],{type:'text/csv;charset=utf-8'}));
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
