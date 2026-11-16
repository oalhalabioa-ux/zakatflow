import type {VoucherIdentity} from './voucher-identity';
import Decimal from 'decimal.js';
import {z} from 'zod';
export const payableCommandSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('PREPARE'),request_id:z.string().uuid(),account_id:z.string().uuid(),flow_id:z.string().uuid(),date:z.string().date(),amount:z.number().finite().positive().max(1e12),notes:z.string().trim().min(1).max(500)}).strict(),
 z.object({action:z.enum(['APPROVE_AND_POST','APPROVE','SUBMIT','POST','CANCEL']),event_id:z.string().uuid(),reason:z.string().trim().min(1).max(500)}).strict()
]);
export function payablePaymentAmounts(amount:number,rate:number,outstandingBase:number,flowOutstanding:number){
 const requested=new Decimal(amount),fx=new Decimal(rate);if(!requested.isFinite()||!fx.isFinite()||requested.lte(0)||fx.lte(0))throw Error('SETTLEMENT_AMOUNT_INVALID');
 const base=requested.mul(fx).toDecimalPlaces(4);
 if(base.lte(0)||base.gt(outstandingBase)||requested.gt(flowOutstanding))throw Error('SETTLEMENT_EXCEEDS_OUTSTANDING');
 return {amount:requested.toNumber(),baseAmount:base.toNumber(),exchangeRate:fx.toNumber()};
}
export const payableStatus=(outstanding:number,applied:number)=>outstanding<=0?'SETTLED':applied>0?'PARTIAL':'OPEN';
export const payableStatusNames:Record<string,string>={SETTLED:'مسدد / تمت تسويته',PARTIAL:'مسدد جزئيًا',OPEN:'غير مسدد',DRAFT:'مسودة',PLANNED:'مخطط',COMMITTED:'بانتظار الاعتماد / التنفيذ',ACTUAL:'منفذ',CANCELLED:'ملغى',REVERSED:'معكوس'};
export type PayableDetail=VoucherIdentity&{organization:{id:string;name:string;base_currency:string};obligation:any;event:any;partyName:string;reference:string;flows:any[];accounts:any[];history:any[];requests:Array<{event:any;instruction:any;approved:boolean;actions:string[]}>;canPrepare:boolean;sourceManaged:boolean};
