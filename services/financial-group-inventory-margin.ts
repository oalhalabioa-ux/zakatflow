import {inventoryMarginDocumentPairs,inventoryMarginReviewRequest,reviewInventoryMargin} from '../lib/financial-group-inventory-margin';
import {assertStableFinancialReplay} from '../lib/financial-source-replay';
import {readGroupDocumentMatches} from './financial-group-document-matches';
import {liveRegisteredGroupEvidence} from './financial-group-registered-source';
import {readApprovedInventoryTaxAssessment} from './financial-group-acquisition-review';
import {inventoryDeferredTaxReview} from '../lib/financial-group-inventory-tax';

export async function liveInventoryMarginReview(input:unknown){
 if(process.env.FINANCIAL_GROUP_ELIMINATION_PREVIEW!=='true')throw Error('REPORTING_DISABLED');
 const request=inventoryMarginReviewRequest.parse(input);
 const links=inventoryMarginDocumentPairs(request);
 const documents=await readGroupDocumentMatches(links);
 const source=await liveRegisteredGroupEvidence(request.query);
 const result=reviewInventoryMargin(source.control,source.rawSources,request,documents);
 const taxId=request.taxAssessmentRecordId;
 const tax=taxId?await readApprovedInventoryTaxAssessment(request.query,taxId):null;
 if(tax){
  const {measurement}=tax;
  const subsidiary=request.sellerOrganizationId===request.query.organization?request.buyerOrganizationId:request.sellerOrganizationId;
  if(tax.parentOrganizationId!==request.query.organization||tax.subsidiaryOrganizationId!==subsidiary||
   measurement.buyerOrganizationId!==request.buyerOrganizationId||measurement.saleEventId!==request.saleEventId||
   measurement.costEventId!==request.costEventId||measurement.purchaseEventId!==request.purchaseEventId)
   throw Error('GROUP_INVENTORY_TAX_ASSESSMENT_MISMATCH');
 }
 assertStableFinancialReplay(source,await liveRegisteredGroupEvidence(request.query));
 assertStableFinancialReplay({documents},{documents:await readGroupDocumentMatches(links)});
 if(!tax||!taxId)return result;
 assertStableFinancialReplay(tax,await readApprovedInventoryTaxAssessment(request.query,taxId));
 return {...result,taxAssessmentRequired:false,deferredTax:{
  approvedRecordId:taxId,evidenceDocumentId:tax.measurement.evidenceDocumentId,
  ...inventoryDeferredTaxReview(result.revenueReduction,result.costOfSalesReduction,tax.measurement),
 }};
}
