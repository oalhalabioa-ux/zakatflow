"use client";
import { use, useEffect, useMemo, useState } from "react";
import {
  ASSET_COLUMNS,
  type AssetColumn,
  type AssetSortColumn,
  type AssetSortDirection,
  type AssetTablePreferences,
  assetCostValue,
  assetCurrentValue,
  assetHawlDate,
  assetTablePreset,
  parseAssetTablePreferences,
  sortAssetRows,
  visibleAssetColumns,
} from "@/lib/asset-table-preferences";
import { ASSET_DISPLAY_CLASSES, assetDisplayClass, assetTypeIcon, catalogDisplayClass } from "@/lib/asset-classification-display";
import AssetActionsMenu from "@/components/assets/AssetActionsMenu";
import AssetFinancialReview from "@/components/assets/AssetFinancialReview";
import AssetLifecyclePanel from "@/components/assets/AssetLifecyclePanel";
type T =
  | "CASH"
  | "BANK"
  | "GOLD"
  | "SILVER"
  | "STOCK"
  | "INVENTORY"
  | "RECEIVABLE"
  | "REAL_ESTATE"
  | "OTHER";
const TYPES: Array<[T, string, string, string]> = [
  ["CASH", "نقد", "Cash", "¤"],
  ["BANK", "حساب بنكي", "Bank", "▥"],
  ["GOLD", "ذهب", "Gold", "◆"],
  ["SILVER", "فضة", "Silver", "◇"],
  ["STOCK", "أسهم", "Stocks", "↗"],
  ["INVENTORY", "مخزون", "Inventory", "▦"],
  ["RECEIVABLE", "ذمم مدينة", "Receivable", "≡"],
  ["REAL_ESTATE", "عقار", "Real estate", "⌂"],
  ["OTHER", "أصل آخر", "Other", "•"],
];
type AssetsPageDesign = "executive" | "cards" | "analytical";
const empty: any = {
    currency:"SAR", fx_rate:"1", vat_amount:"0", recoverable_percent:"100", counterparty_id:"", invoice_reference:"", due_date:"",
    asset_type: "CASH",
    name: "",
    amount: "",
    quantity: "",
    purchase_price: "",
    market_price: "",
    karat: "24",
    purpose: "",
    holding_purpose:"",
    purchase_date: "",
    is_zakatable: true,
    ownership_scope: "",
    display_class: "",
    organization_id: null,
    entity_id: null,
    cost_center_id: null,
    asset_class_code: null,
    asset_type_code: null,
    acquisition_mode: "OPENING_BALANCE",
    funding_account_id: "",
  };
const fmt = (n: any) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
const daysFrom = (s?: string) =>
  s
    ? Math.max(
        0,
        Math.floor(
          (Date.now() - new Date(`${s}T00:00:00`).getTime()) / 86400000,
        ),
      )
    : 0;
