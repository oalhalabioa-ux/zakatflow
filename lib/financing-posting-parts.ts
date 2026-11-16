import Decimal from 'decimal.js';
export type FinancingPostingPart={role:'FINANCE_PRINCIPAL_PAYMENT'|'FINANCE_CHARGE_PAYMENT';obligationId:string;amount:number;baseAmount:number};
/** Preserve one source line per actual obligation; a combined line cannot clear
 * principal and accrued finance charges on different ledger accounts. */
export function financingPostingLines(parts:readonly FinancingPostingPart[],classificationId:string,currency:string,rate:number,total:number,baseTotal:number,description:string,direction:'OUTFLOW'|'INFLOW'){
 if(!parts.length||parts.length>2||new Set(parts.map(p=>p.role)).size!==parts.length||new Set(parts.map(p=>p.obligationId)).size!==parts.length)throw Error('FINANCE_SETTLEMENT_PARTS_INVALID');
 if(parts.some(p=>!p.obligationId||!Number.isFinite(p.amount)||!Number.isFinite(p.baseAmount)||p.amount<=0||p.baseAmount<=0||!new Decimal(p.amount).mul(rate).toDecimalPlaces(4).eq(p.baseAmount))||!parts.reduce((s,p)=>s.plus(p.amount),new Decimal(0)).eq(total)||!parts.reduce((s,p)=>s.plus(p.baseAmount),new Decimal(0)).eq(baseTotal))throw Error('FINANCE_SETTLEMENT_PARTS_INVALID');
 return parts.map((p,i)=>({line_number:i+1,classification_id:classificationId,cost_center_id:null,description,amount:p.amount,currency,exchange_rate:rate,base_amount:p.baseAmount,cash_direction:direction,vat_treatment:'OUT_OF_SCOPE',vat_rate:0,vat_amount:0,metadata:{source_role:p.role,settlement_obligation_id:p.obligationId}}));
}
