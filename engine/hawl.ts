export type HawlResult = { dueDate: Date; completed: boolean; daysRemaining: number };
export type HawlCalendar = 'GREGORIAN' | 'HIJRI_TABULAR';

function addOneGregorianYear(date: Date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()));
  const m=d.getUTCMonth(); d.setUTCFullYear(d.getUTCFullYear()+1); if(d.getUTCMonth()!==m)d.setUTCDate(0); return d;
}

function gregorianToJd(y:number,m:number,d:number){const a=Math.floor((14-m)/12),yy=y+4800-a,mm=m+12*a-3;return d+Math.floor((153*mm+2)/5)+365*yy+Math.floor(yy/4)-Math.floor(yy/100)+Math.floor(yy/400)-32045;}
function jdToGregorian(jd:number){let a=jd+32044,b=Math.floor((4*a+3)/146097),c=a-Math.floor(146097*b/4),d=Math.floor((4*c+3)/1461),e=c-Math.floor(1461*d/4),m=Math.floor((5*e+2)/153);return {y:100*b+d-4800+Math.floor(m/10),m:m+3-12*Math.floor(m/10),d:e-Math.floor((153*m+2)/5)+1};}
function gregorianToHijri(date:Date){const jd=gregorianToJd(date.getUTCFullYear(),date.getUTCMonth()+1,date.getUTCDate());let l=jd-1948440+10632,n=Math.floor((l-1)/10631);l=l-10631*n+354;const j=Math.floor((10985-l)/5316)*Math.floor((50*l)/17719)+Math.floor(l/5670)*Math.floor((43*l)/15238);l=l-Math.floor((30-j)/15)*Math.floor((17719*j)/50)-Math.floor(j/16)*Math.floor((15238*j)/43)+29;const mm=Math.floor((24*l)/709),dd=l-Math.floor((709*mm)/24),yy=30*n+j-30;return {year:yy,month:mm,day:dd};}
function hijriToGregorian(y:number,m:number,d:number){const jd=d+Math.ceil(29.5*(m-1))+(y-1)*354+Math.floor((3+11*y)/30)+1948439;return jdToGregorian(jd);}

export function calculateGregorianHawl(startDate:Date,assessmentDate:Date):HawlResult{const dueDate=addOneGregorianYear(startDate);const daysRemaining=Math.max(0,Math.ceil((dueDate.getTime()-assessmentDate.getTime())/86400000));return{dueDate,completed:assessmentDate>=dueDate,daysRemaining};}

export function calculateTabularHijriHawl(startDate:Date,assessmentDate:Date):HawlResult{const h=gregorianToHijri(startDate);const g=hijriToGregorian(h.year+1,h.month,h.day);const dueDate=new Date(Date.UTC(g.y,g.m-1,g.d));const daysRemaining=Math.max(0,Math.ceil((dueDate.getTime()-assessmentDate.getTime())/86400000));return{dueDate,completed:assessmentDate>=dueDate,daysRemaining};}

export function calculateHawl(calendar:HawlCalendar,startDate:Date,assessmentDate:Date){if(calendar==='GREGORIAN')return calculateGregorianHawl(startDate,assessmentDate);return calculateTabularHijriHawl(startDate,assessmentDate);}
