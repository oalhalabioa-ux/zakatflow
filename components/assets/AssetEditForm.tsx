"use client";

import {useEffect, useRef, useState, type FormEvent} from "react";
import ActionButton from "@/components/ActionButton";
import {registrationLockText, type AssetEditMode} from "./AssetEditActions";

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
    market_value_auto?: boolean;
  };
};

export default function AssetEditForm({asset, mode, ar, onClose, onSaved}: {
  asset: EditableAsset;
  mode: AssetEditMode;
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
  const canValue = mode === "valuation";
  const currency = asset.metadata?.market_price_currency || asset.currency;
  const referenceQuote = asset.metadata?.market_value_auto === true && ["GOLD","SILVER"].includes(asset.asset_type);

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
    if (!canValue && (submittedName.length < 1 || submittedName.length > 120)) {
      setInvalid("name");
      setError(t("أدخل اسم الأصل من حرف إلى 120 حرفًا.", "Enter an asset name of 1 to 120 characters."));
      nameInput.current?.focus();
      return;
    }

    const invalidPrice = canValue &&
      (priceInput.current?.validity.badInput || !/^\d+(\.\d{1,8})?$/.test(price));
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
          ...(canValue ? {market_price: Number(price)} : {name: submittedName}),
        }),
      });
      if (response.ok) {
        onSaved();
        return;
      }
      const result = await response.json().catch(() => ({}));
      const message = result.error === "ASSET_REGISTRATION_LOCKED"
        ? registrationLockText(result.registration_lock, ar)
        : response.status === 409
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
          <h3 id="asset-entry-title" ref={title} tabIndex={-1}>{canValue ? t("تحديث السعر السوقي", "Update market price") : t("تعديل بيانات التسجيل", "Edit registration details")}</h3>
          <p>{canValue
            ? t("أدخل سعر السوق الحالي للوحدة بعملة التقييم.", "Enter the current market price per unit in the valuation currency.")
            : t("يمكن تعديل اسم الأصل.", "You can edit the asset name.")}</p>
        </div>
        <ActionButton icon="close" label={t("إغلاق النموذج", "Close form")} disabled={saving} onClick={onClose}/>
      </div>
      <form noValidate onSubmit={save} aria-busy={saving}>
        <fieldset className="asset-entry-fields" disabled={saving}>
          <div className="form-grid">
            {!canValue && <label>
              {t("اسم الأصل", "Name")}
              <input ref={nameInput} required maxLength={120} aria-invalid={invalid === "name"}
                value={name} onChange={event => setName(event.target.value)}/>
            </label>}
            {canValue && <label>
              {referenceQuote ? t("السعر المرجعي للغرام", "Reference price per gram") : t("سعر السوق للوحدة", "Market price per unit")} ({currency})
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
