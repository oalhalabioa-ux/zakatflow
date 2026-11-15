import Decimal from 'decimal.js';
import {z} from 'zod';
import {validateGroupControlScope,type GroupControlPreflight} from './financial-group-control';
const D=Decimal.clone({precision:50,rounding:Decimal.ROUND_HALF_UP});
const money=z.string().regex(/^\d{1,20}(\.\d{1,4})?$/);
const signed=z.string().regex(/^-?\d{1,20}(\.\d{1,4})?$/);
const evidence=z.string().trim().min(8).max(1000);
const scope={parentOrganizationId:z.string().uuid(),subsidiaryOrganizationId:z.string().uuid(),currency:z.string().regex(/^[A-Z]{3}$/)};
export const groupAcquisitionMeasurementSchema=z.object({
 ...scope,acquisitionDate:z.string().date(),
 // Explicitly constrained first acquisition of an ordinary-share business.
 // Different instruments, staged/common-control combinations and FX need their own adapters.
 transactionType:z.literal('SINGLE_STEP_BUSINESS_COMBINATION'),commonControl:z.literal(false),
 instruments:z.literal('ORDINARY_PROPORTIONATE'),
 consideration:money,considerationEvidence:evidence,
 continuityBasis:z.object({
  treatment:z.literal('NO_SUBSEQUENT_ADJUSTMENTS'),
  evidenceDocumentId:z.string().uuid(),
 }).strict().optional(),
 fairValueBasis:z.object({
  deferredTax:z.enum(['NOT_REQUIRED','INCLUDED_IN_IDENTIFIABLE_ITEMS']),
  taxEvidenceDocumentId:z.string().uuid(),
 }).strict().optional(),
 investmentLink:z.object({
  accountId:z.string().regex(/^1600(?:[0-9]{2}){1,3}$/),
  eventId:z.string().uuid(),
  lineId:z.string().min(1).max(200),
  documentId:z.string().uuid(),
 }).strict().optional(),
 identifiableItems:z.array(z.object({id:z.string().min(1).max(200),kind:z.enum(['ASSET','LIABILITY']),
  recognizedAmount:money,measurementEvidence:evidence}).strict()).min(1).max(1000),
 nci:z.discriminatedUnion('method',[
  z.object({method:z.literal('PROPORTIONATE_NET_ASSETS')}).strict(),
  z.object({method:z.literal('FAIR_VALUE'),amount:money,valuationEvidence:evidence}).strict(),
 ]),
}).strict();
export type GroupAcquisitionMeasurementInput=z.infer<typeof groupAcquisitionMeasurementSchema>;
function relationship(control:GroupControlPreflight,parent:string,subsidiary:string){
 validateGroupControlScope(control);
 // Nested NCI attribution must not reuse a direct parent's ownership percentage.
 if(parent!==control.rootOrganizationId)throw Error('GROUP_ACQUISITION_NESTED_OWNERSHIP_UNSUPPORTED');
 const r=control.relationships.find(r=>r.parentOrganizationId===parent&&r.subsidiaryOrganizationId===subsidiary);
 if(!r)throw Error('GROUP_ACQUISITION_CONTROL_REQUIRED');
 return r;
}
/** IFRS 3.19/32/34-36 calculation boundary. Inputs must ultimately come from
 * separately approved source-bound acquisition evidence. This pure function
 * does NOT authenticate evidence references, post journals or approve issuance.
 * Recognized acquisition-date amounts must already reflect IFRS exceptions,
 * deferred tax and all separately identifiable assets/liabilities. */
