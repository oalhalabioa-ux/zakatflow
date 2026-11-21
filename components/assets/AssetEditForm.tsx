"use client";

import {useEffect, useRef, useState, type FormEvent} from "react";
import ActionButton from "@/components/ActionButton";

type EditableAsset = {
  id: string;
  name: string;
  asset_type: string;
  currency: string;
  updated_at: string;
  metadata?: {
    investment_id?: string;
    acquisition_mode?: string;
    market_price?: string | number;
    market_price_per_unit?: string | number;
    market_price_currency?: string;
  };
};

export function canEditAssetValuation(asset: EditableAsset) {
  return ["GOLD", "SILVER", "STOCK"].includes(asset.asset_type)
    && !asset.metadata?.investment_id && asset.metadata?.acquisition_mode !== "INVESTMENT";
}

export default function AssetEditForm({asset, ar, onClose, onSaved}: {
  asset: EditableAsset;
  ar: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = (arabic: string, english: string) => ar ? arabic : english;
  const title = useRef<HTMLHeadingElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const priceInput = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const [name, setName] = useState(asset.name);
  const savedPrice = asset.metadata?.market_price_per_unit ?? asset.metadata?.market_price;
  const [price, setPrice] = useState(savedPrice == null ? "" : String(savedPrice));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState<"name" | "price" | null>(null);
  const canValue = canEditAssetValuation(asset);
  const currency = asset.metadata?.market_price_currency || asset.currency;

  useEffect(() => {
    title.current?.focus({preventScroll: true});
    title.current?.scrollIntoView({block: "start"});
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    setError("");
    setInvalid(null);

    const submittedName = name.trim();
    if (submittedName.length < 1 || submittedName.length > 120) {
      setInvalid("name");
      setError(t("أدخل اسم الأصل من حرف إلى 120 حرفًا.", "Enter an asset name of 1 to 120 characters."));
      nameInput.current?.focus();
      return;
    }

    const priceChanged = canValue && price !== "" && (savedPrice == null || Number(price) !== Number(savedPrice));
    const invalidPrice = priceInput.current?.validity.badInput ||
      (canValue && savedPrice != null && price === "") ||
      (priceChanged && !/^\d+(\.\d{1,8})?$/.test(price));
    if (invalidPrice) {
      setInvalid("price");
      setError(t("أدخل سعرًا غير سالب بما لا يزيد على 8 منازل عشرية.", "Enter a non-negative price with up to 8 decimal places."));
      priceInput.current?.focus();
      return;
    }

    inFlight.current = true;
    setSaving(true);
    try {
      const response = await fetch("/api/assets", {
        method: "PUT",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({
          id: asset.id,
          expected_updated_at: asset.updated_at,
          name: submittedName,
          ...(priceChanged ? {market_price: Number(price)} : {}),
        }),
      });
      if (response.ok) {
        onSaved();
        return;
      }
      const result = await response.json().catch(() => ({}));
      const message = response.status === 409
        ? t("تغيّر الأصل أثناء التعديل. حدّث الصفحة وأعد المحاولة.", "The asset changed. Refresh the page and retry.")
        : response.status === 403
          ? t("ليس لديك صلاحية تعديل هذا الأصل.", "You do not have permission to edit this asset.")
          : t("تعذّر حفظ بيانات الأصل.", "Unable to save asset details.");
      setError(result.error ? `${message} (${result.error})` : message);
    } catch {
      setError(t("تعذّر الاتصال. حدّث الصفحة للتحقق من الحفظ قبل إعادة المحاولة.", "Connection failed. Refresh to verify the save before retrying."));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <section className="card section asset-entry" aria-labelledby="asset-entry-title">
      <div className="asset-entry-header">
        <div>
          <h3 id="asset-entry-title" ref={title} tabIndex={-1}>{t("تعديل بيانات الأصل", "Edit asset data")}</h3>
          <p>{canValue
            ? t("يمكن تعديل الاسم والسعر السوقي للوحدة.", "You can edit the name and market price per unit.")
            : t("يمكن تعديل اسم الأصل.", "You can edit the asset name.")}</p>
        </div>
        <ActionButton icon="close" label={t("إغلاق النموذج", "Close form")} disabled={saving} onClick={onClose}/>
      </div>
      <form noValidate onSubmit={save} aria-busy={saving}>
        <fieldset className="asset-entry-fields" disabled={saving}>
          <div className="form-grid">
            <label>
              {t("اسم الأصل", "Name")}
              <input ref={nameInput} required maxLength={120} aria-invalid={invalid === "name"}
                value={name} onChange={event => setName(event.target.value)}/>
            </label>
            {canValue && <label>
              {t("سعر السوق للوحدة", "Market price per unit")} ({currency})
              <input ref={priceInput} data-testid="asset-entry-market-unit" type="number" min="0" step="0.00000001"
                aria-invalid={invalid === "price"} value={price} onChange={event => setPrice(event.target.value)}/>
            </label>}
          </div>
        </fieldset>
        {error && <p role="alert" className="asset-entry-error">{error}</p>}
        <div className="asset-entry-footer">
          <ActionButton type="submit" icon="save" showLabel disabled={saving}
            label={saving ? t("جار الحفظ…", "Saving…") : t("حفظ التعديلات", "Save changes")}/>
          <ActionButton icon="close" label={t("إلغاء", "Cancel")} showLabel disabled={saving} onClick={onClose}/>
        </div>
      </form>
    </section>
  );
}
