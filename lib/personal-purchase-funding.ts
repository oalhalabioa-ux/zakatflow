import {z} from 'zod';

const purchaseFundingSchema=z.object({
 version:z.literal(1),
 withdrawal_id:z.string().uuid(),
 payment_amount:z.number().finite().positive(),
 payment_currency:z.string().regex(/^[A-Z]{3}$/),
 base_currency:z.string().regex(/^[A-Z]{3}$/),
 asset_basis_base:z.number().finite().nonnegative(),
 cash_basis_base:z.number().finite().nonnegative(),
 realized_fx_base:z.number().finite(),
});

export type PurchaseFunding=z.infer<typeof purchaseFundingSchema> & {reversed:boolean};

export function purchaseFundingFromCashMovement(transaction:{
 id:string;transaction_type:string;reversal_of_transaction_id?:string|null;
 metadata?:Record<string,unknown>|null;
}):PurchaseFunding|undefined {
 const result=purchaseFundingSchema.safeParse(transaction.metadata?.purchase_funding);
 if(!result.success)return;
 const evidence=result.data;
 if(transaction.transaction_type==='WITHDRAWAL' && evidence.withdrawal_id===transaction.id &&
    transaction.metadata?.source==='ASSET_PURCHASE')return {...evidence,reversed:false};
 if(transaction.transaction_type==='REVERSAL' && evidence.withdrawal_id===transaction.reversal_of_transaction_id)
   return {...evidence,reversed:true};
}
