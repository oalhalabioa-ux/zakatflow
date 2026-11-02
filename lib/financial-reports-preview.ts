/** Deterministic, synthetic presentation fixtures. Never a production accounting source. */
export const PREVIEW_ORGANIZATIONS = ['demo-holding', 'demo-services'] as const;
export type PreviewOrganization = typeof PREVIEW_ORGANIZATIONS[number];
export const PREVIEW_MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
export const PREVIEW_MONTHS_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export function previewSeries(organization:PreviewOrganization, count:number) {
 if(!PREVIEW_ORGANIZATIONS.includes(organization)) throw new Error('UNKNOWN_PREVIEW_ORGANIZATION');
 if(![3,6,12].includes(count))throw new Error('INVALID_PREVIEW_PERIOD');
 const factor=organization==='demo-holding'?1:0.35;
 const revenues=[51,56,62,69,77,82,85,93,100,108,114,120.5];
 const expenses=[38,42,48,51,58,62,64,68,71,80,84,87.3];
 return revenues.map((r,i)=>({month:i,revenue:r*factor,expense:expenses[i]*factor,profit:(r-expenses[i])*factor})).slice(-count);
}
export function previewSummary(organization:PreviewOrganization, count:number) {
 const series=previewSeries(organization,count), current=series.at(-1)!;
 // The reference cards show the latest period, rather than the sum of chart months.
 const budget=current.revenue*115.8/120.5;
 return {...current,margin:100*current.profit/current.revenue,cash:38.9*(organization==='demo-holding'?1:0.35),budget,variance:current.revenue-budget,achievement:100*current.revenue/budget};
}
export function previewCsv(organization:PreviewOrganization,count:number,english=false){
 const rows=previewSeries(organization,count);
 return '\uFEFF'+[english?'SYNTHETIC PREVIEW DATA — NOT AN ACCOUNTING REPORT':'بيانات اصطناعية للمعاينة — ليست تقريراً محاسبياً',`Organization,${organization}`,`Month,Revenue SAR million,Expense SAR million,Net profit SAR million`,...rows.map(r=>[`2024-${String(r.month+1).padStart(2,'0')}`,r.revenue.toFixed(2),r.expense.toFixed(2),r.profit.toFixed(2)].join(','))].join('\r\n');
}
