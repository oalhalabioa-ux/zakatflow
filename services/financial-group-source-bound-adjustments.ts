import {z} from 'zod';
import {groupAdjustmentSchema,previewGroupCashEliminations} from '../lib/financial-group-cash-eliminations';
import {statementQuery} from '../lib/financial-statement-source';
import {sourceBoundAdjustmentSchema,previewSourceBoundGroupEliminations} from '../lib/financial-group-source-bound-adjustments';
import {liveRegisteredGroupEvidence} from './financial-group-registered-source';
import {readGroupOpenItems} from './financial-group-open-items';
import {verifyGroupOpenItems} from '../lib/financial-group-open-items';
import {assertStableFinancialReplay} from '../lib/financial-source-replay';
import {readGroupDocumentMatches} from './financial-group-document-matches';
import {verifyGroupDocumentMatches} from '../lib/financial-group-document-matches';
const request=z.object({query:statementQuery,entries:z.array(groupAdjustmentSchema).max(200)}).strict();
/** Read-only evidence-bound worksheet. No approval, company posting or export. */
export async function liveSourceBoundGroupPreview(input:unknown){
 if(process.env.FINANCIAL_GROUP_ELIMINATION_PREVIEW!=='true')throw Error('REPORTING_DISABLED');
 const {query,entries}=request.parse(input);
 const ledgerEntries=entries.filter((e):e is z.infer<typeof sourceBoundAdjustmentSchema>=>e.kind!=='INTERCOMPANY_CASH');
 const cashEntries=entries.filter(e=>e.kind==='INTERCOMPANY_CASH');
 const before=await readGroupOpenItems(ledgerEntries);
 const documentsBefore=await readGroupDocumentMatches(entries);
 const documents=verifyGroupDocumentMatches(entries,documentsBefore);
 const {control,rawSources}=await liveRegisteredGroupEvidence(query);
 const preview=previewSourceBoundGroupEliminations(control,rawSources,ledgerEntries);
 const openItems=verifyGroupOpenItems(ledgerEntries,query.to,preview.worksheet.currency,before);
 assertStableFinancialReplay({items:before},{items:await readGroupOpenItems(ledgerEntries)});
 assertStableFinancialReplay({documents:documentsBefore},{documents:await readGroupDocumentMatches(entries)});
 const cashWorksheet=cashEntries.length?previewGroupCashEliminations(control,rawSources,cashEntries,Array.isArray(documentsBefore)?documentsBefore.filter(d=>cashEntries.some(e=>e.documentMatchId===d.id)):documentsBefore):undefined;
 return{...preview,openItems,documents,...(cashWorksheet?{cashWorksheet}:{})};
}
