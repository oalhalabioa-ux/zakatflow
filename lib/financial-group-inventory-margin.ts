import Decimal from 'decimal.js';
import {z} from 'zod';
import {compileEventLedger} from './financial-event-ledger';
import {validateGroupControlScope,type GroupControlPreflight} from './financial-group-control';
import {statementQuery,statementSourceEnvelope} from './financial-statement-source';
import {verifyGroupDocumentMatches} from './financial-group-document-matches';

const Money=Decimal.clone({precision:50,rounding:Decimal.ROUND_HALF_UP});
const uuid=z.string().uuid();
export const inventoryMarginReviewRequest=z.object({
 action:z.literal('REVIEW_INVENTORY_MARGIN'),query:statementQuery,
 sellerOrganizationId:uuid,buyerOrganizationId:uuid,
 saleEventId:uuid,costEventId:uuid,purchaseEventId:uuid,
 saleDocumentMatchId:uuid,costDocumentMatchId:uuid,
}).strict();
type InventoryReview=z.infer<typeof inventoryMarginReviewRequest>;
export function inventoryMarginDocumentPairs(request:InventoryReview){
 return [[request.saleDocumentMatchId,request.saleEventId],[request.costDocumentMatchId,request.costEventId]].map(([id,eventId])=>({
  id,documentMatchId:id,debitSource:{organizationId:request.sellerOrganizationId,eventId},
  creditSource:{organizationId:request.buyerOrganizationId,eventId:request.purchaseEventId},
 }));
}
type Source=z.infer<typeof statementSourceEnvelope>;
type Ledger=ReturnType<typeof compileEventLedger>['source'];

/** Verify a complete, unsold transfer through an isolated inventory leaf.
 * Documentary matches bind both seller vouchers to the same buyer voucher.
 * No quantity, cost or ownership percentage is supplied by the caller. */
export function reviewInventoryMargin(control:GroupControlPreflight,raw:readonly Source[],request:InventoryReview,documents:unknown){
 const {query,sellerOrganizationId:sellerId,buyerOrganizationId:buyerId}=request;
 const scope=validateGroupControlScope(control);
 if(scope.rootOrganizationId!==query.organization||scope.from!==query.from||scope.to!==query.to||
   new Set([request.saleEventId,request.costEventId,request.purchaseEventId]).size!==3||
   request.saleDocumentMatchId===request.costDocumentMatchId)
  throw Error('GROUP_INVENTORY_SCOPE_INVALID');
 const relation=control.relationships.find(item=>item.parentOrganizationId===query.organization&&
  (sellerId===query.organization&&item.subsidiaryOrganizationId===buyerId||
   buyerId===query.organization&&item.subsidiaryOrganizationId===sellerId));
 const seller=raw.find(item=>item.organizationId===sellerId),buyer=raw.find(item=>item.organizationId===buyerId);
 if(!relation||!seller||!buyer||seller.currency!==buyer.currency||
   [seller,buyer].some(item=>item.origin!=='LIVE_CANONICAL_EVENTS'||item.from!==query.from||item.to!==query.to))
  throw Error('GROUP_INVENTORY_SCOPE_INVALID');
 verifyGroupDocumentMatches(inventoryMarginDocumentPairs(request),documents);

 const sellerLedger=compileEventLedger(seller).source,buyerLedger=compileEventLedger(buyer).source;
 function posted(source:Source,ledger:Ledger,id:string){
  const event=source.events.find(item=>item.id===id);
  const journal=ledger.journals.find(item=>item.id===id&&item.status==='POSTED');
  if(event?.status!=='ACTUAL'||!journal||journal.date<=query.from||journal.date>query.to||
   journal.reversesJournalId||ledger.journals.some(item=>item.reversesJournalId===id&&item.date<=query.to)||
   event.lines.length!==1||event.lines[0].recognitionSign!==1||event.lines[0].cashDirection!=='NON_CASH'||
   !event.lines[0].classificationId.endsWith(':BASE')||journal.lines.length!==2)
   throw Error('GROUP_INVENTORY_SOURCE_UNAVAILABLE');
  const debit=journal.lines.find(item=>new Money(item.debit).gt(0)&&new Money(item.credit).isZero());
  const credit=journal.lines.find(item=>new Money(item.credit).gt(0)&&new Money(item.debit).isZero());
  const dr=source.accounts.find(item=>item.id===debit?.accountId);
  const cr=source.accounts.find(item=>item.id===credit?.accountId);
  if(!debit||!credit||!dr||!cr||dr.cash||cr.cash||!new Money(debit.debit).eq(credit.credit))
   throw Error('GROUP_INVENTORY_SOURCE_UNAVAILABLE');
  return {dr,cr,date:journal.date,amount:new Money(debit.debit)};
 }
 const sale=posted(seller,sellerLedger,request.saleEventId);
 const cost=posted(seller,sellerLedger,request.costEventId);
 const purchase=posted(buyer,buyerLedger,request.purchaseEventId);
 if(sale.dr.kind!=='ASSET'||sale.dr.reportingCode!=='1100'||sale.cr.kind!=='REVENUE'||cost.dr.kind!=='COGS'||
   cost.cr.kind!=='ASSET'||cost.cr.reportingCode!=='1700'||purchase.dr.kind!=='ASSET'||
   purchase.dr.reportingCode!=='1700'||purchase.dr.id==='1700'||purchase.cr.kind!=='LIABILITY'||
   purchase.cr.reportingCode!=='2100'||sale.date!==cost.date||sale.date!==purchase.date||!sale.amount.eq(purchase.amount))
  throw Error('GROUP_INVENTORY_SOURCE_UNAVAILABLE');
 const inventoryAccountId=purchase.dr.id;
 if(buyer.opening.some(item=>item.accountId===inventoryAccountId&&!new Money(item.debit).eq(item.credit))||
   buyerLedger.journals.some(item=>item.id!==request.purchaseEventId&&item.date<=query.to&&
    item.lines.some(line=>line.accountId===inventoryAccountId)))
  throw Error('GROUP_INVENTORY_REMAINING_STOCK_UNVERIFIED');
 const margin=sale.amount.minus(cost.amount);
 if(margin.lt(0))throw Error('GROUP_INVENTORY_LOSS_REQUIRES_REVIEW');
 const sellingMinorityShare=sellerId===query.organization?new Money(0):
  new Money(100).minus(relation.directEconomicInterestPercent);
 const minority=margin.mul(sellingMinorityShare).div(100).toDecimalPlaces(4);
 return {
  status:'INVENTORY_MARGIN_REVIEW_ONLY' as const,query,currency:seller.currency,
  sellerOrganizationId:sellerId,buyerOrganizationId:buyerId,inventoryAccountId,
  revenueReduction:sale.amount.toFixed(4),costOfSalesReduction:cost.amount.toFixed(4),
  inventoryReduction:margin.toFixed(4),groupPretaxProfitReduction:margin.toFixed(4),
  illustrativePretaxAttribution:{parent:margin.minus(minority).toFixed(4),nonControllingInterests:minority.toFixed(4)},
  taxAssessmentRequired:!margin.isZero(),consolidated:false as const,issuanceReady:false as const,
 };
}
