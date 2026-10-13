"use client";
import {CurrencyScope,Money,useDisplayMoney} from "@/components/DisplayCurrency";
import { use, useEffect, useMemo, useState, useRef } from "react";
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
import {assetReportCalculation, type AssetCycleScope} from "@/lib/asset-zakat-report";
import {assetPageIndicators,indicatorPercent} from '@/lib/asset-page-indicators';
import AssetsPageToolbar from "@/components/assets/AssetsPageToolbar";
import ActionButton,{ActionIconGlyph} from "@/components/ActionButton";
import DetailsDialog from "@/components/assets/DetailsDialog";
import AssetDetails from "@/components/assets/AssetDetails";
import AssetPurchasePanel from "@/components/assets/AssetPurchasePanel";
import {assetPurchaseAmounts,assetPurchaseStatus} from "@/lib/asset-purchase-workspace";
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
    currency:"SAR", fx_rate:"1", vat_input_mode:"PERCENT",vat_rate:"15",vat_amount:"0", recoverable_percent:"100", counterparty_id:"", invoice_reference:"", due_date:"",
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
    [detailAsset,setDetailAsset]=useState<any>(null),
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
    [groupBy,setGroupBy]=useState<"CLASS"|"TYPE">("CLASS"),
    [metricDetail,setMetricDetail]=useState<string|null>(null),
    [cycleScope,setCycleScope]=useState<AssetCycleScope>("DISPLAYED"),
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
  const loadVersion=useRef(0);
  const load = async (background=false) => {
    const version=++loadVersion.current;
    if(!background)setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/assets",{cache:"no-store"});
      if (!response.ok) throw new Error("LOAD_FAILED");
      const nextRows=await response.json();
      if(version!==loadVersion.current)return;
      setRows(nextRows);
      const catalogResponse = await fetch("/api/assets/catalog");
      const nextCatalog=catalogResponse.ok?await catalogResponse.json():null;
      if(version!==loadVersion.current)return;
      if(nextCatalog)setCatalog(nextCatalog);
      const preferenceResponse=await fetch("/api/assets/preferences");
      if(preferenceResponse.ok){const preference=await preferenceResponse.json();if(version!==loadVersion.current)return;setUsageMode(preference.asset_usage_mode);if(preference.asset_usage_mode!=="BOTH")setAssetScope(preference.asset_usage_mode);}
    } catch {
      if(version!==loadVersion.current)return;
      setRows([]);
      setLoadError(
        ar ? "تعذر تحميل الأصول. حاول تحديث الصفحة." : "Could not load assets. Refresh the page to try again.",
      );
    } finally {
      if(version===loadVersion.current)setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    const refresh=()=>{if(document.visibilityState==="visible")void load(true)};
    window.addEventListener("focus",refresh);
    const refreshTimer=window.setInterval(refresh,30000);
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
      ++loadVersion.current;
      window.removeEventListener("focus",refresh);
      window.clearInterval(refreshTimer);
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
    remaining = (r: any) => Number(calc(r)?.remaining_amount ?? Math.max(0, due(r) - paid(r)));
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
  }).map(r=>cycleScope==="DISPLAYED"?r:{...r,zakat_calculation:assetReportCalculation(r.zakat_cycle_calculations||[],cycleScope)}), [rows, assetScope, scopeOrgId, scopeEntityId, scopeCostCenterId,cycleScope]);
  const filteredRows = useMemo(() => lifecycleFilter === "ALL" ? scopedRows : scopedRows.filter((r) => (r.lifecycle_status || "ACTIVE") === lifecycleFilter), [scopedRows,lifecycleFilter]);
  const lifecycleCounts = useMemo(() => ({ACTIVE:scopedRows.filter(r=>(r.lifecycle_status||"ACTIVE")==="ACTIVE").length,SOLD:scopedRows.filter(r=>r.lifecycle_status==="SOLD").length,DISPOSED:scopedRows.filter(r=>r.lifecycle_status==="DISPOSED").length,ALL:scopedRows.length}),[scopedRows]);
  const displayRows=useMemo(()=>filteredRows.filter(r=>(classFilter==="ALL"||assetDisplayClass(r)===classFilter)&&(typeFilter==="ALL"||(r.asset_type_code||r.asset_type)===typeFilter)),[filteredRows,classFilter,typeFilter]);
  const groups=useMemo(()=>{
    if(groupBy==="CLASS")return ASSET_DISPLAY_CLASSES.map(([type,nameAr,nameEn,symbol])=>({type:`CLASS:${type}`,title:ar?nameAr:nameEn,symbol,rows:displayRows.filter(r=>assetDisplayClass(r)===type)})).filter(g=>g.rows.length);
    const byType=new Map<string,{type:string;title:string;symbol:string;rows:any[]}>();
    for(const row of displayRows){
      const code=row.asset_type_code||row.asset_type||"UNKNOWN";
      let group=byType.get(code);
      if(!group){
        const catalogType=catalog.types.find((t:any)=>t.code===code);
        const title=(catalogType?(ar?catalogType.name_ar:catalogType.name_en):TYPES.find(t=>t[0]===row.asset_type)?.[ar?1:2])||code;
        group={type:`TYPE:${code}`,title,symbol:assetTypeIcon(code),rows:[]};
        byType.set(code,group);
      }
      group.rows.push(row);
    }
    return Array.from(byType.values()).sort((a,b)=>a.title.localeCompare(b.title,ar?"ar":"en"));
  },[displayRows,ar,groupBy,catalog.types]);
  const typeName=(r:any)=>{const t=catalog.types.find((x:any)=>x.code===r.asset_type_code);return t?(ar?t.name_ar:t.name_en):TYPES.find(x=>x[0]===r.asset_type)?.[ar?1:2]||r.asset_type;};
  const showingExited = lifecycleFilter === "SOLD" || lifecycleFilter === "DISPOSED";
  const historicalSummary=(items:any[],withDetails=false)=>{
    const exited=items.filter(r=>["SOLD","DISPOSED"].includes(r.lifecycle_status));
    if(!exited.length)return null;
    const quantities=new Map<string,{title:string;unit:string;quantity:number}>();
    let historicalCost=0,unknownCost=false,proceeds=0;
    for(const r of exited){
      const sold=r.lifecycle_status==="SOLD";
      const amount=sold?r.sold_cost_value:r.disposed_cost_value;
      if(amount==null)unknownCost=true;else historicalCost+=Number(amount);
      if(sold)proceeds+=Number(r.sold_proceeds_value||0);
      const unit=["GOLD","SILVER"].includes(r.asset_type)?"g":r.unit||"";
      const key=`${r.asset_type_code||r.asset_type}:${unit}`;
      const entry=quantities.get(key)||{title:typeName(r),unit,quantity:0};
      entry.quantity+=Number(sold?r.sold_quantity:r.disposed_quantity)||0;
      quantities.set(key,entry);
    }
    return <div className={withDetails?"asset-exit-overview":""}>
      <div className={withDetails?"asset-exit-totals":"asset-summary"} aria-label={ar?"إجماليات الأصول الخارجة":"Exited asset totals"}>
        <div className={withDetails?"asset-exit-metric":"sum-chip"}>
          {withDetails&&<span className="asset-exit-metric-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 9h18M16 13h5v4h-5z"/></svg></span>}
          <div><span>{ar?(lifecycleFilter==="DISPOSED"?"التكلفة قبل الاستغناء":lifecycleFilter==="SOLD"?"التكلفة قبل البيع":"التكلفة قبل البيع / الاستغناء"):"Cost before exit"}</span><strong>{unknownCost?"—":<Money value={historicalCost} currency={cur}/>}</strong></div>
        </div>
        {Array.from(quantities.entries()).sort((a,b)=>a[1].title.localeCompare(b[1].title,ar?"ar":"en")).map(([key,q])=><div className={withDetails?"asset-exit-metric":"sum-chip"} key={key}>
          {withDetails&&<span className={`asset-exit-metric-icon ${key.startsWith("GOLD")?"is-gold":"is-metal"}`} aria-hidden="true">{assetTypeIcon(key.split(":")[0])}</span>}
          <div><span>{q.title} · {ar?(q.unit==="g"?(lifecycleFilter==="DISPOSED"?"الوزن قبل الاستغناء":"الوزن قبل الخروج"):(lifecycleFilter==="DISPOSED"?"الكمية قبل الاستغناء":"الكمية قبل الخروج")):(q.unit==="g"?"Weight before exit":"Quantity before exit")}</span><strong>{fmt(q.quantity)} {q.unit==="g"?(ar?"غرام":"g"):q.unit}</strong></div>
        </div>)}
        {exited.some(r=>r.lifecycle_status==="SOLD")&&<div className={withDetails?"asset-exit-metric":"sum-chip"}><div><span>{ar?"حصيلة البيع":"Sale proceeds"}</span><strong><Money value={proceeds} currency={cur}/></strong></div></div>}
      </div>
      {unknownCost&&<small className="muted">{ar?"تكلفة بعض عمليات البيع القديمة غير محفوظة؛ لا تُستبدل بحصيلة البيع أو بسعر السوق الحالي.":"Some historical sale costs are unavailable; proceeds and current quotes are not used as substitutes."}</small>}
      {withDetails&&<details className="asset-exit-history"><summary><svg className="asset-exit-chevron" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6"/></svg>{ar?"التفاصيل":"Details"}</summary>
        <div className="asset-exit-history-panel"><h4>{ar?"سجل عمليات البيع والاستغناء":"Sale and disposal history"}</h4><div className="asset-exit-table-scroll"><table className="table asset-exit-table"><thead><tr><th>{ar?"الأصل":"Asset"}</th><th>{ar?"النوع":"Type"}</th><th>{ar?"تاريخ العملية":"Transaction date"}</th><th>{ar?"العملية":"Operation"}</th><th>{ar?"الوزن / الكمية":"Weight / quantity"}</th><th>{ar?"التكلفة قبل الخروج":"Cost before exit"}</th><th>{ar?"حصيلة البيع":"Sale proceeds"}</th></tr></thead><tbody>
          {exited.flatMap(r=>(r.exit_history||[]).filter((tx:any)=>tx.kind===r.lifecycle_status).map((tx:any)=><tr key={tx.id}><td>{r.name}</td><td>{assetTypeIcon(r.asset_type_code||r.asset_type)} {typeName(r)}</td><td>{tx.date}</td><td>{tx.kind==="SOLD"?(ar?"بيع":"Sale"):(ar?"استغناء":"Disposal")}</td><td>{fmt(tx.quantity)} {["GOLD","SILVER"].includes(r.asset_type)?(ar?"غرام":"g"):r.unit||""}</td><td>{tx.cost==null?"—":<Money value={tx.cost} currency={cur}/>}</td><td>{tx.kind==="SOLD"?<Money value={tx.proceeds} currency={cur}/>:"—"}</td></tr>))}
        </tbody></table></div></div>
      </details>}
    </div>;
  };
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Riyadh'});
  const indicators=assetPageIndicators(displayRows,today);
  const scopeIndicators=assetPageIndicators(scopedRows,today);
  const {active:activeRows,total,cost,totalDue,totalPaid,completed,near}=indicators;
  const info = (t: string) => TYPES.find((x) => x[0] === t),
    label = (t: string) => info(t)?.[ar ? 1 : 2] || t,
    icon = (t: string) => info(t)?.[3] || "💼";
  const retroPending = scopedRows.filter(
    (r) =>
      r.is_zakatable &&
      (calc(r)?.statuses || []).includes("NOT_ASSESSED") &&
      (calc(r)?.lots || []).some((l: any) => l.hawl_start_date),
  );
  const pendingInOpen = retroPending.filter(r => (r.zakat_cycle_calculations || []).some((c:any) => !c.cycle_closed)).length;
  const cycleScopeLabel = cycleScope === "ALL" ? (ar?"المغلقة + آخر احتساب للمفتوحة":"Closed + latest open assessments") : cycleScope === "CLOSED" ? (ar?"الدورات المغلقة":"Closed cycles") : cycleScope === "OPEN" ? (ar?"آخر احتساب للدورات المفتوحة":"Latest open-cycle assessments") : (ar?"احتساب الدورة المعروضة":"Displayed cycle assessment");
  const money=useDisplayMoney();
  const assetMoney=(v:number)=>money(v,cur);
  const metricCards=[
    {key:'value',icon:'◆',title:ar?'القيمة الحالية':'Current value',value:assetMoney(total),source:ar?'سجل التقييم':'Valuation ledger',percent:indicatorPercent(total,scopeIndicators.total),percentLabel:ar?'من قيمة الأصول النشطة في النطاق':'Of active asset value in scope',rows:activeRows,detail:(r:any)=>assetMoney(val(r))},
    {key:'cost',icon:'▤',title:ar?'تكلفة الشراء':'Purchase cost',value:assetMoney(cost),source:ar?'سجل الأصول':'Asset ledger',percent:indicatorPercent(cost,scopeIndicators.cost),percentLabel:ar?'من تكلفة الأصول النشطة في النطاق':'Of active asset cost in scope',rows:activeRows,detail:(r:any)=>assetMoney(Number(r.current_cost_value||0))},
    {key:'gain',icon:'↗',title:ar?'فرق التقييم الحالي':'Current valuation difference',value:assetMoney(total-cost),source:ar?'القيمة الحالية − التكلفة':'Current value − cost',percent:indicatorPercent(total-cost,cost),percentLabel:ar?'نسبة فرق التقييم إلى التكلفة':'Valuation difference / cost',rows:activeRows,detail:(r:any)=>assetMoney(val(r)-Number(r.current_cost_value||0))},
    {key:'due',icon:'◉',title:ar?'الزكاة المحتسبة':'Calculated Zakat',value:assetMoney(totalDue),source:cycleScopeLabel,percent:indicatorPercent(totalDue,indicators.eligibleValue),percentLabel:ar?'من الوعاء المؤهل المحفوظ':'Of saved eligible base',rows:displayRows.filter(r=>due(r)>0),detail:(r:any)=>assetMoney(due(r))},
    {key:'paid',icon:'✓',title:ar?'المسدّد ضمن نطاق الدورات':'Paid within cycle scope',value:assetMoney(totalPaid),source:cycleScopeLabel,percent:indicatorPercent(totalPaid,totalDue),percentLabel:ar?'من الزكاة المحتسبة':'Of calculated Zakat',rows:displayRows.filter(r=>paid(r)>0),detail:(r:any)=>assetMoney(paid(r))},
    {key:'count',icon:'▦',title:ar?'عدد الأصول النشطة':'Active assets',value:String(activeRows.length),source:ar?'السجل الفعلي':'Live ledger',percent:indicatorPercent(activeRows.length,scopeIndicators.active.length),percentLabel:ar?'من الأصول النشطة في النطاق':'Of active assets in scope',rows:activeRows,detail:()=> '1'},
    {key:'hawl',icon:'◷',title:ar?'مؤهل بالحول':'Hawl eligible',value:String(completed.length),source:cycleScopeLabel,percent:indicatorPercent(completed.length,displayRows.filter(r=>r.is_zakatable).length),percentLabel:ar?'من الأصول الزكوية المعروضة':'Of displayed zakatable assets',rows:completed,detail:(r:any)=>assetMoney(due(r))},
    {key:'near',icon:'!',title:ar?'استحقاق خلال 30 يوماً':'Due within 30 days',value:String(near.length),source:ar?'تواريخ الحول الحالي':'Current Hawl dates',percent:indicatorPercent(near.length,indicators.zakatable.length),percentLabel:ar?'من الأصول الزكوية النشطة':'Of active zakatable assets',rows:near,detail:(r:any)=>indicators.nextDue(r)||'—'},
  ];
  const selectedMetric=metricCards.find(card=>card.key===metricDetail);
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
      vat_input_mode:d.vat_input_mode??"AMOUNT",vat_rate:d.vat_rate??15,fx_rate:d.fx_rate??1,vat_amount:d.vat_amount??0,recoverable_percent:d.recoverable_percent??100,counterparty_id:d.counterparty_id??"",invoice_reference:d.invoice_reference??"",due_date:d.due_date??"",
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
            {row.financial_event_id&&<span className="pill">{assetPurchaseStatus(row.financial_event_status||"DRAFT",ar)}</span>}
            {!orderedColumns.includes("action")&&<ActionButton icon="details" label={ar?"التفاصيل والإجراءات":"Details and actions"} onClick={()=>{if(row.metadata?.investment_id)window.location.href=`/${locale}/investments?investment_id=${row.metadata.investment_id}`;else setDetailAsset(row);}}/>}
            <span className="pill asset-detail-type">{typeName(row)}</span>
            {assetDisplayClass(row)==="UNCLASSIFIED"&&<small className="muted">{ar?"استكمال التصنيف":"Awaiting classification"}</small>}
            {row.lifecycle_status==="SOLD" && <span className="pill" style={{marginInlineStart:8}}>{ar?"مباع":"Sold"}</span>}
            {row.lifecycle_status==="DISPOSED" && <span className="pill" style={{marginInlineStart:8}}>{ar?"مستغنى عنه":"Disposed"}</span>}
          </strong>
        );
      case "date":
        return row.lifecycle_status!=="ACTIVE" && row.lifecycle_exit_date ? `${row.metadata?.purchase_date || "—"} → ${row.lifecycle_exit_date}` : row.metadata?.purchase_date || "—";
      case "weight": {
        const quantity=row.lifecycle_status==="DISPOSED"?row.disposed_quantity:row.lifecycle_status==="SOLD"?row.sold_quantity:(row.current_quantity??m(row,"quantity"));
        return ["GOLD", "SILVER"].includes(row.asset_type)
          ? `${fmt(quantity)} g`
          : quantity
            ? fmt(quantity)
            : "—";
      }
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
        if(row.pending_purchase_cost_base>0)return <span><Money value={cv(row.pending_purchase_cost_base)} currency={cur}/><small className="muted"> {ar?"قيمة المسودة":"Draft value"}</small></span>;
        if(row.lifecycle_status==="SOLD")return <span title={ar?"تكلفة الجزء المباع قبل البيع":"Historical cost of sold quantity"}>{row.sold_cost_value==null?"—":<Money value={cv(row.sold_cost_value)} currency={cur}/>}</span>;
        return <span title={row.lifecycle_status==="DISPOSED"?(ar?"تكلفة الجزء المستغنى عنه قبل الاستبعاد":"Historical cost of disposed quantity"):undefined}><Money value={cv(row.lifecycle_status==="DISPOSED"?row.disposed_cost_value:costVal(row))} currency={cur}/></span>;
      case "current":
        return <strong><Money value={cv(val(row))} currency={cur}/></strong>;
      case "due":
        return <Money value={cv(due(row))} currency={cur}/>;
      case "paid":
        return <Money value={cv(paid(row))} currency={cur}/>;
      case "remaining":
        return <Money value={cv(remaining(row))} currency={cur}/>;
      case "calculation":
        return (
          <ZakatCell
            row={row}
            ar={ar}
            amount={<Money value={cv(due(row))} currency={cur}/>}
          />
        );
      case "action":
        return <ActionButton icon="details" label={ar?"التفاصيل والإجراءات":"Details and actions"} onClick={()=>{if(row.metadata?.investment_id)window.location.href=`/${locale}/investments?investment_id=${row.metadata.investment_id}`;else{setDetailAsset(row);setReviewEvent(null);setOperationAsset(null);}}}/>;

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
    let purchaseTax:number;try{purchaseTax=assetPurchaseAmounts(pc,form.vat_input_mode==="PERCENT"?form.vat_rate:form.vat_amount,form.vat_input_mode).tax;}catch{setMsg(ar?"تحقق من قيمة الشراء ونسبة الضريبة (0–100%)":"Check purchase value and VAT rate (0–100%)");return;}
    setSaving(true);
    const metadata: any = {
      ...(edit ? form.metadata ?? {} : {}),
      fx_rate:Number(form.fx_rate),vat_input_mode:form.vat_input_mode,vat_rate:form.vat_input_mode==="PERCENT"?Number(form.vat_rate):null,vat_amount:purchaseTax,recoverable_percent:Number(form.recoverable_percent??100),counterparty_id:form.counterparty_id||null,invoice_reference:form.invoice_reference||null,due_date:form.due_date||null,
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
    if(edit && form.has_financial_history) for(const key of ["quantity","purchase_value","opening_value","purchase_price","karat","purity","purchase_date","acquisition_mode","funding_account_id","fx_rate","vat_input_mode","vat_rate","vat_amount","recoverable_percent","counterparty_id","invoice_reference","due_date"]) {
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
  const scopeControl = usageMode==="BOTH"?<div className="asset-owner-switch" role="group" aria-label={ar?"نطاق عرض الأصول":"Asset view scope"}>{([["PERSONAL",ar?"♙ شخصي":"♙ Personal"],["ORGANIZATION",ar?"▥ مؤسسي":"▥ Organization"]] as const).map(([key,text])=><button key={key} type="button" className={`btn ${assetScope===key?"":"secondary"}`} title={text} aria-label={text} aria-pressed={assetScope===key} onClick={()=>{setAssetScope(key);setScopeEntityId("");setScopeCostCenterId("");setClassFilter("ALL");setTypeFilter("ALL");}}>{text}</button>)}</div>:<strong>{usageMode==="PERSONAL"?(ar?"♙ شخصي":"♙ Personal"):(ar?"▥ مؤسسي":"▥ Organization")}</strong>;
  return (
    <main className={`container assets-page assets-page-${design}`}><CurrencyScope currency={baseCurrency} organizationId={assetScope==="ORGANIZATION"?scopeOrgId:undefined}/>
      <style>{`.asset-detail-type{font-size:11px;margin-inline-start:8px}.asset-owner-switch{display:flex;gap:6px;flex-wrap:wrap}.asset-scope-bar{display:grid;grid-template-columns:minmax(180px,.8fr) minmax(220px,1.2fr) minmax(200px,1fr) minmax(200px,1fr);gap:12px;align-items:end;padding:16px 18px}.asset-scope-bar label{display:grid;gap:6px;font-size:12px;font-weight:700}.asset-scope-bar select{width:100%}.asset-scope-title{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:12px}.asset-scope-title strong{font-size:14px}.asset-scope-title span{font-size:11px;color:var(--muted)}@media(max-width:900px){.asset-scope-bar{grid-template-columns:1fr 1fr}}@media(max-width:620px){.asset-scope-bar{grid-template-columns:1fr}}.asset-report-table[data-size=compact] th,.asset-report-table[data-size=compact] td{padding:7px 8px;font-size:11px}.asset-report-table[data-size=normal] th,.asset-report-table[data-size=normal] td{padding:12px;font-size:13px}.asset-report-table[data-size=wide] th,.asset-report-table[data-size=wide] td{padding:17px 20px;font-size:14px}.asset-report-table th{min-width:105px;white-space:nowrap}.asset-report-table th[data-column=asset]{min-width:180px}.hawl-badges{display:inline-flex;gap:5px;white-space:nowrap}.hawl-cycle,.hawl-days{display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border-radius:8px}.hawl-cycle{background:var(--brand-surface-soft);color:var(--brand-primary)}.hawl-days{background:var(--brand-surface-soft);color:var(--brand-text)}.zakat-formula{margin-top:10px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--brand-surface-soft);color:var(--brand-text);min-width:280px}.zakat-formula-title{font-weight:700;margin-bottom:5px}.zakat-formula-eq{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;direction:ltr;text-align:left;white-space:normal;line-height:1.7}.zakat-formula-result{font-weight:800;margin-top:5px}`}</style>
      <div className="asset-page-header">
        <div className="asset-page-heading"><h1><span className="page-title-icon" aria-hidden="true">▥</span> {ar?"الأصول":"Assets"}</h1>{scopeControl}</div>
        <AssetsPageToolbar ar={ar} onAdd={()=>setFormOpen(true)} onUsage={()=>setUsageOpen(!usageOpen)} usageOpen={usageOpen}/>
      </div>
      <div className="asset-page-subtitle"><p className="muted">{ar?"نطاق الدورات المحدد ينعكس على مؤشرات الزكاة والجدول. الشامل يجمع النهائي المثبّت وآخر تقدير للمفتوحة، والسداد يُخصم من دورته.":"Cycle scope updates Zakat indicators and the table. Comprehensive combines frozen finals and latest open estimates; payments reduce their own cycle."}</p><span className="pill">{ar?"عملة الأساس: ":"Base currency: "}{baseCurrency}</span></div>
      {usageOpen&&<section className="card section"><label>{ar?"استخدام مساحة العمل للأصول":"Asset workspace usage"}<select value={usageMode} disabled={loading||usageSaving} onChange={e=>void saveUsage(e.target.value as typeof usageMode)}><option value="BOTH">{ar?"شخصي ومؤسسي":"Personal and organization"}</option><option value="PERSONAL">{ar?"شخصي فقط":"Personal only"}</option><option value="ORGANIZATION">{ar?"مؤسسي فقط":"Organization only"}</option></select></label><p className="muted">{ar?"هذا إعداد للعرض فقط. يمكن العودة إلى النطاق الآخر من هنا؛ لا ينقل ملكية الأصول ولا يغيّر أرصدتها.":"Display preference only. Switch back here; ownership and balances are unchanged."}</p></section>}
      {assetScope === "ORGANIZATION" && <section className="card section asset-scope-bar">
        <div className="asset-scope-title">
          <strong>{ar ? "عرض الأصول" : "Asset view"}</strong>
          <span>{ar ? "يُطبّق على المؤشرات والتقرير فقط" : "Applies to KPIs and report only"}</span>
        </div>

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
      </section>}
      {loadError && <div className="notice">{loadError}</div>}
      {!showingExited && <section className="grid section" aria-label={ar?"مؤشرات الأصول":"Asset indicators"}>
        {metricCards.map(card=><K key={card.key} i={card.icon} tone={card.key} t={card.title}
          v={indicatorValue(card.value)} source={indicatorSource(card.source)}
          percent={loading||loadError?null:card.percent} percentLabel={card.percentLabel}
          disabled={loading||!!loadError} expanded={metricDetail===card.key}
          detailsLabel={ar?"التفاصيل":"Details"} onClick={()=>setMetricDetail(metricDetail===card.key?null:card.key)}/>) }
      </section>}
      {!showingExited&&selectedMetric&&!loading&&!loadError&&<section id="asset-indicator-details" className="card section asset-indicator-details" aria-label={ar?"تفاصيل المؤشر":"Indicator details"}>
        <div className="page-head"><h3>{selectedMetric.title} · {selectedMetric.value}</h3><ActionButton icon="close" label={ar?"إغلاق التفاصيل":"Close details"} onClick={()=>setMetricDetail(null)}/></div>
        <p className="muted">{selectedMetric.source} · {ar?"وفق النطاق والفلاتر الحالية":"Using current scope and filters"}</p>
        <div style={{overflowX:'auto'}}><table className="table"><thead><tr><th>{ar?"الأصل":"Asset"}</th><th>{ar?"النوع":"Type"}</th><th>{selectedMetric.title}</th></tr></thead><tbody>{selectedMetric.rows.map(r=><tr key={r.id}><td>{r.name}</td><td>{typeName(r)}</td><td>{selectedMetric.detail(r)}</td></tr>)}</tbody></table></div>
        {!selectedMetric.rows.length&&<p className="muted">{ar?"لا توجد أصول مطابقة لهذا المؤشر.":"No matching assets for this indicator."}</p>}
      </section>}
      {detailAsset&&<DetailsDialog label={ar?"تفاصيل الأصل والإجراءات":"Asset details and actions"} onClose={()=>setDetailAsset(null)}>{(detailAsset.financial_event_id?<AssetPurchasePanel key={detailAsset.id} assetId={detailAsset.id} ar={ar} onChanged={()=>void load()} onClose={()=>setDetailAsset(null)} extraActions={<><ActionButton icon="edit" label={ar?"تعديل الاسم والتقييم الحالي":"Edit name and current valuation"} onClick={()=>{editRow(detailAsset);setDetailAsset(null);}}/>{detailAsset.current_quantity>0&&<ActionButton icon="operations" label={ar?"بيع أو إهلاك أو استبعاد":"Sale, depreciation or disposal"} onClick={()=>{setOperationAsset(detailAsset);setDetailAsset(null);}}/>}{detailAsset.financial_review_events?.map((e:any,i:number)=><ActionButton icon="history" key={e.id} label={`${ar?"السجل والمراجعة المالية":"Financial review and history"}${detailAsset.financial_review_events.length>1?` (${i+1})`:''}`} onClick={()=>{setReviewEvent({id:e.id,name:detailAsset.name});setDetailAsset(null);}}/>)}</>}/>:<AssetDetails key={detailAsset.id} asset={detailAsset} ar={ar} onClose={()=>setDetailAsset(null)} onEdit={()=>{editRow(detailAsset);setDetailAsset(null);}} onLifecycle={()=>{if(detailAsset.ownership_scope==="ORGANIZATION")setOperationAsset(detailAsset);else window.location.href=`/${locale}/transactions`;setDetailAsset(null);}} onReview={id=>{setReviewEvent({id,name:detailAsset.name});setDetailAsset(null);}}/>)}</DetailsDialog>}
      {reviewEvent&&<section className="card section"><div className="page-head"><h3>{reviewEvent.name}</h3><ActionButton icon="close" label={ar?"إغلاق المراجعة":"Close review"} onClick={()=>setReviewEvent(null)}/></div><AssetFinancialReview key={reviewEvent.id} eventId={reviewEvent.id} ar={ar} onChanged={()=>void load()} initialOpen/></section>}
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
            <label>{ar?"إدخال الضريبة":"VAT entry"}<select value={form.vat_input_mode} onChange={e=>setForm({...form,vat_input_mode:e.target.value})}><option value="PERCENT">{ar?"نسبة %":"Percentage %"}</option><option value="AMOUNT">{ar?"مبلغ":"Amount"}</option></select></label>
            <label>{form.vat_input_mode==="PERCENT"?(ar?"نسبة الضريبة %":"VAT rate %"):(ar?"مبلغ الضريبة":"VAT amount")}<input type="number" min="0" max={form.vat_input_mode==="PERCENT"?100:undefined} step="any" value={form.vat_input_mode==="PERCENT"?form.vat_rate:form.vat_amount} onChange={e=>setForm({...form,[form.vat_input_mode==="PERCENT"?"vat_rate":"vat_amount"]:e.target.value})}/></label>
            <label>{ar?"نسبة الضريبة القابلة للاسترداد %":"Recoverable VAT %"}<input type="number" min="0" max="100" value={form.recoverable_percent} onChange={e=>setForm({...form,recoverable_percent:e.target.value})}/><small>{ar?"الجزء غير القابل للاسترداد يضاف لتكلفة الأصل؛ السداد إجراء مستقل.":"Nonrecoverable VAT is capitalized; payment is separate."}</small></label>
          </>}
          <label>{ar?"فئة الأصل":"Asset class"}<select disabled={Boolean(edit&&form.has_financial_history)} value={form.display_class||""} onChange={e=>setForm({...form,display_class:e.target.value,classification_changed:true,asset_class_code:null,asset_type_code:null})}><option value="">{ar?"اختر الفئة":"Choose class"}</option>{ASSET_DISPLAY_CLASSES.filter(c=>c[0]!=="UNCLASSIFIED"||edit).map(c=><option key={c[0]} value={c[0]}>{c[3]} {ar?c[1]:c[2]}</option>)}</select></label>
          <label>{ar?"نوع الأصل":"Asset type"}<select disabled={Boolean((edit&&form.has_financial_history)||!form.display_class)} value={form.asset_type_code||""} onChange={e=>{const t=catalog.types.find((x:any)=>x.code===e.target.value);setForm({...form,asset_class_code:t?.class_code||null,asset_type_code:t?.code||null,asset_type:t?.default_legacy_asset_type||form.asset_type,karat:t?.default_legacy_asset_type==="SILVER"?"999":"24"});}}><option value="">{edit&&!form.asset_type_code?`${assetTypeIcon(form.asset_type)} ${label(form.asset_type)} — ${ar?"التصنيف المحفوظ":"Saved classification"}`:(ar?"اختر النوع":"Choose type")}</option>{catalog.types.filter((x:any)=>catalogDisplayClass(x)===form.display_class&&!["DEPOSIT","BOND","SUKUK_BOND"].includes(x.code)).map((x:any)=><option key={x.code} value={x.code}>{assetTypeIcon(x.code)} {ar?x.name_ar:x.name_en}</option>)}</select></label>
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
        <ActionButton icon="save" label={saving?(ar?"جار الحفظ":"Saving"):edit?(ar?"حفظ التعديلات":"Save changes"):(ar?"حفظ الأصل":"Save asset")} showLabel onClick={save} disabled={saving}/>
        {(
          <ActionButton icon="close" label={ar?"إغلاق النموذج":"Close form"} disabled={saving} onClick={()=>{setEdit(null);setRequestId("");setFormOpen(false);setForm({...empty});}}/>
        )}
      </section>}
      {msg&&<p role="status" className="muted">{msg}</p>}
      <section className="section">

        {!showingExited&&<h2>
          <span className="section-title-icon" aria-hidden="true">
            ▤
          </span>{" "}
          {ar ? "تقرير الأصول" : "Asset report"}
        </h2>}
        <div className="asset-cycle-scope">
          <label>{ar?"نطاق الدورات":"Cycle scope"}<select value={cycleScope} onChange={e=>setCycleScope(e.target.value as AssetCycleScope)} disabled={loading||!!loadError||assetScope==="ORGANIZATION"}>
            <option value="DISPLAYED">{ar?"العرض الحالي":"Current view"}</option>
            <option value="ALL">{ar?"شامل · المغلقة والمفتوحة":"Comprehensive · closed and open"}</option>
            <option value="CLOSED">{ar?"الدورات المغلقة":"Closed cycles"}</option>
            <option value="OPEN">{ar?"الدورات المفتوحة":"Open cycles"}</option>
          </select></label>
          <span className="muted">{ar?"يحدّث مؤشرات الزكاة والجدول؛ تفاصيل كل دورة وأسعارها تحت السهم.":"Updates Zakat indicators and table; each cycle’s saved prices are under the details arrow."}</span>
        </div>
        {lifecycleFilter==="DISPOSED"&&<p className="asset-exit-caption">{ar?"الإجماليات أدناه تعرض الوزن والتكلفة التاريخية قبل الاستغناء، وليست سعر السوق قبل الاستغناء. القيمة الحالية صفر، ولا تدخل هذه القيم في إجماليات الأصول النشطة.":"Weight and cost below describe the disposed quantity before disposal. Current value is zero; these historical figures are excluded from active asset totals."}</p>}
        <div className="form-grid asset-report-filters" style={{marginBottom:16}}><div className="asset-group-toggle-wrap"><span className="muted asset-filter-label">{ar?"تجميع التقرير":"Report grouping"}</span><button type="button" role="switch" aria-checked={groupBy==="TYPE"} aria-label={ar?"تجميع بحسب النوع":"Group by type"} title={ar?"يمين: فئة · يسار: نوع":"Right: class · Left: type"} className="asset-group-toggle" onPointerDown={e=>{if(e.button===0)e.currentTarget.setPointerCapture(e.pointerId);}} onPointerUp={e=>{if(e.button!==0)return;const rect=e.currentTarget.getBoundingClientRect();setGroupBy(e.clientX<rect.left+rect.width/2?"TYPE":"CLASS");}} onClick={e=>{if(e.detail===0)setGroupBy(groupBy==="TYPE"?"CLASS":"TYPE");}} onKeyDown={e=>{if(e.key==="ArrowLeft"||e.key==="ArrowRight"){e.preventDefault();setGroupBy(e.key==="ArrowLeft"?"TYPE":"CLASS");}}}><span className="asset-group-type" aria-hidden="true">{ar?"نوع":"Type"}</span><span className="asset-group-class" aria-hidden="true">{ar?"فئة":"Class"}</span><span className="asset-group-knob" aria-hidden="true"/></button></div><label>{ar?"تصفية حسب الفئة":"Filter by class"}<select value={classFilter} onChange={e=>{setClassFilter(e.target.value);setTypeFilter("ALL");}}><option value="ALL">{ar?"جميع الفئات":"All classes"}</option>{ASSET_DISPLAY_CLASSES.map(c=><option key={c[0]} value={c[0]}>{c[3]} {ar?c[1]:c[2]}</option>)}</select></label><label>{ar?"تصفية حسب النوع":"Filter by type"}<select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}><option value="ALL">{ar?"جميع الأنواع":"All types"}</option>{Array.from(new Map(filteredRows.filter(r=>classFilter==="ALL"||assetDisplayClass(r)===classFilter).map(r=>[r.asset_type_code||r.asset_type,r])).entries()).map(([key,r])=><option key={key} value={key}>{assetTypeIcon(key)} {typeName(r)}</option>)}</select></label><div className="asset-status-filter"><span className="muted asset-filter-label">{ar?"حالة الأصول":"Asset status"}</span><div className="asset-lifecycle-tabs">{([["ACTIVE",ar?"نشطة":"Active"],["SOLD",ar?"مباعة":"Sold"],["DISPOSED",ar?"مستغنى عنها":"Disposed"],["ALL",ar?"الكل":"All"]] as const).map(([key,label])=><button key={key} type="button" className={`btn ${lifecycleFilter===key?"":"secondary"}`} title={label} aria-label={label} aria-pressed={lifecycleFilter===key} onClick={()=>setLifecycleFilter(key)}><ActionIconGlyph name={key==="DISPOSED"?"delete":key==="SOLD"?"collect":key==="ALL"?"history":"post"}/>{label} <span className="pill">{lifecycleCounts[key]}</span></button>)}</div></div></div>
        {["SOLD","DISPOSED","ALL"].includes(lifecycleFilter)&&displayRows.some(r=>["SOLD","DISPOSED"].includes(r.lifecycle_status))&&!loading&&!loadError&&<div className="card section asset-exit-summary-card">{historicalSummary(displayRows,true)}</div>}
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
            <div className={`card section asset-group${showingExited?" is-exited":""}`} key={g.type}>
              <div className="page-head asset-group-head">
                <div>
                  <h3 className="asset-type-title">
                    <span className="asset-type-icon">{g.symbol}</span>
                    {g.title}{" "}
                    <span className="pill">{g.rows.length}</span>
                  </h3>
                  {!showingExited&&historicalSummary(g.rows)}
                  {!showingExited&&<div className="asset-summary">
                    <span className="sum-chip">
                      <span className="sum-icon" aria-hidden="true">
                        ◆
                      </span>
                      <span>{ar ? "إجمالي القيمة" : "Total value"}</span>
                      <strong>
                        <Money value={cv(sub)} currency={cur}/>
                      </strong>
                    </span>
                    <span className="sum-chip due">
                      <span className="sum-icon" aria-hidden="true">
                        ◉
                      </span>
                      <span>{ar ? "زكاة Snapshot" : "Snapshot Zakat"}</span>
                      <strong>
                        <Money value={cv(sd)} currency={cur}/>
                      </strong>
                    </span>
                  </div>}
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
              {!isClosed && (showingExited ? <div className="asset-exit-table-scroll"><table className="table asset-exit-table"><thead><tr>
                <th>{ar?"الأصل":"Asset"}</th><th>{ar?"النوع":"Type"}</th><th>{ar?"الوزن قبل الخروج / الكمية":"Weight / quantity before exit"}</th><th>{ar?(lifecycleFilter==="DISPOSED"?"التكلفة قبل الاستغناء":"التكلفة قبل البيع"):"Cost before exit"}</th><th>{ar?"تاريخ العملية":"Transaction date"}</th><th>{ar?"الإجراء":"Action"}</th>
              </tr></thead><tbody>{sortedRows.map(row=>{const sold=row.lifecycle_status==="SOLD";const amount=sold?row.sold_cost_value:row.disposed_cost_value;const date=(row.exit_history||[]).filter((tx:any)=>tx.kind===row.lifecycle_status).map((tx:any)=>tx.date).sort().at(-1);return <tr key={row.id}>
                <td><strong className="asset-name-cell"><span className="asset-row-icon" aria-hidden="true">{assetTypeIcon(row.asset_type_code||row.asset_type)}</span>{row.name}</strong></td><td>{typeName(row)}</td><td>{fmt(Number(sold?row.sold_quantity:row.disposed_quantity)||0)} {["GOLD","SILVER"].includes(row.asset_type)?(ar?"غرام":"g"):row.unit||""}</td><td>{amount==null?"—":<Money value={Number(amount)} currency={cur}/>}</td><td>{date||"—"}</td><td>{renderAssetCell("action",row)}</td>
              </tr>;})}</tbody></table></div> : (
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
                                  title={columnLabel(column)} aria-label={columnLabel(column)} className={`asset-sort${active ? " active" : ""}`}
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
              ))}
            </div>
          );
        })}
      </section>
      {!showingExited && retroPending.length > 0 && (
        <aside className="notice asset-report-notice" role="note">
          <strong>{ar ? "أصول غير مشمولة باحتساب الدورة المعروضة" : "Assets outside the displayed cycle assessment"}</strong>
          {pendingInOpen > 0 && <p className="muted">{ar
            ? `${pendingInOpen} من الأصول غير مشمولة باحتساب الدورة المعروضة، ولها احتساب ضمن الدورة المفتوحة. اختر «شامل» أو «الدورات المفتوحة» لعرض احتسابها.`
            : `${pendingInOpen} asset(s) are outside the displayed cycle assessment and have a saved calculation in an open cycle. Choose Comprehensive or Open cycles to view it.`}</p>}
          {retroPending.length > pendingInOpen && <p className="muted">{ar
            ? `${retroPending.length - pendingInOpen} من الأصول لها بيانات حول محفوظة ولم تُشمل باحتساب ضمن النطاق المختار. راجعها عند احتساب الدورة المفتوحة أو الجديدة.`
            : `${retroPending.length - pendingInOpen} asset(s) have saved Hawl dates but no assessment in this scope. Review them when calculating an open or new cycle.`}</p>}
          <small>{ar ? "الاحتساب النهائي للدورة المغلقة وأسعاره يبقيان محفوظين." : "The closed cycle’s final assessment and prices remain preserved."}</small>
        </aside>
      )}
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
  amount: React.ReactNode;
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
  if(c.cycle_calculations) return <div className="zakat-result-compact">
    <strong>{amount}</strong> <span className="pill">{ar?"حسب نطاق الدورات":"Cycle scope"}</span>
    <details className="asset-valuation-details"><summary aria-label={ar?"تفاصيل الدورات وأسعار الاحتساب":"Cycle details and saved prices"} title={ar?"تفاصيل الدورات وأسعار الاحتساب":"Cycle details and saved prices"}><span aria-hidden="true">▸</span></summary><div className="asset-valuation-content">
      {c.cycle_calculations.map((cycle:any)=><section key={cycle.assessment_id} className="asset-cycle-detail">
        <strong>{ar?"الدورة":"Cycle"} #{cycle.cycle_number} · {cycle.cycle_closed?(ar?"مغلقة · سعر مثبت":"Closed · frozen price"):(ar?"مفتوحة · تقدير":"Open · estimate")}</strong>
        <div><bdi>{cycle.cycle_start_date}</bdi> → <bdi>{cycle.cycle_end_date}</bdi></div>
        <div>{ar?"المحتسب":"Assessed"}: <Money value={cycle.zakat_amount} currency={cycle.currency}/> · {ar?"المسدّد":"Paid"}: <Money value={cycle.paid_amount} currency={cycle.currency}/> · {ar?"المتبقي":"Remaining"}: <Money value={cycle.remaining_amount} currency={cycle.currency}/></div>
        {cycle.lots.map((lot:any)=><div key={lot.id??lot.lot_id}>{ar?"الكمية":"Quantity"}: {fmt(lot.quantity)} · {ar?"السعر المحفوظ":"Saved price"}: {lot.valuation_price==null?"—":<Money value={lot.valuation_price} currency={lot.valuation_currency} precision={6}/>}</div>)}
      </section>)}
    </div></details>
  </div>;
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
          {ar ? "الكمية" : "Quantity"}: {fmt(l.quantity)} · {ar ? "السعر" : "Price"}: {l.valuation_price==null?"—":<Money value={l.valuation_price} currency={l.valuation_currency} precision={6}/>}
          <br/>{ar ? "النقاوة" : "Purity"}: {l.valuation_snapshot?.purity??"—"} · {ar ? "سعر الصرف" : "FX"}: {l.fx_rate??"—"}
          <br/>{ar ? "المصدر" : "Source"}: {l.valuation_snapshot?.priceSource??c.snapshot?.priceSource??"—"}
        </div>)}
        <div className="muted">{ar ? "مدفوعات تاريخية لكل الدورات" : "Historical payments across cycles"}: <Money value={c.historical_paid_amount} currency={c.currency}/></div>
      </div></details>
    </div>
  );
}
function K({
  t,
  v,
  i,
  tone,
  source, percent, percentLabel, disabled, expanded, detailsLabel, onClick,
}: {
  t: string;
  v: string;
  i: string;
  tone: string;
  source: string;
  percent:number|null;percentLabel:string;disabled:boolean;expanded:boolean;detailsLabel:string;onClick:()=>void;
}) {
  return (
    <button type="button" className={`card asset-kpi tone-${tone}`} disabled={disabled} onClick={onClick} aria-expanded={expanded} aria-controls={expanded?"asset-indicator-details":undefined} title={detailsLabel}>
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
      <small className="asset-kpi-ratio">{percent==null?"—":`${new Intl.NumberFormat("en-US",{maximumFractionDigits:1}).format(percent)}%`} · {percentLabel}</small>
      <span className="asset-kpi-accent" aria-hidden="true" style={{"--asset-kpi-percent":`${Math.min(100,Math.abs(percent??0))}%`} as import("react").CSSProperties}/>
    </button>
  );
}
