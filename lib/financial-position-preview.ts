import type {ReportLine} from './financial-reporting-demo';
export type PositionPreviewRow=ReportLine&{parentId?:string;summaryFor?:string;collapsedTotals?:ReportLine};
/** Reorder existing preview values; never sum them or alter the other statements. */
export function positionPreviewRows(lines:ReportLine[]):PositionPreviewRow[]{
 const rows:PositionPreviewRow[]=[],byId=new Map(lines.map(r=>[r.id,r]));
 let start=0;
 for(const root of ['assets','liabilities','equity']){
  const end=lines.findIndex(r=>r.id===root),total=byId.get(root);if(end<start||!total)throw Error('POSITION_PREVIEW_STRUCTURE_INVALID');
  rows.push({...total,kind:'total'});let parentId=root;
  for(const row of lines.slice(start,end)){
   if(row.id==='equity-head')continue;
   if(row.kind==='section'){parentId=row.id;rows.push({...row,parentId:root,collapsedTotals:byId.get(row.id+'-total')})}
   else rows.push({...row,parentId,...(row.id===parentId+'-total'?{summaryFor:parentId}:{})});
  }
  start=end+1;
 }
 rows.push(...lines.slice(start));return rows;
}
