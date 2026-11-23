import type {evaluateGeneralForecast} from './advanced-model';

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

export function generalForecastRows({model,advanced}:ReturnType<typeof evaluateGeneralForecast>){
 return [
  [0,null,null,null,null,null,null,null,-(advanced?.initialInvestment??model.totalInvestment),
   ...(advanced?[null,null,null,advanced.equityFlows[0]??null]:[])],
  ...model.annual.map((row,index)=>{
   const projection=advanced?.annual[index];
   return [row.year,row.volume,row.revenue,row.variable,row.fixed,row.ebitda,
    projection?.tax??row.taxEstimate,row.maintenance,projection?.fcf??row.freeCashFlow,
    ...(projection?[projection.principal,projection.interest,projection.debtBalance,
     advanced?.equityReady?projection.equityFcf:null]:[])];
  })
 ];
}
