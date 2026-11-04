import type {RecognitionEvent,RecognitionLine} from './financial-event-ledger';

/** The same exact source/classification key used by the database's
 * financial-year coverage gate. Never invents a fallback posting account. */
export type PostingCoverageRule={eventType:string;sourceModule:string;classificationId:string;cashDirection:RecognitionLine['cashDirection'];debitAccountId?:string;creditAccountId?:string};
export type PostingCoverageGroup=PostingCoverageRule & {lineCount:number;matchingRules:number;status:'MAPPED'|'MISSING'|'AMBIGUOUS'};
const signature=(value:PostingCoverageRule)=>JSON.stringify([value.eventType,value.sourceModule,value.classificationId,value.cashDirection]);

export function financialPostingCoverage(events:RecognitionEvent[],rules:PostingCoverageRule[]){
 const counts=new Map<string,number>();
 for(const rule of rules){if(!rule.debitAccountId||!rule.creditAccountId)continue;const key=signature(rule);counts.set(key,(counts.get(key)??0)+1)}
 const groups=new Map<string,PostingCoverageGroup>();
 for(const event of events){
  for(const line of event.lines){
   const fields={eventType:event.eventType,sourceModule:event.sourceModule,classificationId:line.classificationId,cashDirection:line.cashDirection};
   const key=signature(fields),matched=counts.get(key)??0,previous=groups.get(key);
   groups.set(key,{...fields,lineCount:(previous?.lineCount??0)+1,matchingRules:matched,status:matched===1?'MAPPED':matched===0?'MISSING':'AMBIGUOUS'});
  }
 }
 const sorted=[...groups.values()].sort((a,b)=>signature(a).localeCompare(signature(b)));
 return{eventCount:events.length,emptyEvents:events.filter(event=>event.lines.length===0).length,lineCount:sorted.reduce((n,g)=>n+g.lineCount,0),
  mappedLines:sorted.reduce((n,g)=>n+(g.status==='MAPPED'?g.lineCount:0),0),
  missingLines:sorted.reduce((n,g)=>n+(g.status==='MISSING'?g.lineCount:0),0),
  ambiguousLines:sorted.reduce((n,g)=>n+(g.status==='AMBIGUOUS'?g.lineCount:0),0),groups:sorted};
}
