import {expect,it} from 'vitest';
import {inventoryMarginDocumentPairs,inventoryMarginReviewRequest,reviewInventoryMargin} from '../lib/financial-group-inventory-margin';
import {sourceBoundGroupFixture} from './financial-reporting/group-source-bound-fixture';

const id=(n:number)=>'90000000-0000-4000-8000-'+String(n).padStart(12,'0');
function fixture(upstream=true){
 const {control,sources}=sourceBoundGroupFixture();
 control.relationships[0].directEconomicInterestPercent='80';
 const [parent,child]=sources;
 const [seller,buyer]=upstream?[child,parent]:[parent,child];
 const templates=sources.map(source=>structuredClone(source.events[0]));
 const rules=sources.map(source=>structuredClone(source.policy.rules[0]));
 for(const source of sources){
  for(const [code,kind] of [['1700','ASSET'],['5100','COGS']] as const){
   source.accounts.push({...source.accounts[0],id:code+'98',reportingCode:code,kind,cash:false});
  }
  source.events=[];
  source.policy.rules=[];
 }
 function post(index:number,eventId:string,debitAccountId:string,creditAccountId:string,baseAmount:string){
  const source=sources[index],event=templates[index],classificationId=eventId+':BASE';
  source.events.push({...event,id:eventId,date:'2026-06-10',sourceKey:eventId,lines:[
   {...event.lines[0],id:eventId+':BASE',classificationId,baseAmount,cashDirection:'NON_CASH',recognitionSign:1},
  ]});
  source.policy.rules.push({...rules[index],id:'rule:'+eventId,classificationId,sourceModule:event.sourceModule,
   eventType:event.eventType,cashDirection:'NON_CASH',debitAccountId,creditAccountId});
 }
 const sellerIndex=sources.indexOf(seller),buyerIndex=sources.indexOf(buyer);
 post(sellerIndex,id(1),'110001','410001','1000.0000');
 post(sellerIndex,id(2),'510098','170098','800.0000');
 post(buyerIndex,id(3),'170098','210001','1000.0000');
 const request=inventoryMarginReviewRequest.parse({
  action:'REVIEW_INVENTORY_MARGIN',query:{organization:control.rootOrganizationId,from:control.from,to:control.to},
  sellerOrganizationId:seller.organizationId,buyerOrganizationId:buyer.organizationId,
  saleEventId:id(1),costEventId:id(2),purchaseEventId:id(3),saleDocumentMatchId:id(4),costDocumentMatchId:id(5),
 });
 const documents=inventoryMarginDocumentPairs(request).map(pair=>({
  id:pair.documentMatchId,status:'APPROVED',leftOrganizationId:pair.debitSource.organizationId,
  leftEventId:pair.debitSource.eventId,rightOrganizationId:pair.creditSource.organizationId,
  rightEventId:pair.creditSource.eventId,evidenceReference:'Paired inventory transfer and original cost vouchers',
  approvedBy:id(6),approvedAt:'2026-11-15T08:00:00Z',sourceCurrent:true,
 }));
 return {control,sources,buyer,seller,request,documents,post,buyerIndex};
}

it('calculates the pre-tax margin and attributes only the selling subsidiary share to NCI',()=>{
 for(const upstream of [true,false]){
  const f=fixture(upstream);
  expect(reviewInventoryMargin(f.control,f.sources,f.request,f.documents)).toMatchObject({
   revenueReduction:'1000.0000',costOfSalesReduction:'800.0000',inventoryReduction:'200.0000',
   groupPretaxProfitReduction:'200.0000',taxAssessmentRequired:true,issuanceReady:false,
   illustrativePretaxAttribution:{parent:upstream?'160.0000':'200.0000',nonControllingInterests:upstream?'40.0000':'0.0000'},
  });
 }
});

it('withholds the preview if a later movement or opening amount prevents proving the dedicated balance',()=>{
 const f=fixture();
 f.post(f.buyerIndex,id(7),'510098','170098','100.0000');
 expect(()=>reviewInventoryMargin(f.control,f.sources,f.request,f.documents)).toThrow('GROUP_INVENTORY_REMAINING_STOCK_UNVERIFIED');
 f.buyer.events.pop();f.buyer.policy.rules.pop();
 f.buyer.opening.push({accountId:'170098',debit:'100.0000',credit:'0.0000'});
 const equity=f.buyer.opening.find(item=>item.accountId==='310001')!;
 equity.credit=(Number(equity.credit)+100).toFixed(4);
 expect(()=>reviewInventoryMargin(f.control,f.sources,f.request,f.documents)).toThrow('GROUP_INVENTORY_REMAINING_STOCK_UNVERIFIED');
});

it('rejects revoked documentary evidence, a loss, or a mismatch in original transfer amounts',()=>{
 const f=fixture();
 expect(()=>reviewInventoryMargin(f.control,f.sources,f.request,[f.documents[0],{...f.documents[1],status:'REVOKED'}]))
  .toThrow('GROUP_ADJUSTMENT_DOCUMENT_NOT_APPROVED');
 f.seller.events[1].lines[0].baseAmount='1010.0000';
 expect(()=>reviewInventoryMargin(f.control,f.sources,f.request,f.documents)).toThrow('GROUP_INVENTORY_LOSS_REQUIRES_REVIEW');
 f.buyer.events[0].lines[0].baseAmount='999.0000';
 expect(()=>reviewInventoryMargin(f.control,f.sources,f.request,f.documents)).toThrow('GROUP_INVENTORY_SOURCE_UNAVAILABLE');
 expect(inventoryMarginReviewRequest.safeParse({...f.request,amount:'1'}).success).toBe(false);
});
