'use client';

import {useEffect, useState} from 'react';
import Link from 'next/link';
import {personalSaleCorrectionMessage,type SalePreflight} from '../../lib/personal-sale-correction';
import Decimal from 'decimal.js';
import ActionButton from '../ActionButton';

type Asset = {
  id: string;
  name: string;
  asset_type: string;
  ownership_scope: string;
  currency: string;
  status: string;
  unit?: string | null;
  current_quantity?: number | string;
  lots?: {acquisition_date: string}[];
  metadata?: {investment_id?: string; karat?: string | number};
};

type Sale = {
  id: string;
  asset_account_id: string;
  transaction_date: string;
  quantity: number | string;
  unit_price?: number | string | null;
  gross_value: number | string;
  base_value: number | string;
  currency: string;
  base_currency: string;
  notes?: string | null;
  metadata: {proceeds_account_id: string; sale_price_amendment?: {revision: number; result?: {exchange_rate: number}}};
};

type Props = {
  sale: Sale;
  ar: boolean;
  busy: boolean;
  eligibility: SalePreflight;
  onSave: (data: {action:string; [field:string]:unknown}) => void;
  onCancel: () => void;
};

function initialUnitPrice(sale: Sale) {
  return sale.unit_price == null
    ? new Decimal(sale.gross_value).div(sale.quantity).toDecimalPlaces(8).toString()
    : String(sale.unit_price);
}

