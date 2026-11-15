import Decimal from 'decimal.js';
import {z} from 'zod';

const Money=Decimal.clone({precision:50,rounding:Decimal.ROUND_HALF_UP});
const uuid=z.string().uuid();
export const inventoryTaxAssessmentSchema=z.object({
 buyerOrganizationId:uuid,
 saleEventId:uuid,costEventId:uuid,purchaseEventId:uuid,evidenceDocumentId:uuid,
 buyerTaxBasis:z.string().regex(/^\d{1,20}(\.\d{1,4})?$/),
 buyerRecoveryRatePercent:z.string().refine(value=>
  /^\d{1,3}(\.\d{1,6})?$/.test(value)&&new Money(value).gt(0)&&new Money(value).lte(100)),
 recoverability:z.enum(['PROBABLE','NOT_PROBABLE']),
}).strict();
export type InventoryTaxAssessment=z.infer<typeof inventoryTaxAssessmentSchema>;

/** The verified buyer booked the transfer price. Requiring the tax basis to
 * equal that price avoids assuming how to reverse pre-existing buyer book tax. */
export function inventoryDeferredTaxReview(
 purchaseAmount:string,groupCarryingAmount:string,assessment:InventoryTaxAssessment,
){
 const taxBasis=new Money(assessment.buyerTaxBasis),carrying=new Money(groupCarryingAmount);
 if(!taxBasis.eq(purchaseAmount)||taxBasis.lt(carrying))throw Error('GROUP_INVENTORY_TAX_BASIS_UNSUPPORTED');
 const difference=taxBasis.minus(carrying);
 const potential=difference.mul(assessment.buyerRecoveryRatePercent).div(100).toDecimalPlaces(4);
 const asset=assessment.recoverability==='PROBABLE'?potential:new Money(0);
 return {
  buyerTaxBasis:taxBasis.toFixed(4),consolidatedInventoryCarryingAmount:carrying.toFixed(4),
  deductibleTemporaryDifference:difference.toFixed(4),
  buyerRecoveryRatePercent:assessment.buyerRecoveryRatePercent,recoverability:assessment.recoverability,
  deferredTaxAssetIncrease:asset.toFixed(4),unrecognizedDeferredTaxAsset:potential.minus(asset).toFixed(4),
  groupAfterTaxProfitReduction:difference.minus(asset).toFixed(4),
 };
}
