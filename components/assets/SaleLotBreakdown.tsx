import {useId} from 'react';
import {z} from 'zod';

const postedSelection=z.object({
  method:z.enum(['FIFO','MANUAL']),
  cost_base:z.number().finite(),
  realized_gain_base:z.number().finite(),
  allocations:z.array(z.object({
    lot_id:z.string().uuid(),allocated_quantity:z.number().positive(),
    cost_base:z.number().nonnegative(),quantity_after:z.number().nonnegative(),cost_after:z.number().nonnegative(),
  })).min(1),
});
export function postedSaleSummary(record:{id:string;reference?:string|null;metadata?:Record<string,unknown>|null;base_currency?:string;base_value?:number|string},ar:boolean):SaleLotSummary|null {
  const result=postedSelection.safeParse(record.metadata?.lot_selection);
  if(!result.success || !record.metadata?.lot_sale_request || !record.base_currency?.match(/^[A-Z]{3}$/) ||
    record.base_value==null || !Number.isFinite(Number(record.base_value))) return null;
  const data=result.data;
  const sources=z.record(z.string(),z.object({asset:z.string(),date:z.string(),source:z.string()})).safeParse(record.metadata?.lot_source_vouchers);
  return {reference:record.reference||record.id,currency:record.base_currency,unit:ar?'غ':'g',
    method:data.method,proceeds:Number(record.base_value),cost:data.cost_base,realizedGain:data.realized_gain_base,
    allocations:data.allocations.map(lot=>({lotId:lot.lot_id,lotLabel:sources.success&&sources.data[lot.lot_id]?
      [sources.data[lot.lot_id].asset,sources.data[lot.lot_id].source,sources.data[lot.lot_id].date].join(' · '):(ar?'الحزمة ':'Lot ')+lot.lot_id,
      quantity:lot.allocated_quantity,cost:lot.cost_base,remainingQuantity:lot.quantity_after,remainingCost:lot.cost_after}))};
}

type SaleAllocation = {
  lotId:string;
  lotLabel:string;
  quantity:number;
  cost:number;
  remainingQuantity:number;
  remainingCost:number;
};

export type SaleLotSummary = {
  reference:string;
  currency:string;
  unit:string;
  method:'FIFO'|'MANUAL';
  proceeds:number;
  cost:number;
  realizedGain:number;
  allocations:SaleAllocation[];
};

/** All amounts are read back from the posted sale in its base currency. */
export default function SaleLotBreakdown({sale,ar}:{sale:SaleLotSummary;ar:boolean}){
  const heading=useId();
  const language=ar?'ar-SA':'en';
  const money=new Intl.NumberFormat(language,{style:'currency',currency:sale.currency});
  const quantity=new Intl.NumberFormat(language,{maximumFractionDigits:8});
  const t=(arabic:string,english:string)=>ar?arabic:english;
  return <section aria-labelledby={heading} dir={ar?'rtl':'ltr'}>
    <h3 id={heading}>{t('سند بيع','Sale voucher')} {sale.reference}</h3>
    <dl className="operation-detail-grid">
      <div><dt>{sale.realizedGain<0?t('الخسارة المحققة','Realized loss'):t('الربح المحقق','Realized gain')}</dt>
        <dd><strong>{money.format(Math.abs(sale.realizedGain))}</strong></dd></div>
      <div><dt>{t('إجمالي البيع قبل الرسوم والضريبة','Gross sale before fees and tax')}</dt><dd>{money.format(sale.proceeds)}</dd></div>
      <div><dt>{t('تكلفة المباع','Cost of sale')}</dt><dd>{money.format(sale.cost)}</dd></div>
    </dl>
    <details><summary>{t('تخصيص الحزم','Lot allocation')} · {sale.method==='FIFO'?t('الأقدم أولاً','FIFO'):t('تحديد يدوي','Manual selection')}</summary>
      <ul>{sale.allocations.map(lot=><li key={lot.lotId}>
        <strong>{lot.lotLabel}</strong>
        <div>{t('المباع','Sold')} {quantity.format(lot.quantity)} {sale.unit} · {t('بتكلفة','at cost')} {money.format(lot.cost)}</div>
        <div>{t('المتبقي من الحزمة بعد البيع','Lot balance after sale')} {quantity.format(lot.remainingQuantity)} {sale.unit} · {money.format(lot.remainingCost)}</div>
      </li>)}</ul>
    </details>
  </section>;
}