export default function PersonalSaleCorrectionForm({sale, ar, busy, eligibility, onSave, onCancel}: Props) {
  const t = (arabic: string, english: string) => ar ? arabic : english;
  const [mode,setMode]=useState<'price'|'asset'|'structure'>(() =>
    !eligibility.amount_block || eligibility.structural_block === 'GROUPED_SALE_REVERSAL_UNAVAILABLE' ? 'price' : 'asset');
  const amountOnly=mode==='price';
  const assetOnly=mode==='asset';
  const [checked,setChecked]=useState<{key:string;result:SalePreflight}|null>(null);
  const [accounts, setAccounts] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const [form, setForm] = useState(() => ({
    asset_account_id: sale.asset_account_id,
    proceeds_account_id: sale.metadata.proceeds_account_id,
    transaction_date: sale.transaction_date,
    quantity: String(sale.quantity),
    unit_price: initialUnitPrice(sale),
    fx_rate: sale.currency===sale.base_currency ? '1' :
      new Decimal(sale.base_value).div(sale.gross_value).toDecimalPlaces(12).toString(),
    notes: sale.notes ?? '',
    reason: '',
  }));

  useEffect(() => {
    if(amountOnly)return;
    setLoading(true);
    setLoadError(false);
    const controller = new AbortController();
    fetch('/api/assets', {signal: controller.signal, cache: 'no-store'})
      .then(async response => {
        if (!response.ok) throw Error('ASSETS_LOAD_FAILED');
        const assets: Asset[] = await response.json();
        if (!controller.signal.aborted) {
          setAccounts(assets.filter(asset => asset.ownership_scope === 'PERSONAL' && asset.status === 'ACTIVE'));
        }
      })
      .catch(() => { if (!controller.signal.aborted) setLoadError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [amountOnly]);

  const {asset_account_id,proceeds_account_id,transaction_date}=form;
  const structuralKey=[asset_account_id,proceeds_account_id,transaction_date].join('|');
  const unchangedStructure=asset_account_id===sale.asset_account_id &&
    proceeds_account_id===sale.metadata.proceeds_account_id && transaction_date===sale.transaction_date;
  useEffect(()=>{
    if(amountOnly||unchangedStructure||!asset_account_id||!proceeds_account_id||!transaction_date)return;
    const controller=new AbortController();
    const timeout=window.setTimeout(async()=>{
      try{
        const response=await fetch(`/api/transactions/${sale.id}`,{
          method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
          body:JSON.stringify({action:'sale-preflight',asset_account_id,proceeds_account_id,transaction_date}),
        });
        if(!response.ok)throw Error('SALE_CORRECTION_PREFLIGHT_FAILED');
        const result=await response.json();
        if(!controller.signal.aborted)setChecked({key:structuralKey,result});
      }catch{
        if(!controller.signal.aborted)setChecked({key:structuralKey,result:{
          amount_block:null,structural_block:'SALE_CORRECTION_PREFLIGHT_FAILED',movements:[],
        }});
      }
    },180);
    return()=>{window.clearTimeout(timeout);controller.abort();};
  },[amountOnly,unchangedStructure,asset_account_id,proceeds_account_id,transaction_date,structuralKey,sale.id]);

  const preflight=amountOnly||unchangedStructure?eligibility:checked?.key===structuralKey?checked.result:null;
  const block=amountOnly?preflight?.amount_block:preflight?.structural_block;
  const reviewBlock=block??(amountOnly?preflight?.structural_block:null);
  const assets = accounts.filter(asset =>
    !asset.metadata?.investment_id && !['BANK','CASH','RECEIVABLE'].includes(asset.asset_type));
  const original = assets.find(asset => asset.id === sale.asset_account_id);
  const assetChoices = assetOnly ? assets.filter(asset =>
    asset.currency === sale.currency && (!original ||
      (asset.asset_type === original.asset_type && asset.unit === original.unit &&
        String(asset.metadata?.karat ?? '') === String(original.metadata?.karat ?? '')))) : assets;
  const selected = assets.find(asset => asset.id === form.asset_account_id);
  const currency = amountOnly ? sale.currency : selected?.currency;
  const sameCurrency = currency === sale.base_currency;
  const deposits = accounts.filter(account => account.id !== selected?.id &&
    ['CASH', 'BANK'].includes(account.asset_type) && [currency, sale.base_currency].includes(account.currency));
  const deposit = deposits.find(account => account.id === form.proceeds_account_id);
  const formatMoney = (amount: string, code: string) =>
    new Intl.NumberFormat(ar ? 'ar-SA' : 'en', {
      style: 'currency', currency: code, maximumFractionDigits: 8,
    }).format(Number(amount));
  const preserveGross = Number(form.quantity) === Number(sale.quantity) &&
    Number(form.unit_price) === Number(initialUnitPrice(sale));
  const quantity=amountOnly?String(sale.quantity):form.quantity;
  const total = (amountOnly ? Number(form.unit_price)===Number(initialUnitPrice(sale)) : preserveGross)
    ? new Decimal(sale.gross_value) : new Decimal(quantity || 0).times(form.unit_price || 0).toDecimalPlaces(8);
  const savedRate=sale.metadata.sale_price_amendment?.result?.exchange_rate;
  const originalRate=savedRate==null?new Decimal(sale.base_value).div(sale.gross_value):new Decimal(savedRate);
  const rate = amountOnly ? originalRate.toString() : sameCurrency ? '1' : form.fx_rate;
  const preserveBase = preserveGross && currency === sale.currency &&
    new Decimal(sale.base_value).div(sale.gross_value).toDecimalPlaces(12).eq(rate || 0);
  const baseTotal = preserveBase ? new Decimal(sale.base_value) : total.times(rate || 0).toDecimalPlaces(8);

  function selectAsset(id: string) {
    const next = assets.find(asset => asset.id === id);
    const nextCurrency = next?.currency;
    setForm(current => ({
      ...current,
      asset_account_id: id,
      proceeds_account_id: deposit && deposit.id !== id &&
        [nextCurrency, sale.base_currency].includes(deposit.currency) ? deposit.id : '',
      unit_price: nextCurrency === currency ? current.unit_price : '',
      fx_rate: nextCurrency === sale.base_currency ? '1' : nextCurrency === currency ? current.fx_rate : '',
    }));
  }

  const priceChanged=Number(form.unit_price)!==Number(initialUnitPrice(sale));
  const structuralChanged=!unchangedStructure||Number(form.quantity)!==Number(sale.quantity);
  const preservesLaterAllocations=preflight?.preserves_later_allocations === true;
  const hasOtherChanges=transaction_date!==sale.transaction_date || proceeds_account_id!==sale.metadata.proceeds_account_id ||
    !preserveGross || !preserveBase;
  const canSave = !busy && !(preservesLaterAllocations && hasOtherChanges) && !!preflight && !block && total.gt(0) && baseTotal.gt(0) &&
    form.reason.trim().length>=5 && (amountOnly?priceChanged:!!selected&&!!deposit&&structuralChanged);
  return (
    <form className="section" onSubmit={event => {
      event.preventDefault();
      if (!canSave) return;
      if(amountOnly){
        onSave({action:'amend-sale-price',request_id:requestId,
          expected_revision:sale.metadata.sale_price_amendment?.revision??0,
          unit_price:Number(form.unit_price),reason:form.reason});
        return;
      }
      onSave({
        ...form, action: 'correct-sale', request_id: requestId,
        quantity: Number(form.quantity), unit_price: Number(form.unit_price), fx_rate: Number(rate),
      });
    }}>
      <h4>{t('تصحيح سند البيع الشخصي', 'Correct personal sale voucher')}</h4>
      <label>{t('نوع التصحيح','Correction type')}
        <select value={mode} onChange={event=>{
          const next=event.target.value as typeof mode;
          if(next==='asset')setForm(current=>({
            ...current, asset_account_id:sale.asset_account_id, proceeds_account_id:sale.metadata.proceeds_account_id,
            transaction_date:sale.transaction_date, quantity:String(sale.quantity), unit_price:initialUnitPrice(sale),
            fx_rate:originalRate.toDecimalPlaces(12).toString(), notes:sale.notes??'',
          }));
          setMode(next);
        }} disabled={busy}>
          <option value="price">{t('السعر والمبلغ','Price and amount')}</option>
          <option value="asset" disabled={eligibility.structural_block==='GROUPED_SALE_REVERSAL_UNAVAILABLE'}>{t('تغيير الأصل فقط','Change sold asset only')}</option>
          <option value="structure" disabled={eligibility.structural_block==='GROUPED_SALE_REVERSAL_UNAVAILABLE'}>{t('الأصل أو الكمية أو التاريخ أو حساب القبض','Asset, quantity, date or proceeds account')}</option>
        </select>
      </label>
      <p className="muted">{amountOnly?t('يُحفظ السعر على نفس السند ويُسوّى مبلغ القبض المرتبط مع بقاء الكمية وتخصيص الدفعات وسعر الصرف.',
        'Updates the same voucher and its linked receipt while preserving quantity, lot allocation and exchange rate.'):
        t('سيعكس يقين حركة البيع والقبض السابقة ويحفظ البيع المصحح في سند مرتبط.',
          'Yaqeen will reverse the original sale and receipt and save the corrected sale as a linked voucher.')}</p>
      {preservesLaterAllocations&&!amountOnly&&(hasOtherChanges
        ? <p role="alert">{t('اختر «تغيير الأصل فقط» للمحافظة على الحركات اللاحقة.', 'Choose “Change sold asset only” to preserve later movements.')}</p>
        : <p role="status">{t('تم التحقق. يبقى تخصيص الدفعات وتكلفة السندات اللاحقة وأثرها على الحول كما هي.', 'Verified. Later vouchers retain their lot allocations, cost and Hawl treatment.')}</p>)}
      {block&&<p role="alert">{personalSaleCorrectionMessage(block,ar)}</p>}
      {!amountOnly&&!preflight&&!loading&&<p role="status">{t('جار التحقق من الحركات المرتبطة…','Checking dependent movements…')}</p>}
      {reviewBlock&&!!preflight?.movements.length&&<section aria-label={t('الحركات المرتبطة','Dependent movements')}>
        {amountOnly&&!block&&<p>{t('هذه الحركات تمنع تغيير بنية البيع. تصحيح السعر متاح.', 'These movements block changes to the sale structure. Price correction is available.')}</p>}
        <ul>{preflight.movements.map(movement=><li key={movement.id}>
          <Link href={`/${ar?'ar':'en'}/transactions/${movement.id}`} target="_blank" rel="noopener">
            {movement.document_sequence??movement.type} · {movement.date}
          </Link>{movement.same_lot&&t(' · استخدمت الدفعة نفسها',' · Used the same lot')}
        </li>)}</ul>
      </section>}
      {!amountOnly&&loading && <p role="status">{t('جار تحميل الأصول والحسابات…', 'Loading assets and accounts…')}</p>}
      {!amountOnly&&loadError && <p role="alert">{t('تعذر تحميل الأصول. أعد فتح نموذج التصحيح.', 'Could not load assets. Reopen the correction form.')}</p>}
      <fieldset disabled={busy || (!amountOnly&&(loading || loadError))} style={{border: 0, padding: 0, margin: 0}}>
        <div className="form-grid">
          {!amountOnly&&<>
          <label>{t('الأصل المباع', 'Sold asset')}
            <select autoFocus required value={selected?.id ?? ''} onChange={event => selectAsset(event.target.value)}>
              <option value="">{t('اختر أصلًا', 'Select an asset')}</option>
              {assetChoices.map(asset => {
                const acquisition=asset.lots?.map(lot=>lot.acquisition_date).sort()[0];
                const balance=asset.current_quantity;
                return <option key={asset.id} value={asset.id}>
                  {asset.name} · {asset.currency}
                  {acquisition && ` · ${acquisition}`}
                  {balance!=null && ` · ${t('متبقٍ','Remaining')} ${Number(balance).toLocaleString(ar?'ar-SA':'en')} ${asset.unit??''}`}
                  {asset.id===sale.asset_account_id && ` · ${t('الأصل المسجل','Recorded asset')}`}
                </option>;
              })}
            </select>
          </label>
          {!assetOnly&&<>
          <label>{t('حساب إيداع المتحصلات', 'Proceeds account')}
            <select required value={deposit?.id ?? ''} onChange={event => setForm({...form, proceeds_account_id:event.target.value})}>
              <option value="">{t('اختر بنكًا أو صندوقًا', 'Select a bank or cash account')}</option>
              {deposits.map(account => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}
            </select>
          </label>
          <label>{t('تاريخ البيع', 'Sale date')}
            <input type="date" required value={form.transaction_date} onChange={event => setForm({...form, transaction_date:event.target.value})}/>
          </label>
          <label>{t('الكمية', 'Quantity')}
            <input type="number" min="0.00000001" step="0.00000001" required value={form.quantity} onChange={event => setForm({...form, quantity:event.target.value})}/>
          </label>
          </>}
          </>}
          {assetOnly&&<p>{t('تاريخ البيع','Sale date')} · <bdi>{sale.transaction_date}</bdi></p>}
          {!assetOnly&&<label>{t('سعر الوحدة', 'Unit price')}{currency && ` (${currency})`}
            <input type="number" min="0.00000001" step="0.00000001" required value={form.unit_price} onChange={event => setForm({...form, unit_price:event.target.value})}/>
          </label>}
          {mode==='structure' && currency && !sameCurrency && <label>{t('سعر الصرف إلى', 'Exchange rate to')} {sale.base_currency}
            <input type="number" min="0.000000000001" step="any" required value={form.fx_rate} onChange={event => setForm({...form, fx_rate:event.target.value})}/>
          </label>}
          {mode==='structure'&&<label>{t('الملاحظات', 'Notes')}
            <textarea maxLength={2000} value={form.notes} onChange={event => setForm({...form, notes:event.target.value})}/>
          </label>}
          <label>{t('سبب التصحيح', 'Correction reason')}
            <textarea required minLength={5} maxLength={500} value={form.reason} onChange={event => setForm({...form, reason:event.target.value})}/>
          </label>
        </div>
      </fieldset>
      {currency && <p><strong>{t('إجمالي البيع المصحح', 'Corrected sale total')}</strong> <output>
        {formatMoney(total.toString(), currency)}{!sameCurrency && rate && ` · ${formatMoney(baseTotal.toString(), sale.base_currency)}`}
      </output></p>}
      <div className="operation-detail-actions">
        {!block&&<ActionButton type="submit" icon="save" label={busy ? t('جار الحفظ…', 'Saving…') : t('حفظ التصحيح', 'Save correction')} showLabel disabled={!canSave}/>}
        <ActionButton icon="close" label={t('إلغاء', 'Cancel')} disabled={busy} onClick={onCancel}/>
      </div>
    </form>
  );
}
