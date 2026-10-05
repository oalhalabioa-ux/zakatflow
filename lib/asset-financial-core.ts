export type AssetFinancialClass='CAPEX'|'ASSET'|'INVESTMENT';

export function assetPurchaseFinancialClass(assetClassCode:string):AssetFinancialClass{
 const code=assetClassCode.trim().toUpperCase();
 if(code==='PPE'||code==='INTANGIBLE')return 'CAPEX';
 if(code==='INVESTMENT')return 'INVESTMENT';
 if(code==='FINANCIAL'||code==='INVENTORY'||code==='OTHER')return 'ASSET';
 throw new Error('ASSET_CLASS_NOT_SUPPORTED');
}

export function assetPurchaseSourceKey(transactionId:string){return `asset-purchase:${transactionId}`;}

export function buildAssetPurchaseCoreIntent(input:{
 transactionId:string;assetId:string;organizationId:string;entityId:string|null;costCenterId:string|null;
 assetName:string;assetClassCode:string;transactionDate:string;currency:string;baseCurrency:string;
 amount:number;baseAmount:number;exchangeRate:number;vatAmount?:number;vatBaseAmount?:number;
 assetClassificationId:string;taxClassificationId?:string;counterpartyId?:string|null;dueDate?:string|null;
}){
 const vat=input.vatAmount??0;
 if(vat<0)throw new Error('ASSET_VAT_AMOUNT_INVALID');
 if(vat>0&&!input.taxClassificationId)throw new Error('ASSET_VAT_CLASSIFICATION_REQUIRED');
 const gross=input.amount+vat;
 const grossBase=input.baseAmount+(input.vatBaseAmount??vat*input.exchangeRate);
 const lines:Array<{line_number:number;description:string;classification_id:string;cost_center_id:string|null;amount:number;currency:string;exchange_rate:number;base_amount:number;cash_direction:'NON_CASH';vat_treatment:'OUT_OF_SCOPE';vat_rate:0;vat_amount:0}>=[{line_number:1,description:input.assetName,classification_id:input.assetClassificationId,cost_center_id:input.costCenterId,amount:input.amount,currency:input.currency,exchange_rate:input.exchangeRate,base_amount:input.baseAmount,cash_direction:'NON_CASH',vat_treatment:'OUT_OF_SCOPE',vat_rate:0,vat_amount:0}];
 if(vat>0)lines.push({line_number:2,description:`VAT - ${input.assetName}`,classification_id:input.taxClassificationId!,cost_center_id:input.costCenterId,amount:vat,currency:input.currency,exchange_rate:input.exchangeRate,base_amount:input.vatBaseAmount??vat*input.exchangeRate,cash_direction:'NON_CASH',vat_treatment:'OUT_OF_SCOPE',vat_rate:0,vat_amount:0});
 return {organization_id:input.organizationId,entity_id:input.entityId,counterparty_id:input.counterpartyId??null,event_type:'ASSET_PURCHASE' as const,source_module:'ASSETS_INTEGRATION' as const,source_record_id:input.transactionId,source_event_key:assetPurchaseSourceKey(input.transactionId),event_date:input.transactionDate,due_date:input.dueDate??input.transactionDate,base_currency:input.baseCurrency,description:`Asset purchase - ${input.assetName}`,lines,obligations:[{obligation_key:'asset-purchase-gross',obligation_type:'PAYABLE' as const,settleable_amount:gross,currency:input.currency,exchange_rate:input.exchangeRate,base_currency:input.baseCurrency,settleable_base_amount:grossBase}],links:[{link_type:'SOURCE' as const,target_module:'transactions',target_record_id:input.transactionId,metadata:{}},{link_type:'ASSET' as const,target_module:'asset_accounts',target_record_id:input.assetId,metadata:{asset_class_code:input.assetClassCode}}]};
}
