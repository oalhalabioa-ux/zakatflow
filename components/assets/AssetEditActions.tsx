"use client";

import {useEffect, useState} from "react";
import Link from "next/link";
import ActionButton from "@/components/ActionButton";
import {Money} from "@/components/DisplayCurrency";

export type AssetEditMode = "registration" | "valuation";
export type RegistrationLock = {code: "ACCESS" | "MOVEMENT" | "LIFECYCLE" | "ZAKAT"; id?: string; date?: string; reference?: string; operation?: string};
type Availability = {
  asset_registration_can_edit: boolean;
  asset_market_valuation_can_update: boolean;
  valuation_mode: "MANUAL" | "AUTOMATIC" | null;
  registration_lock: RegistrationLock | null;
  book: {gross: string; depreciation: string; net: number} | null;
};

export function registrationLockText(lock: RegistrationLock | null, ar: boolean) {
  if (lock?.code === "ACCESS") return ar ? "بيانات التسجيل للعرض فقط." : "Registration details are read-only.";
  if (lock?.code === "ZAKAT") return ar ? "بيانات التسجيل مقفلة لوجود احتساب زكاة محفوظ." : "Registration is locked by a saved Zakat assessment.";
  const operation = lock?.operation;
  if (operation === "SALE") return ar ? "بيانات التسجيل مقفلة لوجود سند بيع." : "Registration is locked by a sale voucher.";
  if (operation === "DEPRECIATION") return ar ? "بيانات التسجيل مقفلة لوجود سند إهلاك." : "Registration is locked by a depreciation voucher.";
  return ar ? "بيانات التسجيل مقفلة لوجود حركة مرتبطة." : "Registration is locked by a linked transaction.";
}

export default function AssetEditActions({asset, ar, locale, onEdit, onReview, onRefreshed}: {
  asset: {id: string; currency: string; current_value_currency?: string; current_valuation_date?: string;
    current_valuation_source?: string; current_valuation_currency?: string; current_market_price?: number;
    current_valuation_auto?: boolean; current_market_value?: number; organization_id?: string};
  ar: boolean;
  locale: string;
  onEdit: (mode: AssetEditMode) => void;
  onReview: (id: string) => void;
  onRefreshed: () => void;
}) {
  const [policy, setPolicy] = useState<Availability>();
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  async function refreshQuote() {
    setRefreshing(true);
    setRefreshFailed(false);
    try {
      const response = await fetch("/api/prices?live=1&asset_id="+encodeURIComponent(asset.id), {cache:"no-store"});
      if (!response.ok) throw Error();
      onRefreshed();
    } catch {
      setRefreshFailed(true);
    } finally {
      setRefreshing(false);
    }
  }
  useEffect(() => {
    const request = new AbortController();
    fetch("/api/assets?edit_asset_id="+encodeURIComponent(asset.id), {signal:request.signal, cache:"no-store"})
      .then(async response => {
        if (!response.ok) throw Error();
        setPolicy(await response.json());
      })
      .catch(() => {if (!request.signal.aborted) setFailed(true);});
    return () => request.abort();
  }, [asset.id]);
  const reject = policy?.registration_lock;
  const currency = asset.current_value_currency ?? asset.currency;
  return <div className="asset-registration-actions">
    {policy?.book && <dl className="operation-detail-grid">
      <div><dt>{ar?"التكلفة الدفترية الإجمالية":"Gross carrying cost"}</dt><dd><Money value={policy.book.gross} currency={currency} organizationId={asset.organization_id}/></dd></div>
      <div><dt>{ar?"مجمع الإهلاك":"Accumulated depreciation"}</dt><dd><Money value={policy.book.depreciation} currency={currency} organizationId={asset.organization_id}/></dd></div>
      <div><dt>{ar?"صافي القيمة الدفترية":"Net book value"}</dt><dd><Money value={policy.book.net} currency={currency} organizationId={asset.organization_id}/></dd></div>
      <div><dt>{ar?"التقييم السوقي":"Market valuation"}</dt><dd>{asset.current_market_price == null ? "—" : <Money value={asset.current_market_value} currency={currency} organizationId={asset.organization_id}/>}</dd></div>
    </dl>}
    {asset.current_market_price != null && <p className="muted">
      {ar?"سعر السوق للوحدة":"Market price per unit"} · <Money value={asset.current_market_price} currency={asset.current_valuation_currency ?? asset.currency} organizationId={asset.organization_id}/> · {asset.current_valuation_date ?? "—"} · {asset.current_valuation_source ?? "—"}
      {asset.current_valuation_auto && (ar?" · تلقائي":" · Automatic")}
    </p>}
    {failed && <p role="alert">{ar?"تعذّر تحميل صلاحيات التعديل.":"Unable to load edit permissions."}</p>}
    {policy?.asset_registration_can_edit && <ActionButton icon="edit" showLabel
      label={ar?"تعديل بيانات التسجيل":"Edit registration details"} onClick={()=>onEdit("registration")}/>}
    {reject && <p className="muted">{registrationLockText(reject, ar)} {reject.date && <bdi>{reject.date}</bdi>}{" "}
      {reject.code === "MOVEMENT" && reject.id && <Link href={`/${locale}/transactions?transaction_id=${reject.id}${asset.organization_id?"&scope=ORGANIZATION":""}`}>
        {reject.reference ?? (ar?"عرض الحركة":"View transaction")}
      </Link>}
      {reject.code === "LIFECYCLE" && reject.id && <ActionButton icon="history" label={ar?"عرض الحركة":"View transaction"}
        onClick={()=>onReview(reject.id!)}/>}
    </p>}
    {policy?.valuation_mode === "MANUAL" && <ActionButton icon="trend" showLabel
      label={ar?"تحديث السعر السوقي":"Update market price"} onClick={()=>onEdit("valuation")}/>}
    {policy?.valuation_mode === "AUTOMATIC" && <ActionButton icon="trend" showLabel disabled={refreshing}
      label={ar?"تحديث السعر من المصدر":"Refresh price from source"} onClick={()=>void refreshQuote()}/>}
    {refreshFailed && <p role="alert">{ar?"تعذّر تحديث السعر من المصدر.":"Unable to refresh the price from its source."}</p>}
  </div>;
}
