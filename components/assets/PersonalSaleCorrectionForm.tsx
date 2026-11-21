'use client';

import {useEffect, useState} from 'react';
import Decimal from 'decimal.js';
import ActionButton from '../ActionButton';

type Asset = {
  id: string;
  name: string;
  asset_type: string;
  ownership_scope: string;
  currency: string;
  status: string;
  metadata?: {investment_id?: string};
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
  metadata: {proceeds_account_id: string};
};

type Props = {
  sale: Sale;
  ar: boolean;
  busy: boolean;
  onSave: (data: object) => void;
  onCancel: () => void;
};

function initialUnitPrice(sale: Sale) {
  return sale.unit_price == null
    ? new Decimal(sale.gross_value).div(sale.quantity).toDecimalPlaces(8).toString()
    : String(sale.unit_price);
}

export default function PersonalSaleCorrectionForm({sale, ar, busy, onSave, onCancel}: Props) {
  const t = (arabic: string, english: string) => ar ? arabic : english;
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
  }, []);

  const assets = accounts.filter(asset => !asset.metadata?.investment_id);
  const selected = assets.find(asset => asset.id === form.asset_account_id);
  const currency = selected?.currency;
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
  const total = preserveGross ? new Decimal(sale.gross_value) :
    new Decimal(form.quantity || 0).times(form.unit_price || 0).toDecimalPlaces(8);
  const rate = sameCurrency ? '1' : form.fx_rate;
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

  const canSave = !busy && !!selected && !!deposit && total.gt(0) &&
    baseTotal.gt(0) && form.reason.trim().length >= 5;
  return (
    <form className="section" onSubmit={event => {
      event.preventDefault();
      if (!canSave) return;
      onSave({
        ...form, action: 'correct-sale', request_id: requestId,
        quantity: Number(form.quantity), unit_price: Number(form.unit_price), fx_rate: Number(rate),
      });
    }}>
      <h4>{t('تصحيح سند البيع الشخصي', 'Correct personal sale voucher')}</h4>
      <p className="muted">{t('سيعكس يقين حركة البيع والقبض السابقة ويحفظ البيع المصحح في سند مرتبط.',
        'Yaqeen will reverse the original sale and receipt and save the corrected sale as a linked voucher.')}</p>
      {loading && <p role="status">{t('جار تحميل الأصول والحسابات…', 'Loading assets and accounts…')}</p>}
      {loadError && <p role="alert">{t('تعذر تحميل الأصول. أعد فتح نموذج التصحيح.', 'Could not load assets. Reopen the correction form.')}</p>}
      <fieldset disabled={busy || loading || loadError} style={{border: 0, padding: 0, margin: 0}}>
        <div className="form-grid">
          <label>{t('الأصل المباع', 'Sold asset')}
            <select autoFocus required value={selected?.id ?? ''} onChange={event => selectAsset(event.target.value)}>
              <option value="">{t('اختر أصلًا', 'Select an asset')}</option>
              {assets.map(asset => <option key={asset.id} value={asset.id}>{asset.name} · {asset.currency}</option>)}
            </select>
          </label>
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
          <label>{t('سعر الوحدة', 'Unit price')}{currency && ` (${currency})`}
            <input type="number" min="0.00000001" step="0.00000001" required value={form.unit_price} onChange={event => setForm({...form, unit_price:event.target.value})}/>
          </label>
          {currency && !sameCurrency && <label>{t('سعر الصرف إلى', 'Exchange rate to')} {sale.base_currency}
            <input type="number" min="0.000000000001" step="any" required value={form.fx_rate} onChange={event => setForm({...form, fx_rate:event.target.value})}/>
          </label>}
          <label>{t('الملاحظات', 'Notes')}
            <textarea maxLength={2000} value={form.notes} onChange={event => setForm({...form, notes:event.target.value})}/>
          </label>
          <label>{t('سبب التصحيح', 'Correction reason')}
            <textarea required minLength={5} maxLength={500} value={form.reason} onChange={event => setForm({...form, reason:event.target.value})}/>
          </label>
        </div>
      </fieldset>
      {currency && <p><strong>{t('إجمالي البيع المصحح', 'Corrected sale total')}</strong> <output>
        {formatMoney(total.toString(), currency)}{!sameCurrency && rate && ` · ${formatMoney(baseTotal.toString(), sale.base_currency)}`}
      </output></p>}
      <div className="operation-detail-actions">
        <ActionButton type="submit" icon="save" label={busy ? t('جار الحفظ…', 'Saving…') : t('حفظ التصحيح', 'Save correction')} showLabel disabled={!canSave}/>
        <ActionButton icon="close" label={t('إلغاء', 'Cancel')} disabled={busy} onClick={onCancel}/>
      </div>
    </form>
  );
}