const hawlParts = (s?: string) => {
  if (!s) return null;
  const d = daysFrom(s);
  return { cycles: Math.floor(d / 354), extra: d % 354 };
};
export default function Assets({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = use(params),
    ar = locale === "ar";
  const [rows, setRows] = useState<any[]>([]),
    [form, setForm] = useState<any>(empty),
    [edit, setEdit] = useState<string | null>(null),
    [formOpen,setFormOpen]=useState(false),
    [saving, setSaving] = useState(false),
    [requestId,setRequestId]=useState(""),
    [operationAsset,setOperationAsset]=useState<any>(null),
    [reviewEvent,setReviewEvent]=useState<{id:string;name:string}|null>(null),
    [msg, setMsg] = useState(""),
    [loadError, setLoadError] = useState(""),
    [loading, setLoading] = useState(true),
    [catalog, setCatalog] = useState<any>({ organizations: [], entities: [], cost_centers: [], classes: [], types: [], suppliers:[] }),
    [assetScope, setAssetScope] = useState<"PERSONAL"|"ORGANIZATION">("PERSONAL"),
    [usageMode, setUsageMode] = useState<"PERSONAL"|"ORGANIZATION"|"BOTH">("BOTH"),
    [usageOpen,setUsageOpen]=useState(false),
    [usageSaving,setUsageSaving]=useState(false),
    [classFilter,setClassFilter]=useState("ALL"),
    [typeFilter,setTypeFilter]=useState("ALL"),
    [scopeOrgId, setScopeOrgId] = useState(""),
    [scopeEntityId, setScopeEntityId] = useState(""),
    [scopeCostCenterId, setScopeCostCenterId] = useState(""),
    [closed, setClosed] = useState<Record<string, boolean>>({}),
    [tablePreferences, setTablePreferences] =
      useState<AssetTablePreferences>(() => assetTablePreset("professional")),
    [design, setDesign] = useState<AssetsPageDesign>("executive"),
    [lifecycleFilter, setLifecycleFilter] = useState<"ACTIVE"|"SOLD"|"DISPOSED"|"ALL">("ACTIVE"),
    [sort, setSort] = useState<{
      column: AssetSortColumn;
      direction: AssetSortDirection;
    }>({ column: "current", direction: "desc" });
  const baseCurrency=assetScope==="ORGANIZATION"?catalog.organizations.find((o:any)=>o.id===scopeOrgId)?.base_currency||"SAR":catalog.base_currency||"SAR";
  const cur = baseCurrency, cv = (n: any) => Number(n || 0);
  const load = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/assets");
      if (!response.ok) throw new Error("LOAD_FAILED");
      setRows(await response.json());
      const catalogResponse = await fetch("/api/assets/catalog");
      if (catalogResponse.ok) setCatalog(await catalogResponse.json());
      const preferenceResponse=await fetch("/api/assets/preferences");
      if(preferenceResponse.ok){const preference=await preferenceResponse.json();setUsageMode(preference.asset_usage_mode);if(preference.asset_usage_mode!=="BOTH")setAssetScope(preference.asset_usage_mode);}
    } catch {
      setRows([]);
      setLoadError(
        ar ? "تعذر تحميل الأصول. حاول تحديث الصفحة." : "Could not load assets. Refresh the page to try again.",
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    try {
      const storedPreferences =
        localStorage.getItem("zf_asset_table_v4") ||
        localStorage.getItem("zf_asset_table_v3") ||
        localStorage.getItem("zf_asset_table_v2");
      setTablePreferences(parseAssetTablePreferences(storedPreferences));
      const savedDesign =
        localStorage.getItem("zf_assets_design_v2") ||
        localStorage.getItem("zf_assets_design");
      if (["executive", "cards", "analytical"].includes(savedDesign || ""))
        setDesign(savedDesign as AssetsPageDesign);
      const savedScope = localStorage.getItem("zf-assets-scope");
      if (savedScope === "ORGANIZATION" || savedScope === "PERSONAL") setAssetScope(savedScope);
      setScopeOrgId(localStorage.getItem("zf-assets-scope-org") || "");
      setScopeEntityId(localStorage.getItem("zf-assets-scope-entity") || "");
      setScopeCostCenterId(localStorage.getItem("zf-assets-scope-cost-center") || "");
    } catch {}
    const onSettings = (event: Event) => {
      const detail = (event as CustomEvent<AssetTablePreferences>).detail;
      setTablePreferences(parseAssetTablePreferences(JSON.stringify(detail)));
    };
    const onDesign = (event: Event) => {
      const next = (event as CustomEvent<{ design: AssetsPageDesign }>).detail
        ?.design;
      if (next && ["executive", "cards", "analytical"].includes(next))
        setDesign(next);
    };
    window.addEventListener("zf-asset-table-settings", onSettings);
    window.addEventListener("zf-assets-page-design", onDesign);
    return () => {
      window.removeEventListener("zf-asset-table-settings", onSettings);
      window.removeEventListener("zf-assets-page-design", onDesign);
    };
  }, []);
  useEffect(() => {
    if (!catalog.organizations.length || scopeOrgId) return;
    const preferred = catalog.organizations.find((o:any) => o.organization_kind === "HOLDING") || catalog.organizations[0];
    if (preferred) setScopeOrgId(preferred.id);
  }, [catalog.organizations, scopeOrgId]);
  useEffect(() => {
    try {
      localStorage.setItem("zf-assets-scope", assetScope);
      localStorage.setItem("zf-assets-scope-org", scopeOrgId);
      localStorage.setItem("zf-assets-scope-entity", scopeEntityId);
      localStorage.setItem("zf-assets-scope-cost-center", scopeCostCenterId);
    } catch {}
  }, [assetScope, scopeOrgId, scopeEntityId, scopeCostCenterId]);
  const saveUsage=async(next:"PERSONAL"|"ORGANIZATION"|"BOTH")=>{
    setUsageSaving(true);
    try{const r=await fetch("/api/assets/preferences",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({asset_usage_mode:next})});if(!r.ok)throw new Error();setUsageMode(next);if(next!=="BOTH")setAssetScope(next);setMsg(ar?"تم حفظ إعداد الاستخدام؛ ملكية الأصول لم تتغير.":"Usage saved; asset ownership is unchanged.");}catch{setMsg(ar?"تعذر حفظ إعداد الاستخدام":"Could not save usage preference");}finally{setUsageSaving(false);}
  };
  const orderedColumns = useMemo(
    () => visibleAssetColumns(tablePreferences.order, tablePreferences.visible),
    [tablePreferences.order, tablePreferences.visible],
  );
  const m = (r: any, k: string) => Number(r?.metadata?.[k] || 0),
    val = assetCurrentValue,
    costVal = assetCostValue;
  const calc = (r: any) => r.zakat_calculation || null,
    due = (r: any) => Number(calc(r)?.zakat_amount || 0),
    paid = (r: any) => Number(calc(r)?.paid_amount || 0),
    remaining = (r: any) => Math.max(0, due(r) - paid(r));
  const hawlStart = (r: any) =>
    calc(r)
      ?.lots?.map((x: any) => x.hawl_start_date)
      .filter(Boolean)
      .sort()?.[0];
  const lotHawlStart = (r: any) =>
    r?.lots
      ?.map((x: any) => x.hawl_start_date)
      .filter(Boolean)
      .sort()?.[0];
  const hawlDisplayDate = (r: any) => assetHawlDate(r) || undefined;
  const metal = form.asset_type === "GOLD" || form.asset_type === "SILVER",
    market = metal || form.asset_type === "STOCK",
    qty = market || form.asset_type === "INVENTORY";
  const pc = qty
      ? (+form.quantity || 0) * (+form.purchase_price || 0)
      : +form.amount || 0,
    mv = market ? (+form.quantity || 0) * (+form.market_price || 0) : pc;
  const scopedRows = useMemo(() => rows.filter((r:any) => {
    const ownership = r.ownership_scope || (r.organization_id ? "ORGANIZATION" : "PERSONAL");
    if (assetScope === "PERSONAL") return ownership === "PERSONAL" && !r.organization_id;
    if (ownership !== "ORGANIZATION" || r.organization_id !== scopeOrgId) return false;
    if (scopeEntityId && r.entity_id !== scopeEntityId) return false;
    if (scopeCostCenterId && r.cost_center_id !== scopeCostCenterId) return false;
    return true;
  }), [rows, assetScope, scopeOrgId, scopeEntityId, scopeCostCenterId]);
  const filteredRows = useMemo(() => lifecycleFilter === "ALL" ? scopedRows : scopedRows.filter((r) => (r.lifecycle_status || "ACTIVE") === lifecycleFilter), [scopedRows,lifecycleFilter]);
  const lifecycleCounts = useMemo(() => ({ACTIVE:scopedRows.filter(r=>(r.lifecycle_status||"ACTIVE")==="ACTIVE").length,SOLD:scopedRows.filter(r=>r.lifecycle_status==="SOLD").length,DISPOSED:scopedRows.filter(r=>r.lifecycle_status==="DISPOSED").length,ALL:scopedRows.length}),[scopedRows]);
  const displayRows=useMemo(()=>filteredRows.filter(r=>(classFilter==="ALL"||assetDisplayClass(r)===classFilter)&&(typeFilter==="ALL"||(r.asset_type_code||r.asset_type)===typeFilter)),[filteredRows,classFilter,typeFilter]);
  const groups=useMemo(()=>ASSET_DISPLAY_CLASSES.map(([type,nameAr,nameEn,symbol])=>({type,title:ar?nameAr:nameEn,symbol,rows:displayRows.filter(r=>assetDisplayClass(r)===type)})).filter(g=>g.rows.length),[displayRows,ar]);
  const typeName=(r:any)=>{const t=catalog.types.find((x:any)=>x.code===r.asset_type_code);return t?(ar?t.name_ar:t.name_en):TYPES.find(x=>x[0]===r.asset_type)?.[ar?1:2]||r.asset_type;};
  const activeRows=scopedRows.filter(r=>(r.lifecycle_status||"ACTIVE")==="ACTIVE");
  const total = activeRows.reduce((s, r) => s + val(r), 0),
    cost = activeRows.reduce((s, r) => s + Number(r.current_cost_value||0), 0),
    totalDue = scopedRows.reduce((s, r) => s + due(r), 0),
    totalPaid = scopedRows.reduce((s, r) => s + paid(r), 0),
    z = scopedRows.filter((r) => r.is_zakatable),
    completed = z.filter((r) => (calc(r)?.statuses || []).includes("ELIGIBLE")),
    near = z.filter((r) => {
      const d = calc(r)
        ?.lots?.map((x: any) => x.hawl_due_date)
        .filter(Boolean)
        .sort()?.[0];
      if (!d) return false;
      const n = Math.ceil(
        (new Date(`${d}T00:00:00`).getTime() - Date.now()) / 86400000,
      );
      return n >= 0 && n <= 30;
    });
  const info = (t: string) => TYPES.find((x) => x[0] === t),
    label = (t: string) => info(t)?.[ar ? 1 : 2] || t,
    icon = (t: string) => info(t)?.[3] || "💼";
  const retroPending = scopedRows.filter(
    (r) =>
      r.is_zakatable &&
      (calc(r)?.statuses || []).includes("NOT_ASSESSED") &&
      (calc(r)?.lots || []).some((l: any) => l.hawl_start_date),
  );
  const indicatorValue = (value: string) =>
    loading ? "…" : loadError ? "—" : value;
  const indicatorSource = (source: string) =>
    loading
      ? ar
        ? "جارٍ التحديث"
        : "Updating"
      : loadError
        ? ar
          ? "البيانات غير متاحة"
          : "Data unavailable"
        : source;
  const editRow = (r: any) => {
    const d = r.metadata || {};
    setEdit(r.id);setFormOpen(true);
    const rowScope = r.ownership_scope || (r.organization_id ? "ORGANIZATION" : "PERSONAL");
    setAssetScope(rowScope);
    setScopeOrgId(r.organization_id || "");
    setScopeEntityId(r.entity_id || "");
    setScopeCostCenterId(r.cost_center_id || "");
    setForm({
      asset_type: r.asset_type,
      display_class: assetDisplayClass(r),
      name: r.name,
      amount: d.opening_value ?? d.purchase_value ?? "",
      fx_rate:d.fx_rate??1,vat_amount:d.vat_amount??0,recoverable_percent:d.recoverable_percent??100,counterparty_id:d.counterparty_id??"",invoice_reference:d.invoice_reference??"",due_date:d.due_date??"",
      metadata: d, currency: r.currency, unit:r.unit, expected_updated_at:r.updated_at,
      has_financial_history:r.has_financial_history,
      acquisition_mode:d.acquisition_mode??"OPENING_BALANCE",
      quantity: d.quantity ?? "",
      purchase_price: d.purchase_price ?? "",
      market_price: d.market_price_per_unit ?? d.market_price ?? "",
      karat: d.karat ?? 24,
      purpose: d.purpose ?? "",
      holding_purpose:d.holding_purpose??"",
      purchase_date: d.purchase_date ?? "",
      is_zakatable: r.is_zakatable,
      ownership_scope: r.ownership_scope || "PERSONAL",
      organization_id: r.organization_id ?? null,
      entity_id: r.entity_id ?? null,
      cost_center_id: r.cost_center_id ?? null,
      asset_class_code: r.asset_class_code ?? null,
      asset_type_code: r.asset_type_code ?? null,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const columnLabel = (column: AssetColumn) => {
    const definition = ASSET_COLUMNS.find(([key]) => key === column)!;
    return ar ? definition[1] : definition[2];
  };
  const changeSort = (column: AssetSortColumn) => {
    setSort((current) => ({
      column,
      direction:
        current.column === column && current.direction === "asc"
          ? "desc"
          : "asc",
    }));
  };
  const sortMark = (column: AssetSortColumn) =>
    sort.column === column ? (sort.direction === "asc" ? "↑" : "↓") : "↕";
  const renderAssetCell = (column: AssetColumn, row: any) => {
    switch (column) {
      case "asset":
        return (
          <strong className="asset-name-cell">
            <span className="asset-row-icon" aria-hidden="true">
              {assetTypeIcon(row.asset_type_code||row.asset_type)}
            </span>
            {row.name}
            <span className="pill asset-detail-type">{typeName(row)}</span>
            {assetDisplayClass(row)==="UNCLASSIFIED"&&<small className="muted">{ar?"استكمال التصنيف":"Awaiting classification"}</small>}
            {row.lifecycle_status==="SOLD" && <span className="pill" style={{marginInlineStart:8}}>{ar?"مباع":"Sold"}</span>}
            {row.lifecycle_status==="DISPOSED" && <span className="pill" style={{marginInlineStart:8}}>{ar?"مستغنى عنه":"Disposed"}</span>}
          </strong>
        );
      case "date":
        return row.lifecycle_status!=="ACTIVE" && row.lifecycle_exit_date ? `${row.metadata?.purchase_date || "—"} → ${row.lifecycle_exit_date}` : row.metadata?.purchase_date || "—";
      case "weight":
        return ["GOLD", "SILVER"].includes(row.asset_type)
          ? `${fmt(row.current_quantity??m(row, "quantity"))} g`
          : (row.current_quantity??m(row, "quantity"))
            ? fmt(row.current_quantity??m(row, "quantity"))
            : "—";
      case "hawl":
        return (
          <HawlBadge
            date={hawlDisplayDate(row)}
            ar={ar}
            displayOnly={
              !hawlStart(row) &&
              !lotHawlStart(row) &&
              Boolean(
                calc(row)?.hawl_display_only?.portfolio_nisab_reached_date,
              )
            }
          />
        );
      case "cost":
        return `${fmt(cv(costVal(row)))} ${cur}`;
      case "current":
        return <strong>{fmt(cv(val(row)))} {cur}</strong>;
      case "due":
        return `${fmt(cv(due(row)))} ${cur}`;
      case "paid":
        return `${fmt(cv(paid(row)))} ${cur}`;
      case "remaining":
        return `${fmt(cv(remaining(row)))} ${cur}`;
      case "calculation":
        return (
          <ZakatCell
            row={row}
            ar={ar}
            amount={`${fmt(cv(due(row)))} ${cur}`}
          />
        );
      case "action":
        return <AssetActionsMenu name={row.name} ar={ar}>{close=><>
          <button type="button" onClick={()=>{close();editRow(row);}}><span aria-hidden="true">✎</span> {ar?"تعديل الأصل":"Edit asset"}</button>
          {row.current_quantity>0&&(row.ownership_scope==="ORGANIZATION"?<button type="button" onClick={()=>{close();setOperationAsset(row);}}><span aria-hidden="true">⚙</span> {ar?"إهلاك / بيع / استبعاد":"Depreciation / sale / disposal"}</button>:<a href={`/${locale}/transactions`} onClick={close}><span aria-hidden="true">↗</span> {ar?"بيع / استبعاد":"Sale / disposal"}</a>)}
          {(row.financial_review_events||[]).map((e:any,index:number)=><button type="button" key={e.id} onClick={()=>{close();setReviewEvent({id:e.id,name:row.name});}}><span aria-hidden="true">✓</span> {ar?"المراجعة المالية":"Financial review"}{row.financial_review_events.length>1?` (${index+1})`:""}</button>)}
        </>}</AssetActionsMenu>;

    }
  };
  const save = async () => {
    if (!form.name || !form.purchase_date) {
      setMsg(ar ? "أدخل الاسم وتاريخ الشراء" : "Enter name and purchase date");
      return;
    }
    if(!["PERSONAL","ORGANIZATION"].includes(form.ownership_scope)){setMsg(ar?"اختر ملكية الأصل الجديد":"Choose ownership for the new asset");return;}
    if((!edit||form.classification_changed)&&!form.asset_type_code){setMsg(ar?"اختر فئة الأصل ونوعه":"Choose asset class and type");return;}
    if (form.ownership_scope === "ORGANIZATION" && !form.organization_id) {
      setMsg(ar ? "اختر المؤسسة المالكة للأصل" : "Choose the organization that owns the asset");
      return;
    }
    if (!edit && form.ownership_scope === "PERSONAL" && form.acquisition_mode === "PURCHASE" && !form.funding_account_id) {
      setMsg(ar ? "اختر حساب النقد أو البنك الشخصي المستخدم في الشراء" : "Choose the personal cash or bank account used for the purchase");
      return;
    }
    if (!!form.asset_class_code !== !!form.asset_type_code) {
      setMsg(ar ? "اختر فئة الأصل ونوعه معًا" : "Choose both asset class and asset type");
      return;
    }
    const selectedV2Type = catalog.types.find((x:any) => x.code === form.asset_type_code);
    const compatibleLegacyType = selectedV2Type?.default_legacy_asset_type || form.asset_type;
    const nextRequestId=requestId||crypto.randomUUID();if(!edit&&!requestId)setRequestId(nextRequestId);
    setSaving(true);
    const metadata: any = {
      ...(edit ? form.metadata ?? {} : {}),
      fx_rate:Number(form.fx_rate),vat_amount:Number(form.vat_amount||0),recoverable_percent:Number(form.recoverable_percent??100),counterparty_id:form.counterparty_id||null,invoice_reference:form.invoice_reference||null,due_date:form.due_date||null,
      purchase_value: pc,
      market_value: mv,
      estimated_value: mv,
      purchase_date: form.purchase_date,
      ...(!edit && form.ownership_scope === "PERSONAL" && form.acquisition_mode === "PURCHASE" ? {funding_account_id:form.funding_account_id}:{}),
    };
    if (form.amount) metadata.opening_value = +form.amount;
    if (form.quantity) metadata.quantity = +form.quantity;
    if (form.purchase_price) metadata.purchase_price = +form.purchase_price;
    if (form.market_price) metadata.market_price = +form.market_price;
    if (metal) metadata.karat = +form.karat;
    if (form.purpose) metadata.purpose = form.purpose;
    if(form.holding_purpose)metadata.holding_purpose=form.holding_purpose;
    if(edit){
      for(const key of ["market_value","estimated_value"]) {
        if(form.metadata?.[key]===undefined)delete metadata[key];else metadata[key]=form.metadata[key];
      }
      if(market && Number(form.market_price)!==Number(form.metadata?.market_price_per_unit??form.metadata?.market_price??0)) {
        metadata.market_price_per_unit=Number(form.market_price);metadata.market_value=mv;metadata.estimated_value=mv;
        metadata.market_price_source="USER_MANUAL";metadata.market_valuation_date=new Date().toISOString().slice(0,10);metadata.market_value_auto=false;metadata.market_price_currency=form.currency;
      }
    }
    if(edit && form.has_financial_history) for(const key of ["quantity","purchase_value","opening_value","purchase_price","karat","purity","purchase_date","acquisition_mode","funding_account_id","fx_rate","vat_amount","recoverable_percent","counterparty_id","invoice_reference","due_date"]) {
      if(form.metadata?.[key]===undefined)delete metadata[key];else metadata[key]=form.metadata[key];
    }
    const body = {
      ...(edit ? { id: edit } : {}),
      asset_type: compatibleLegacyType,
      name: form.name,
      currency: form.currency,
      ...(!edit?{request_id:nextRequestId}:{}),
      ...(edit ? {expected_updated_at:form.expected_updated_at}:{}),
      unit: edit ? form.unit : metal ? "g" : form.asset_type === "STOCK" ? "share" : "unit",
      is_zakatable: form.is_zakatable,
      ownership_scope: form.ownership_scope || "PERSONAL",
      organization_id: form.ownership_scope === "ORGANIZATION" ? form.organization_id : null,
      entity_id: form.ownership_scope === "ORGANIZATION" ? form.entity_id : null,
      cost_center_id: form.ownership_scope === "ORGANIZATION" ? form.cost_center_id : null,
      asset_class_code: form.asset_class_code || null,
      asset_type_code: form.asset_type_code || null,
      metadata: edit ? metadata : {...metadata,acquisition_mode:form.acquisition_mode||"OPENING_BALANCE"},
    };
    try {
    const r = await fetch("/api/assets", {
      method: edit ? "PUT" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      setForm({...empty});
      setEdit(null);setRequestId("");setFormOpen(false);
      setMsg(
        ar
          ? `تم الحفظ في الأصول ${body.ownership_scope==="PERSONAL"?"الشخصية":"المؤسسية"} — أنشئ احتسابًا جديدًا لتحديث الزكاة`
          : "Saved — create a new Snapshot to refresh Zakat calculation",
      );
      await load();
    } else {
      const result = await r.json().catch(() => ({}));
      setMsg(result.error==='ASSET_FINANCIAL_FIELDS_LOCKED' ? (ar ? "بيانات الاقتناء مرتبطة بحركات مالية؛ صححها من سجل المعاملات بعكس الحركة وتسجيل الصحيحة." : "Acquisition is linked to financial movements. Correct it through the transaction ledger.") : result.error==='ASSET_EDIT_CONFLICT' ? (ar ? "تغير الأصل أثناء التعديل. حدّث الصفحة وأعد المحاولة." : "The asset changed. Refresh and retry.") : result.error || (ar ? "تعذر الحفظ" : "Save failed"));
    }
    } catch {setMsg(ar ? "تعذر الاتصال؛ حدّث البيانات قبل إعادة المحاولة." : "Connection failed. Refresh before retrying.");} finally {setSaving(false);}
  };
  return (
    <main className={`container assets-page assets-page-${design}`}>
      <style>{`.asset-detail-type{font-size:11px;margin-inline-start:8px}.asset-owner-switch{display:flex;gap:6px;flex-wrap:wrap}.asset-scope-bar{display:grid;grid-template-columns:minmax(180px,.8fr) minmax(220px,1.2fr) minmax(200px,1fr) minmax(200px,1fr);gap:12px;align-items:end;padding:16px 18px}.asset-scope-bar label{display:grid;gap:6px;font-size:12px;font-weight:700}.asset-scope-bar select{width:100%}.asset-scope-title{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:12px}.asset-scope-title strong{font-size:14px}.asset-scope-title span{font-size:11px;color:var(--muted)}@media(max-width:900px){.asset-scope-bar{grid-template-columns:1fr 1fr}}@media(max-width:620px){.asset-scope-bar{grid-template-columns:1fr}}.asset-report-table[data-size=compact] th,.asset-report-table[data-size=compact] td{padding:7px 8px;font-size:11px}.asset-report-table[data-size=normal] th,.asset-report-table[data-size=normal] td{padding:12px;font-size:13px}.asset-report-table[data-size=wide] th,.asset-report-table[data-size=wide] td{padding:17px 20px;font-size:14px}.asset-report-table th{min-width:105px;white-space:nowrap}.asset-report-table th[data-column=asset]{min-width:180px}.hawl-badges{display:inline-flex;gap:5px;white-space:nowrap}.hawl-cycle,.hawl-days{display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border-radius:8px}.hawl-cycle{background:#dcfce7;color:#166534}.hawl-days{background:#fce7f3;color:#9d174d}.zakat-formula{margin-top:10px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:#fafcfb;color:var(--ink);min-width:280px}.zakat-formula-title{font-weight:700;margin-bottom:5px}.zakat-formula-eq{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;direction:ltr;text-align:left;white-space:normal;line-height:1.7}.zakat-formula-result{font-weight:800;margin-top:5px}`}</style>
      <div className="page-head">
        <div>
          <h1>
            <span className="page-title-icon" aria-hidden="true">
              ▥
            </span>{" "}
            {ar ? "الأصول" : "Assets"}
          </h1>
          <p className="muted">
            {ar
              ? "الزكاة والحول أدناه من آخر Snapshot لمحرك الاحتساب، وليست من القيم القديمة المخزنة في الأصل."
              : "Zakat and Hawl below come from the latest engine Snapshot, not legacy asset metadata."}
          </p>
        </div>
        <span className="pill">{ar?"عملة الأساس: ":"Base currency: "}{baseCurrency}</span>
      </div>
      <div className="page-head"><button type="button" className="btn" onClick={()=>setFormOpen(true)}>{ar?"＋ إضافة أصل":"＋ Add asset"}</button><button type="button" className="btn secondary" onClick={()=>setUsageOpen(!usageOpen)}>{ar?"⚙ إعداد الاستخدام":"⚙ Usage settings"}</button></div>
      {usageOpen&&<section className="card section"><label>{ar?"استخدام مساحة العمل للأصول":"Asset workspace usage"}<select value={usageMode} disabled={loading||usageSaving} onChange={e=>void saveUsage(e.target.value as typeof usageMode)}><option value="BOTH">{ar?"شخصي ومؤسسي":"Personal and organization"}</option><option value="PERSONAL">{ar?"شخصي فقط":"Personal only"}</option><option value="ORGANIZATION">{ar?"مؤسسي فقط":"Organization only"}</option></select></label><p className="muted">{ar?"هذا إعداد للعرض فقط. يمكن العودة إلى النطاق الآخر من هنا؛ لا ينقل ملكية الأصول ولا يغيّر أرصدتها.":"Display preference only. Switch back here; ownership and balances are unchanged."}</p></section>}
      <section className="card section asset-scope-bar">
        <div className="asset-scope-title">
          <strong>{ar ? "عرض الأصول" : "Asset view"}</strong>
          <span>{ar ? "يُطبّق على المؤشرات والتقرير فقط" : "Applies to KPIs and report only"}</span>
        </div>
        {usageMode==="BOTH"?<div className="asset-owner-switch" role="group" aria-label={ar?"نطاق عرض الأصول":"Asset view scope"}>{([["PERSONAL",ar?"♙ شخصي":"♙ Personal"],["ORGANIZATION",ar?"▥ مؤسسي":"▥ Organization"]] as const).map(([key,text])=><button key={key} type="button" className={`btn ${assetScope===key?"":"secondary"}`} aria-pressed={assetScope===key} onClick={()=>{setAssetScope(key);setScopeEntityId("");setScopeCostCenterId("");setClassFilter("ALL");setTypeFilter("ALL");}}>{text}</button>)}</div>:<strong>{usageMode==="PERSONAL"?(ar?"♙ شخصي":"♙ Personal"):(ar?"▥ مؤسسي":"▥ Organization")}</strong>}
        {assetScope === "ORGANIZATION" && <>
          <label>
            {ar ? "الشركة / المؤسسة" : "Organization"}
            <select value={scopeOrgId} onChange={(e)=>{setScopeOrgId(e.target.value);setScopeEntityId("");setScopeCostCenterId("");}}>
              <option value="">{ar ? "اختر الشركة" : "Choose organization"}</option>
              {catalog.organizations.map((o:any)=><option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
          <label>
            {ar ? "الفرع / الكيان" : "Entity"}
            <select value={scopeEntityId} onChange={(e)=>setScopeEntityId(e.target.value)}>
              <option value="">{ar ? "كل الفروع / الجهة الرئيسية" : "All entities / main organization"}</option>
              {catalog.entities.filter((x:any)=>x.organization_id===scopeOrgId).map((x:any)=><option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
          <label>
            {ar ? "مركز التكلفة" : "Cost center"}
            <select value={scopeCostCenterId} onChange={(e)=>setScopeCostCenterId(e.target.value)}>
              <option value="">{ar ? "كل مراكز التكلفة" : "All cost centers"}</option>
              {catalog.cost_centers.filter((x:any)=>x.organization_id===scopeOrgId).map((x:any)=><option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
        </>}
      </section>
      {loadError && <div className="notice">{loadError}</div>}
      {retroPending.length > 0 && (
        <div className="notice">
          <strong>
            {ar ? "أصول تحتاج إعادة احتساب" : "Assets awaiting recalculation"}
          </strong>
          <div className="muted">
            {ar
              ? `${retroPending.length} أصل/أصول لها حول محفوظ لكنها غير موجودة في آخر Snapshot. إعادة احتساب الدورة الحالية ستضمها دون تعديل Snapshot مغلق.`
              : `${retroPending.length} asset(s) have persisted Hawl data but are missing from the latest Snapshot. Recalculating the current cycle will include them without changing closed snapshots.`}
          </div>
        </div>
      )}
      <section className="grid section">
        <K
          i="◆"
          tone="value"
          t={ar ? "القيمة الحالية" : "Current value"}
          v={indicatorValue(`${fmt(cv(total))} ${cur}`)}
          source={indicatorSource(ar ? "سجل التقييم" : "Valuation ledger")}
        />
        <K
          i="▤"
          tone="cost"
          t={ar ? "تكلفة الشراء" : "Purchase cost"}
          v={indicatorValue(`${fmt(cv(cost))} ${cur}`)}
          source={indicatorSource(ar ? "سجل الأصول" : "Asset ledger")}
        />
        <K
          i="↗"
          tone="gain"
          t={ar ? "فرق التقييم الحالي" : "Current valuation difference"}
          v={indicatorValue(`${fmt(cv(total - cost))} ${cur}`)}
          source={indicatorSource(ar ? "محسوب مباشرة" : "Live calculation")}
        />
        <K
          i="◉"
          tone="due"
          t={ar ? "الزكاة المحتسبة" : "Calculated Zakat"}
          v={indicatorValue(`${fmt(cv(totalDue))} ${cur}`)}
          source={indicatorSource(ar ? "آخر Snapshot" : "Latest Snapshot")}
        />
        <K
          i="✓"
          tone="paid"
          t={ar ? "مدفوع الاحتساب المعروض" : "Displayed assessment paid"}
          v={indicatorValue(`${fmt(cv(totalPaid))} ${cur}`)}
          source={indicatorSource(ar ? "الدورة نفسها فقط" : "Same cycle only")}
        />
        <K
          i="▦"
          tone="count"
          t={ar ? "عدد الأصول" : "Assets"}
          v={indicatorValue(`${activeRows.length}`)}
          source={indicatorSource(ar ? "السجل الفعلي" : "Live ledger")}
        />
        <K
          i="◷"
          tone="hawl"
          t={ar ? "مؤهل بالحول" : "Hawl eligible"}
          v={indicatorValue(`${completed.length}`)}
          source={indicatorSource(ar ? "آخر Snapshot" : "Latest Snapshot")}
        />
        <K
          i="!"
          tone="due"
          t={ar ? "استحقاق خلال 30 يوماً" : "Due within 30 days"}
          v={indicatorValue(`${near.length}`)}
          source={indicatorSource(ar ? "تواريخ الحول" : "Hawl dates")}
        />
      </section>
      {reviewEvent&&<section className="card section"><div className="page-head"><h3>{reviewEvent.name}</h3><button type="button" className="btn secondary" onClick={()=>setReviewEvent(null)}>{ar?"إغلاق المراجعة":"Close review"}</button></div><AssetFinancialReview key={reviewEvent.id} eventId={reviewEvent.id} ar={ar} onChanged={()=>void load()} initialOpen/></section>}
      {operationAsset&&<AssetLifecyclePanel key={operationAsset.id} asset={operationAsset} locale={locale} counterparties={catalog.counterparties||[]} onClose={()=>setOperationAsset(null)} onSaved={()=>void load()}/>}
      {formOpen&&<section className="card section">
        <h3>
          {edit ? "✏️ " : "＋ "}
          {edit
            ? ar
              ? "تعديل الأصل"
              : "Edit asset"
            : ar
              ? "إضافة أصل"
              : "Add asset"}
        </h3>
        {edit && form.has_financial_history && <p className="muted">{ar ? "بيانات الاقتناء محمية لارتباطها بحركات. يمكن تعديل الاسم والتقييم الحالي؛ التصحيح المالي من سجل المعاملات. الاحتسابات السابقة تحتفظ بأسعارها." : "Acquisition data is protected. Edit the name or current valuation; correct financial data in the transaction ledger. Previous assessments retain their prices."}</p>}
        <div className="form-grid">
          <label>{ar?"ملكية الأصل":"Asset ownership"}<select disabled={Boolean(edit)} value={form.ownership_scope} onChange={e=>setForm({...form,ownership_scope:e.target.value,organization_id:null,entity_id:null,cost_center_id:null,counterparty_id:"",funding_account_id:"",currency:catalog.base_currency||"SAR",fx_rate:"1"})}><option value="">{ar?"اختر المالك":"Choose owner"}</option><option value="PERSONAL">{ar?"♙ شخصي — باسمي":"♙ Personal — owned by me"}</option><option value="ORGANIZATION">{ar?"▥ مؤسسي — باسم شركة":"▥ Organization — company owned"}</option></select></label>
          {form.ownership_scope==="ORGANIZATION"&&<>
            <label>{ar?"الشركة المالكة":"Owning organization"}<select disabled={Boolean(edit)} value={form.organization_id||""} onChange={e=>{const org=catalog.organizations.find((o:any)=>o.id===e.target.value);setForm({...form,organization_id:e.target.value||null,entity_id:null,cost_center_id:null,counterparty_id:"",currency:org?.base_currency||"SAR",fx_rate:"1"});}}><option value="">{ar?"اختر الشركة المالكة":"Choose owning organization"}</option>{catalog.organizations.map((o:any)=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
            <label>{ar?"الفرع المالك":"Owning entity"}<select disabled={Boolean(edit)} value={form.entity_id||""} onChange={e=>setForm({...form,entity_id:e.target.value||null,cost_center_id:null})}><option value="">{ar?"الجهة الرئيسية":"Main organization"}</option>{catalog.entities.filter((x:any)=>x.organization_id===form.organization_id).map((x:any)=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <label>{ar?"مركز تكلفة الأصل":"Asset cost center"}<select disabled={Boolean(edit)} value={form.cost_center_id||""} onChange={e=>setForm({...form,cost_center_id:e.target.value||null})}><option value="">{ar?"غير محدد":"Not specified"}</option>{catalog.cost_centers.filter((x:any)=>x.organization_id===form.organization_id).map((x:any)=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          </>}
          {!edit && <label>
            {ar ? "طريقة الاقتناء" : "Acquisition"}
            <select value={form.acquisition_mode || "OPENING_BALANCE"} onChange={(e)=>setForm({...form,acquisition_mode:e.target.value,funding_account_id:""})}>
              <option value="OPENING_BALANCE">{ar ? "رصيد افتتاحي / أصل موجود" : "Opening balance / existing asset"}</option>
              <option value="PURCHASE">{ar ? "شراء أصل جديد" : "Purchase new asset"}</option>
            </select>
          </label>}
          {!edit && form.ownership_scope === "PERSONAL" && form.acquisition_mode === "PURCHASE" && <label>
            {ar ? "الدفع من الحساب الشخصي" : "Pay from personal account"}
            <select value={form.funding_account_id || ""} onChange={(e)=>setForm({...form,funding_account_id:e.target.value})}>
              <option value="">{ar ? "اختر حساب النقد / البنك" : "Choose cash / bank account"}</option>
              {rows.filter((x:any)=>!x.organization_id && (!x.ownership_scope || x.ownership_scope==="PERSONAL") && ["CASH","BANK"].includes(x.asset_type)).map((x:any)=><option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>}
          <label>{ar?"عملة الأصل":"Asset currency"}<select disabled={Boolean(edit&&form.has_financial_history)} value={form.currency} onChange={e=>setForm({...form,currency:e.target.value,fx_rate:"",funding_account_id:""})}>{["SAR","USD","AED","EUR","GBP","KWD","BHD","QAR","OMR","JOD","EGP"].map(c=><option key={c}>{c}</option>)}</select></label>
          <label>{ar?"سعر الصرف إلى عملة الأساس بتاريخ الاقتناء":"Acquisition exchange rate to base currency"}<input type="number" min="0.00000001" step="any" disabled={Boolean(edit&&form.has_financial_history)} value={form.fx_rate} onChange={e=>setForm({...form,fx_rate:e.target.value})}/><small>{ar?"الأساس: ":"Base: "}{form.ownership_scope==="ORGANIZATION"?catalog.organizations.find((o:any)=>o.id===form.organization_id)?.base_currency||"SAR":catalog.base_currency||"SAR"}</small></label>
          {!edit&&form.acquisition_mode==="PURCHASE"&&form.ownership_scope==="ORGANIZATION"&&<>
            <label>{ar?"المورد":"Supplier"}<select value={form.counterparty_id} onChange={e=>setForm({...form,counterparty_id:e.target.value})}><option value="">{ar?"اختر المورد":"Choose supplier"}</option>{(catalog.suppliers||[]).filter((x:any)=>x.organization_id===form.organization_id&&["SUPPLIER","BOTH"].includes(x.party_type)).map((x:any)=><option value={x.id} key={x.id}>{x.name}</option>)}</select><a href={`/${locale}/liquidity?tab=counterparties`}>{ar?"إدارة الموردين":"Manage suppliers"}</a></label>
            <label>{ar?"رقم فاتورة المورد":"Supplier invoice reference"}<input value={form.invoice_reference} onChange={e=>setForm({...form,invoice_reference:e.target.value})}/></label>
            <label>{ar?"تاريخ استحقاق السداد":"Payment due date"}<input type="date" min={form.purchase_date} value={form.due_date} onChange={e=>setForm({...form,due_date:e.target.value})}/></label>
            <label>{ar?"ضريبة المدخلات بعملة الأصل":"Input VAT in asset currency"}<input type="number" min="0" step="any" value={form.vat_amount} onChange={e=>setForm({...form,vat_amount:e.target.value})}/></label>
            <label>{ar?"نسبة الضريبة القابلة للاسترداد %":"Recoverable VAT %"}<input type="number" min="0" max="100" value={form.recoverable_percent} onChange={e=>setForm({...form,recoverable_percent:e.target.value})}/><small>{ar?"الجزء غير القابل للاسترداد يضاف لتكلفة الأصل؛ السداد إجراء مستقل.":"Nonrecoverable VAT is capitalized; payment is separate."}</small></label>
          </>}
          <label>{ar?"فئة الأصل":"Asset class"}<select disabled={Boolean(edit&&form.has_financial_history)} value={form.display_class||""} onChange={e=>setForm({...form,display_class:e.target.value,classification_changed:true,asset_class_code:null,asset_type_code:null})}><option value="">{ar?"اختر الفئة":"Choose class"}</option>{ASSET_DISPLAY_CLASSES.filter(c=>c[0]!=="UNCLASSIFIED"||edit).map(c=><option key={c[0]} value={c[0]}>{c[3]} {ar?c[1]:c[2]}</option>)}</select></label>
          <label>{ar?"نوع الأصل":"Asset type"}<select disabled={Boolean((edit&&form.has_financial_history)||!form.display_class)} value={form.asset_type_code||""} onChange={e=>{const t=catalog.types.find((x:any)=>x.code===e.target.value);setForm({...form,asset_class_code:t?.class_code||null,asset_type_code:t?.code||null,asset_type:t?.default_legacy_asset_type||form.asset_type,karat:t?.default_legacy_asset_type==="SILVER"?"999":"24"});}}><option value="">{edit&&!form.asset_type_code?`${assetTypeIcon(form.asset_type)} ${label(form.asset_type)} — ${ar?"التصنيف المحفوظ":"Saved classification"}`:(ar?"اختر النوع":"Choose type")}</option>{catalog.types.filter((x:any)=>catalogDisplayClass(x)===form.display_class).map((x:any)=><option key={x.code} value={x.code}>{assetTypeIcon(x.code)} {ar?x.name_ar:x.name_en}</option>)}</select></label>
          {edit&&!form.asset_type_code&&<p className="muted">{ar?"النوع السابق محفوظ دون تغيير. الأصول المرتبطة بحركات لا يعاد تصنيفها من هذا النموذج.":"Existing type is preserved. Assets with financial history cannot be reclassified here."}</p>}
          {["PROPERTY","INVESTMENT","METALS"].includes(form.display_class)&&<label>{ar?"غرض الاحتفاظ":"Holding purpose"}<select disabled={Boolean(edit&&form.has_financial_history)} value={form.holding_purpose||""} onChange={e=>setForm({...form,holding_purpose:e.target.value})}><option value="">{ar?"غير محدد":"Not specified"}</option><option value="USE">{ar?"استخدام":"Use"}</option><option value="RENT">{ar?"تأجير":"Rental"}</option><option value="INVESTMENT">{ar?"استثمار":"Investment"}</option><option value="TRADE">{ar?"متاجرة":"Trading"}</option></select><small>{ar?"معلومة وصفية؛ الأهلية الزكوية تحدد بشكل مستقل.":"Descriptive; Zakat eligibility is set separately."}</small></label>}
          <label>
            {ar ? "اسم الأصل" : "Name"}
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            {!edit && form.acquisition_mode === "OPENING_BALANCE" ? (ar ? "تاريخ التملك / الرصيد الافتتاحي" : "Ownership / opening date") : (ar ? "تاريخ الشراء" : "Purchase date")}
            <input
              type="date"
              disabled={Boolean(edit && form.has_financial_history)}
              value={form.purchase_date}
              onChange={(e) =>
                setForm({ ...form, purchase_date: e.target.value })
              }
            />
          </label>
          {!qty && !["CASH","BANK"].includes(form.asset_type) && <label>{ar?"الكمية / عدد الوحدات":"Quantity / units"}<input type="number" min="0.00000001" step="any" disabled={Boolean(edit&&form.has_financial_history)} value={form.quantity||"1"} onChange={e=>setForm({...form,quantity:e.target.value})}/><small>{ar?"القيمة أدناه إجمالي الوحدات، وليست سعر الوحدة.":"The value below is the total for all units."}</small></label>}
          {qty ? (
            <>
              <label>
                {metal
                  ? ar
                    ? "الوزن بالغرام"
                    : "Weight g"
                  : ar
                    ? "الكمية"
                    : "Quantity"}
                <input
                  type="number"
                  step="0.001"
                  disabled={Boolean(edit && form.has_financial_history)}
              value={form.quantity}
                  onChange={(e) =>
                    setForm({ ...form, quantity: e.target.value })
                  }
                />
              </label>
              <label>
                {ar ? "سعر الشراء" : "Purchase price"}
                <input
                  type="number"
                  step="0.01"
                  disabled={Boolean(edit && form.has_financial_history)}
              value={form.purchase_price}
                  onChange={(e) =>
                    setForm({ ...form, purchase_price: e.target.value })
                  }
                />
              </label>
              {market && (
                <label>
                  {ar ? "سعر السوق" : "Market price"}
                  <input
                    type="number"
                    step="0.01"
                    value={form.market_price}
                    onChange={(e) =>
                      setForm({ ...form, market_price: e.target.value })
                    }
                  />
                </label>
              )}
              {metal && (
                <label>
                  {ar ? "العيار / النقاوة" : "Karat / purity"}
                  <input
                    type="number"
                    step="0.001"
                    disabled={Boolean(edit && form.has_financial_history)}
              value={form.karat}
                    onChange={(e) =>
                      setForm({ ...form, karat: e.target.value })
                    }
                  />
                </label>
              )}
            </>
          ) : (
            <label>
              {!edit && form.acquisition_mode === "PURCHASE" ? (ar ? "قيمة الشراء" : "Purchase value") : (ar ? "القيمة / الرصيد الافتتاحي" : "Opening value / balance")}
              <input
                type="number"
                step="0.01"
                disabled={Boolean(edit && form.has_financial_history)}
              value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </label>
          )}
          <label>
            {ar ? "زكوي؟" : "Zakatable?"}
            <select
              value={form.is_zakatable ? "1" : "0"}
              onChange={(e) =>
                setForm({ ...form, is_zakatable: e.target.value === "1" })
              }
            >
              <option value="1">✓ {ar ? "نعم" : "Yes"}</option>
              <option value="0">— {ar ? "لا" : "No"}</option>
            </select>
          </label>
        </div>
        <button type="button" className="btn" onClick={save} disabled={saving}>
          {saving
            ? "…"
            : edit
              ? "✓ " + (ar ? "حفظ التعديلات" : "Save changes")
              : "＋ " + (ar ? "حفظ الأصل" : "Save asset")}
        </button>
        {(
          <button
            className="btn secondary"
            type="button"
            onClick={() => {
              setEdit(null);setRequestId("");setFormOpen(false);
              setForm({...empty});
            }}
          >
            {ar ? "إغلاق" : "Close"}
          </button>
        )}
      </section>}
      {msg&&<p role="status" className="muted">{msg}</p>}
      <section className="section">
        <div className="asset-lifecycle-tabs" style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}>{([["ACTIVE",ar?"نشطة":"Active"],["SOLD",ar?"مباعة":"Sold"],["DISPOSED",ar?"مستغنى عنها":"Disposed"],["ALL",ar?"الكل":"All"]] as const).map(([key,label])=><button key={key} type="button" className={`btn ${lifecycleFilter===key?"":"secondary"}`} onClick={()=>setLifecycleFilter(key)}>{label} <span className="pill">{lifecycleCounts[key]}</span></button>)}</div>
        <h2>
          <span className="section-title-icon" aria-hidden="true">
            ▤
          </span>{" "}
          {ar ? "تقرير الأصول" : "Asset report"}
        </h2>
        <div className="form-grid" style={{marginBottom:16}}><label>{ar?"تصفية حسب الفئة":"Filter by class"}<select value={classFilter} onChange={e=>{setClassFilter(e.target.value);setTypeFilter("ALL");}}><option value="ALL">{ar?"جميع الفئات":"All classes"}</option>{ASSET_DISPLAY_CLASSES.map(c=><option key={c[0]} value={c[0]}>{c[3]} {ar?c[1]:c[2]}</option>)}</select></label><label>{ar?"تصفية حسب النوع":"Filter by type"}<select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}><option value="ALL">{ar?"جميع الأنواع":"All types"}</option>{Array.from(new Map(filteredRows.filter(r=>classFilter==="ALL"||assetDisplayClass(r)===classFilter).map(r=>[r.asset_type_code||r.asset_type,r])).entries()).map(([key,r])=><option key={key} value={key}>{assetTypeIcon(key)} {typeName(r)}</option>)}</select></label></div>
        {loading && <div className="card section muted">{ar ? "جارٍ تحميل الأصول…" : "Loading assets…"}</div>}
        {!loading && !loadError && groups.length === 0 && (
          <div className="card section muted">
            {ar ? "لا توجد أصول مطابقة في نطاق العرض الحالي. راجع النطاق والفلاتر أعلاه." : "No assets match this view. Check the scope and filters above."}
          </div>
        )}
        {groups.map((g) => {
          const sub = g.rows.reduce((s, r) => s + val(r), 0),
            sd = g.rows.reduce((s, r) => s + due(r), 0),
            isClosed = !!closed[g.type],
            sortedRows = sortAssetRows(g.rows, sort.column, sort.direction);
          return (
            <div className="card section asset-group" key={g.type}>
              <div className="page-head asset-group-head">
                <div>
                  <h3 className="asset-type-title">
                    <span className="asset-type-icon">{g.symbol}</span>
                    {g.title}{" "}
                    <span className="pill">{g.rows.length}</span>
                  </h3>
                  <div className="asset-summary">
                    <span className="sum-chip">
                      <span className="sum-icon" aria-hidden="true">
                        ◆
                      </span>
                      <span>{ar ? "إجمالي القيمة" : "Total value"}</span>
                      <strong>
                        {fmt(cv(sub))} {cur}
                      </strong>
                    </span>
                    <span className="sum-chip due">
                      <span className="sum-icon" aria-hidden="true">
                        ◉
                      </span>
                      <span>{ar ? "زكاة Snapshot" : "Snapshot Zakat"}</span>
                      <strong>
                        {fmt(cv(sd))} {cur}
                      </strong>
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn secondary collapse-btn"
                  onClick={() =>
                    setClosed((x) => ({ ...x, [g.type]: !x[g.type] }))
                  }
                >
                  {isClosed ? "＋" : "−"}
                </button>
              </div>
              {!isClosed && (
                <div style={{ overflowX: "auto" }}>
                  <table
                    className="table asset-report-table"
                    data-size={tablePreferences.size}
                    data-preset={tablePreferences.preset}
                  >
                    <thead>
                      <tr>
                        {orderedColumns.map((column) => {
                          const sortable = column !== "action";
                          const active = sortable && sort.column === column;
                          return (
                            <th
                              key={column}
                              data-column={column}
                              aria-sort={
                                active
                                  ? sort.direction === "asc"
                                    ? "ascending"
                                    : "descending"
                                  : undefined
                              }
                            >
                              {sortable ? (
                                <button
                                  type="button"
                                  className={`asset-sort${active ? " active" : ""}`}
                                  onClick={() =>
                                    changeSort(column as AssetSortColumn)
                                  }
                                >
                                  <span>{columnLabel(column)}</span>
                                  <span aria-hidden="true">
                                    {sortMark(column as AssetSortColumn)}
                                  </span>
                                </button>
                              ) : (
                                columnLabel(column)
                              )}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRows.map((row) => (
                        <tr key={row.id}>
                          {orderedColumns.map((column) => (
                            <td key={column} data-column={column}>
                              {renderAssetCell(column, row)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </section>
    </main>
  );
}
function HawlBadge({
  date,
  ar,
  displayOnly = false,
}: {
  date?: string;
  ar: boolean;
  displayOnly?: boolean;
}) {
  const h = hawlParts(date);
  if (!h) return <span className="pill">{ar ? "لم يبدأ" : "Not started"}</span>;
  return (
    <span
      className={`hawl-badges${displayOnly ? " display-only" : ""}`}
      title={
        displayOnly
          ? ar
            ? "مدة مرجعية للمحفظة فقط — لم تُثبت كبداية حول لهذا الأصل"
            : "Portfolio reference only — not persisted as this asset Hawl start"
          : undefined
      }
    >
      <span className="hawl-cycle">
        <b>{h.cycles}</b> {ar ? "حول" : "Hawl"}
      </span>
      <span className="hawl-days">
        <b>{h.extra}</b> {ar ? "يوم" : "days"}
      </span>
      {displayOnly && (
        <span className="hawl-reference">{ar ? "مرجعي" : "Reference"}</span>
      )}
    </span>
  );
}
function ZakatCell({
  row,
  ar,
  amount,
}: {
  row: any;
  ar: boolean;
  amount: string;
}) {
  const c = row.zakat_calculation;
  if (!row.is_zakatable && !Number(c?.zakat_amount))
    return <span className="pill">{ar ? "غير زكوي" : "Exempt"}</span>;
  if (!c)
    return <span className="pill">{ar ? "غير محتسب" : "Not assessed"}</span>;
  if (c.statuses?.includes("NOT_ASSESSED")) {
    const hasPersistedHawl = (c.lots || []).some((l: any) => l.hawl_start_date);
    return (
      <span className="pill">
        {hasPersistedHawl
          ? ar
            ? "بانتظار إعادة الاحتساب"
            : "Awaiting recalculation"
          : ar
            ? "غير محتسب"
            : "Not assessed"}
      </span>
    );
  }
  const s = c.statuses || [];
  const label = s.includes("ELIGIBLE")
    ? ar
      ? "مؤهل"
      : "Eligible"
    : s.includes("HAWL_NOT_COMPLETED")
      ? ar
        ? "لم يكتمل الحول"
        : "Hawl pending"
      : s.includes("BELOW_NISAB")
        ? ar
          ? "أقل من النصاب"
          : "Below Nisab"
        : ar
          ? "غير مؤهل"
          : "Not eligible";
  return (
    <div className="zakat-result-compact">
      <strong>{amount}</strong> <span className="pill">{label}</span>
      <details className="asset-valuation-details"><summary aria-label={ar?"أساس الاحتساب المحفوظ":"Saved valuation basis"} title={ar?"أساس الاحتساب المحفوظ":"Saved valuation basis"}><span aria-hidden="true">▸</span></summary><div className="asset-valuation-content">
        <div className="muted">{ar ? "تاريخ التقييم" : "Valuation date"}: {c.valuation_date} · {ar ? "الدورة" : "Cycle"}: {c.cycle_number??"—"}</div>
        {(c.lots??[]).map((l:any)=><div key={l.id??l.lot_id} style={{marginTop:6,fontSize:11}}>
          {ar ? "الكمية" : "Quantity"}: {fmt(l.quantity)} · {ar ? "السعر" : "Price"}: {l.valuation_price==null?"—":fmt(l.valuation_price)} {l.valuation_currency}
          <br/>{ar ? "النقاوة" : "Purity"}: {l.valuation_snapshot?.purity??"—"} · {ar ? "سعر الصرف" : "FX"}: {l.fx_rate??"—"}
          <br/>{ar ? "المصدر" : "Source"}: {l.valuation_snapshot?.priceSource??c.snapshot?.priceSource??"—"}
        </div>)}
        <div className="muted">{ar ? "مدفوعات تاريخية لكل الدورات" : "Historical payments across cycles"}: {fmt(c.historical_paid_amount)} {c.currency}</div>
      </div></details>
    </div>
  );
}
function K({
  t,
  v,
  i,
  tone,
  source,
}: {
  t: string;
  v: string;
  i: string;
  tone: string;
  source: string;
}) {
  return (
    <div className={`card asset-kpi tone-${tone}`}>
      <div className="asset-kpi-head">
        <span className="kpi-icon" aria-hidden="true">
          {i}
        </span>
        <span className="muted">{t}</span>
      </div>
      <div className="metric">{v}</div>
      <div className="asset-kpi-source">
        <span aria-hidden="true" />
        {source}
      </div>
      <span className="asset-kpi-accent" aria-hidden="true" />
    </div>
  );
}