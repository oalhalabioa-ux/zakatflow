/** Calendar end for a fiscal year that begins on a given date (UTC, no local-time drift). */
export function endingForFiscalStart(start:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(start))return '';
 const year=Number(start.slice(0,4)),month=Number(start.slice(5,7)),day=Number(start.slice(8,10));
 const startDate=new Date(Date.UTC(year,month-1,day));
 if(startDate.toISOString().slice(0,10)!==start)return '';
 return new Date(Date.UTC(year+1,month-1,day-1)).toISOString().slice(0,10);
}
