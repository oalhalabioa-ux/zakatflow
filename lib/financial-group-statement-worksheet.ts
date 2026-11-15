import Decimal from 'decimal.js';
import {z} from 'zod';
import type {GroupControlPreflight} from './financial-group-control';
import {statementSourceEnvelope,normalizeStatementSource} from './financial-statement-source';
import {previewSourceBoundGroupEliminations,sourceBoundAdjustmentSchema} from './financial-group-source-bound-adjustments';
import {groupAdjustmentSchema,previewGroupCashEliminations} from './financial-group-cash-eliminations';
import {groupDocumentEvidenceSchema,verifyGroupDocumentMatches} from './financial-group-document-matches';
const D=Decimal.clone({precision:50});
/** Presentation of verified adjustments, never certification that all group
 * transactions, acquisition adjustments, NCI or translation are complete. */
export function groupStatementWorksheet(control:GroupControlPreflight,raw:readonly unknown[],input:unknown,documentEvidence:unknown){
 const entries=z.array(groupAdjustmentSchema).max(200).parse(input);
 if(new Set(entries.map(e=>e.id)).size!==entries.length)throw Error('GROUP_ADJUSTMENT_DUPLICATE');
 const documents=groupDocumentEvidenceSchema.parse(documentEvidence);
 if(verifyGroupDocumentMatches(entries,documents).status!=='DOCUMENT_MATCHES_VERIFIED_ONLY')throw Error('GROUP_BATCH_DOCUMENT_NOT_APPROVED');
 const ledger=entries.filter((e):e is z.infer<typeof sourceBoundAdjustmentSchema>=>e.kind!=='INTERCOMPANY_CASH');
 const cashEntries=entries.filter(e=>e.kind==='INTERCOMPANY_CASH');
 const worksheet=previewSourceBoundGroupEliminations(control,raw,ledger).worksheet;
 const cash=previewGroupCashEliminations(control,raw,cashEntries,documents.filter(d=>cashEntries.some(e=>e.documentMatchId===d.id)));
 const sources=raw.map(r=>{const p=statementSourceEnvelope.parse(r);return normalizeStatementSource(p,{organization:p.organizationId,from:control.from,to:control.to}).statements;});
 const delta=(kind:string)=>worksheet.rows.filter(r=>r.kind===kind).reduce((n,r)=>n.plus(r.adjustmentDebit).minus(r.adjustmentCredit),new D(0));
 const row=(key:string,before:Decimal,adjustment:Decimal)=>({key,before:before.toFixed(4),adjustment:adjustment.toFixed(4),after:before.plus(adjustment).toFixed(4)});
 type IncomeKey=keyof typeof sources[number]['income'];
 const incomeBefore=(key:IncomeKey)=>sources.reduce((n,s)=>n.plus(s.income[key]),new D(0));
 const revenue=delta('REVENUE').negated(),cost=delta('COGS'),opex=delta('OPEX'),finance=delta('FINANCE'),tax=delta('TAX');
 const gross=revenue.minus(cost),operating=gross.minus(opex),profit=operating.minus(finance).minus(tax);
 // Selected-period income comes from period movements, never closing/YTD balances.
 const income=([['revenue',revenue],['costOfSales',cost],['grossProfit',gross],['operatingExpenses',opex],['operatingProfit',operating],['finance',finance],['tax',tax],['netProfit',profit]] as [IncomeKey,Decimal][]).map(([k,d])=>row(k,incomeBefore(k),d));
 type PositionKey=keyof typeof sources[number]['position'];
 const positionBefore=(key:PositionKey)=>sources.reduce((n,s)=>n.plus(s.position[key]),new D(0));
 const position=([['assets',delta('ASSET')],['liabilities',delta('LIABILITY').negated()],['equity',delta('EQUITY').negated().plus(profit)],['fiscalProfit',profit]] as [PositionKey,Decimal][]).map(([k,d])=>row(k,positionBefore(k),d));
 const after=(rows:ReturnType<typeof row>[],key:string)=>new D(rows.find(r=>r.key===key)!.after);
 if(!after(position,'assets').eq(after(position,'liabilities').plus(after(position,'equity'))))throw Error('GROUP_POSITION_UNRECONCILED');
 const cashRows=[row('opening',new D(cash.opening),new D(0)),...cash.rows.map(r=>({key:r.activity.toLowerCase(),before:r.before,adjustment:r.adjustment,after:r.after})),row('movement',new D(cash.movement),new D(0)),row('closing',new D(cash.closing),new D(0))];
 return{status:'GROUP_STATEMENT_WORKSHEET_ONLY' as const,consolidated:false as const,from:control.from,to:control.to,currency:worksheet.currency,memberIds:worksheet.memberIds,income,position,cash:cashRows};
}