export function measureGroupAcquisition(control:GroupControlPreflight,input:unknown,reportingCurrency:string){
 const p=groupAcquisitionMeasurementSchema.parse(input);
 const r=relationship(control,p.parentOrganizationId,p.subsidiaryOrganizationId);
 if(p.currency!==reportingCurrency)throw Error('GROUP_ACQUISITION_FX_REQUIRED');
 if(p.acquisitionDate!==r.effectiveFrom||p.acquisitionDate>control.from)throw Error('GROUP_ACQUISITION_DATE_MISMATCH');
 if(new Set(p.identifiableItems.map(i=>i.id)).size!==p.identifiableItems.length)throw Error('GROUP_ACQUISITION_DUPLICATE_ITEM');
 const nciPercent=new D(100).minus(r.directEconomicInterestPercent);
 const assets=p.identifiableItems.filter(i=>i.kind==='ASSET').reduce((n,i)=>n.plus(i.recognizedAmount),new D(0));
 const liabilities=p.identifiableItems.filter(i=>i.kind==='LIABILITY').reduce((n,i)=>n.plus(i.recognizedAmount),new D(0));
 const netAssets=assets.minus(liabilities);
 const nci=p.nci.method==='FAIR_VALUE'?new D(p.nci.amount):netAssets.mul(nciPercent).div(100).toDecimalPlaces(4);
 if(nciPercent.isZero()&&!nci.isZero())throw Error('GROUP_ACQUISITION_NCI_WITHOUT_MINORITY');
 const difference=new D(p.consideration).plus(nci).minus(netAssets);
 return{status:'ACQUISITION_MEASUREMENT_ONLY' as const,consolidated:false as const,
  parentOrganizationId:p.parentOrganizationId,subsidiaryOrganizationId:p.subsidiaryOrganizationId,
  currency:p.currency,acquisitionDate:p.acquisitionDate,controlAssessmentId:r.controlAssessmentId,
  parentPercent:new D(r.directEconomicInterestPercent).toFixed(6),nciPercent:nciPercent.toFixed(6),method:p.nci.method,
  identifiableAssets:assets.toFixed(4),identifiableLiabilities:liabilities.toFixed(4),identifiableNetAssets:netAssets.toFixed(4),
  consideration:new D(p.consideration).toFixed(4),nciAtAcquisition:nci.toFixed(4),
  goodwill:D.max(difference,0).toFixed(4),bargainPurchaseCandidate:D.max(difference.negated(),0).toFixed(4),
  reassessmentRequired:difference.isNegative(),issuanceReady:false as const};
}
const attributionSchema=z.object({...scope,from:z.string().date(),to:z.string().date(),
 openingNci:signed,adjustedProfit:signed,
 oci:z.array(z.object({id:z.string().min(1).max(200),amount:signed}).strict()).max(100),
 ordinaryDividends:money,
 ownershipChanges:z.literal(false),otherEquityChanges:z.literal(false),goodwillImpairment:z.literal('0.0000'),
 instruments:z.literal('ORDINARY_PROPORTIONATE'),
 sourceEvidence:evidence,
}).strict();
/** IFRS 10.B94: attribute losses even when NCI becomes negative. This narrow
 * roll-forward accepts adjusted profit/each OCI component and ordinary dividends
 * with unchanged direct ownership. It is not an acquisition-opening attestation.
 * Impairment, preferential instruments and ownership/equity changes fail closed. */
export function attributeGroupNonControllingInterests(control:GroupControlPreflight,input:unknown,reportingCurrency:string){
 const p=attributionSchema.parse(input),r=relationship(control,p.parentOrganizationId,p.subsidiaryOrganizationId);
 if(p.currency!==reportingCurrency)throw Error('GROUP_ACQUISITION_FX_REQUIRED');
 if(p.from!==control.from||p.to!==control.to)throw Error('GROUP_NCI_PERIOD_MISMATCH');
 const nciPercent=new D(100).minus(r.directEconomicInterestPercent);
 if(nciPercent.isZero()&&!new D(p.openingNci).isZero())throw Error('GROUP_ACQUISITION_NCI_WITHOUT_MINORITY');
 if(new Set(p.oci.map(i=>i.id)).size!==p.oci.length)throw Error('GROUP_NCI_DUPLICATE_OCI');
 const split=(amount:string)=>{const total=new D(amount),nci=total.mul(nciPercent).div(100).toDecimalPlaces(4);
  return{total:total.toFixed(4),parent:total.minus(nci).toFixed(4),nci:nci.toFixed(4)};};
 const profit=split(p.adjustedProfit),oci=p.oci.map(i=>({id:i.id,...split(i.amount)})),dividends=split(p.ordinaryDividends);
 const nciOci=oci.reduce((n,i)=>n.plus(i.nci),new D(0));
 const closing=new D(p.openingNci).plus(profit.nci).plus(nciOci).minus(dividends.nci);
 return{status:'NCI_ATTRIBUTION_ONLY' as const,consolidated:false as const,issuanceReady:false as const,
  parentOrganizationId:p.parentOrganizationId,subsidiaryOrganizationId:p.subsidiaryOrganizationId,
  from:p.from,to:p.to,currency:p.currency,controlAssessmentId:r.controlAssessmentId,
  nciPercent:nciPercent.toFixed(6),openingNci:new D(p.openingNci).toFixed(4),profit,oci,dividends,
  nciOtherComprehensiveIncome:nciOci.toFixed(4),closingNci:closing.toFixed(4)};
}
