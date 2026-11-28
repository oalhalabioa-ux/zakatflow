import {financialSourceRowsCsv} from '../../lib/financial-budget-source';

export async function downloadStatementFile(rows:string[][],kind:'csv'|'xlsx',name:string,worksheet:string,en:boolean,isCurrent:()=>boolean){
  let blob:Blob;
  if(kind==='csv'){
    blob=new Blob([financialSourceRowsCsv(rows)],{type:'text/csv;charset=utf-8'});
  }else{
    const {Workbook}=await import('exceljs');
    if(!isCurrent())return;
    const book=new Workbook(),sheet=book.addWorksheet(worksheet);
    sheet.views=[{rightToLeft:!en}];
    rows.forEach(row=>sheet.addRow(row));
    sheet.columns.forEach((column,index)=>column.width=index===0?48:32);
    const bytes=await book.xlsx.writeBuffer();
    blob=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }
  if(!isCurrent())return;
  const url=URL.createObjectURL(blob),anchor=document.createElement('a');
  anchor.href=url;
  anchor.download=name+'.'+kind;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
