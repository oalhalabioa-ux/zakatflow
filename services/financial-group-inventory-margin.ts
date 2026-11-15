import {inventoryMarginDocumentPairs,inventoryMarginReviewRequest,reviewInventoryMargin} from '../lib/financial-group-inventory-margin';
import {assertStableFinancialReplay} from '../lib/financial-source-replay';
import {readGroupDocumentMatches} from './financial-group-document-matches';
import {liveRegisteredGroupEvidence} from './financial-group-registered-source';

export async function liveInventoryMarginReview(input:unknown){
 if(process.env.FINANCIAL_GROUP_ELIMINATION_PREVIEW!=='true')throw Error('REPORTING_DISABLED');
 const request=inventoryMarginReviewRequest.parse(input);
 const links=inventoryMarginDocumentPairs(request);
 const documents=await readGroupDocumentMatches(links);
 const source=await liveRegisteredGroupEvidence(request.query);
 const result=reviewInventoryMargin(source.control,source.rawSources,request,documents);
 assertStableFinancialReplay(source,await liveRegisteredGroupEvidence(request.query));
 assertStableFinancialReplay({documents},{documents:await readGroupDocumentMatches(links)});
 return result;
}
