"use client";
import TopbarOrganizationControls from '@/components/TopbarOrganizationControls';
import {useWorkspaceScope} from '@/hooks/useWorkspaceScope';
import Link from "next/link";
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
    asset_type: "OTHER",
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
  const [assetScope,setAssetScope]=useWorkspaceScope();
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
  useEffect(()=>{setScopeEntityId("");setScopeCostCenterId("");setClassFilter("ALL");setTypeFilter("ALL");setDetailAsset(null);setOperationAsset(null);setFormOpen(false);setEdit(null)},[assetScope]);
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
  return (
    <main className={`container assets-page assets-page-${design}`}><CurrencyScope currency={baseCurrency} organizationId={assetScope==="ORGANIZATION"?scopeOrgId:undefined}/>
      <style>{`.asset-detail-type{font-size:11px;margin-inline-start:8px}.asset-owner-switch{display:flex;gap:6px;flex-wrap:wrap}.asset-scope-bar{display:grid;grid-template-columns:minmax(180px,.8fr) minmax(220px,1.2fr) minmax(200px,1fr) minmax(200px,1fr);gap:12px;align-items:end;padding:16px 18px}.asset-scope-bar label{display:grid;gap:6px;font-size:12px;font-weight:700}.asset-scope-bar select{width:100%}.asset-scope-title{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:12px}.asset-scope-title strong{font-size:14px}.asset-scope-title span{font-size:11px;color:var(--muted)}@media(max-width:900px){.asset-scope-bar{grid-template-columns:1fr 1fr}}@media(max-width:620px){.asset-scope-bar{grid-template-columns:1fr}}.asset-report-table[data-size=compact] th,.asset-report-table[data-size=compact] td{padding:7px 8px;font-size:11px}.asset-report-table[data-size=normal] th,.asset-report-table[data-size=normal] td{padding:12px;font-size:13px}.asset-report-table[data-size=wide] th,.asset-report-table[data-size=wide] td{padding:17px 20px;font-size:14px}.asset-report-table th{min-width:105px;white-space:nowrap}.asset-report-table th[data-column=asset]{min-width:180px}.hawl-badges{display:inline-flex;gap:5px;white-space:nowrap}.hawl-cycle,.hawl-days{display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border-radius:8px}.hawl-cycle{background:var(--brand-surface-soft);color:var(--brand-primary)}.hawl-days{background:var(--brand-surface-soft);color:var(--brand-text)}.zakat-formula{margin-top:10px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--brand-surface-soft);color:var(--brand-text);min-width:280px}.zakat-formula-title{font-weight:700;margin-bottom:5px}.zakat-formula-eq{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;direction:ltr;text-align:left;white-space:normal;line-height:1.7}.zakat-formula-result{font-weight:800;margin-top:5px}`}</style>
      <div className="asset-page-header">
        <div className="asset-page-heading"><h1><span className="page-title-icon" aria-hidden="true">▥</span> {ar?"الأصول":"Assets"}</h1></div>
        <AssetsPageToolbar ar={ar} onAdd={()=>setFormOpen(true)}/>
      </div>
      <div className="asset-page-subtitle"><p className="muted">{ar?"نطاق الدورات المحدد ينعكس على مؤشرات الزكاة والجدول. الشامل يجمع النهائي المثبّت وآخر تقدير للمفتوحة، والسداد يُخصم من دورته.":"Cycle scope updates Zakat indicators and the table. Comprehensive combines frozen finals and latest open estimates; payments reduce their own cycle."}</p><span className="pill">{ar?"عملة الأساس: ":"Base currency: "}{baseCurrency}</span></div>
      {assetScope==='ORGANIZATION'&&<TopbarOrganizationControls>
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
      </TopbarOrganizationControls>}
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
        <div style={{overflowX:'auto'}}><table className="table"><thead><tr><th>{ar?"الأصل":"Asset"}</th><th>{ar?"النوع":"Type"}</th><th>{selectedMetric.title}</th></tr></thead><tbody>{selectedMetric.r…20425 tokens truncated…ame="ed-panel">
      <header>
        <h2>{title}</h2>
        <Link href={href}>
          {action}
          <span aria-hidden="true"> ←</span>
        </Link>
      </header>
      {children}
    </section>
  );
}

export default function ElegantDashboard({
  d,
  locale,
  currency,
}: {
  d: any;
  locale: string;
  currency: string;
}) {
  const ar = locale === "ar",
    t = (a: string, e: string) => (ar ? a : e);
  const money = useDisplayMoney();
  const amount = (v: unknown) => <Money value={v} currency="SAR"/>;
  const path = (p: string) => `/${locale}/${p}`;
  const c = d.activeCycle;
  const progress = hawlProgress(
    c?.hawl_start_date,
    c?.hawl_due_date,
    d.asOfDate,
  );
  const paid = Math.max(0, Math.min(100, Number(d.zakatPaymentPct) || 0));
  const segments = allocationSegments(d.assetAllocation || []);
  const gradient = segments.length
    ? `conic-gradient(${segments.map((s, i) => `var(--asset-chart-${i % 6 + 1}, ${colors[i % colors.length]}) ${s.start}% ${s.end}%`).join(",")})`
    : "#e7efec";
  // Each bar is a saved assessment, not an invented annual observation.
  const history = [...(d.latestAssessments || [])].slice(0, 6).reverse();
  const maxDue = Math.max(
    1,
    ...history.map((x: any) => Number(x.zakat_due) || 0),
  );
  const health = d.dataHealth || {};
  const missing = d.loadError || Object.values(health).some((v) => v === false);
  const assessmentKnown =
    !d.loadError && health.assessments !== false && health.cycles !== false;
  const paymentKnown = assessmentKnown && health.allocations !== false;
  const weight = (v: unknown) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(Number(v) || 0);
  const metrics = [
    {
      key: "assets",
      label: t("إجمالي الأصول", "Total assets"),
      value: d.totalCurrentSar,
      known: !d.loadError,
      note: `${d.assetCount || 0} ${t("أصل نشط", "active assets")}`,
      percent: Number(d.totalCurrentSar) > 0 ? 100 : 0,
    },
    {
      key: "pool",
      label: t("الوعاء الزكوي", "Zakatable amount"),
      value: d.zakatableValueSar,
      known: assessmentKnown,
      note: d.latestAssessmentDate
        ? `${t("آخر احتساب", "Assessed")} · ${d.latestAssessmentDate}`
        : t("وفق الأصول المسجلة", "Based on registered assets"),
      percent:
        Number(d.totalCurrentSar) > 0
          ? Math.min(
              100,
              (Number(d.zakatableValueSar || 0) / Number(d.totalCurrentSar)) *
                100,
            )
          : 0,
    },
    {
      key: "due",
      label: t("الاستحقاق النهائي المثبت", "Frozen final liability"),
      value: d.explicitZakahDueSar,
      known: assessmentKnown,
      note: `${t("جميع الدورات النهائية · أسعار مثبتة", "All final cycles · frozen prices")} · ${Number(d.zakatableValueSar) > 0 ? ((Number(d.explicitZakahDueSar || 0) / Number(d.zakatableValueSar)) * 100).toFixed(2) : "0.00"}%`,
      percent:
        Number(d.zakatableValueSar) > 0
          ? Math.min(
              100,
              (Number(d.explicitZakahDueSar || 0) /
                Number(d.zakatableValueSar)) *
                100,
            )
          : 0,
    },
    {
      key: "paid",
      label: t("المسدّد حتى الآن", "Paid so far"),
      value: d.allocatedZakahPaidSar,
      known: paymentKnown,
      note: `${paid.toFixed(1)}% ${t("من المستحق", "of amount due")}`,
      percent: paid,
    },
    {
      key: "clock",
      label: t("المتبقي النهائي للسداد", "Final outstanding balance"),
      value: d.remainingZakahSar,
      known: paymentKnown,
      note: t("بعد طرح السداد المخصص للدورات النهائية", "After payments allocated to final cycles"),
      percent: Number(d.explicitZakahDueSar) > 0 ? 100 - paid : 0,
    },
    {
      key: "open", label:t("تقدير الدورة المفتوحة", "Open-cycle estimate"),value:d.openCycleEstimateSar,known:assessmentKnown,
      note:t("آخر احتساب فقط · قابل لإعادة الاحتساب", "Latest snapshot only · recalculable"),percent:0,
    },
    {
      key: "asof",label:t("الإجمالي حتى آخر احتساب", "Balance as of latest assessment"),value:d.asOfZakahBalanceSar,known:paymentKnown,
      note:`${t("المتبقي النهائي + التقدير المفتوح", "Final balance + open estimate")} · ${t("رصيد مرحّل", "Carried credit")}: ${money(d.carriedZakahCreditSar)}`,percent:0,
    },
    {
      key: "metals",
      label: t("إجمالي وزن المعادن", "Total metal weights"),
      value: 0,
      known: !d.loadError && health.assets !== false,
      note: t("الأصول النشطة فقط · دون المباعة والمستغنى عنها", "Active holdings only · excludes sold and disposed assets"),
      percent: null,
    },
  ];
  const steps = [
    {
      title: t("تسجيل الأصول", "Assets recorded"),
      detail: `${d.assetCount || 0} ${t("أصل نشط", "active assets")}`,
      done: Number(d.assetCount) > 0,
    },
    {
      title: t("الاحتساب الزكوي", "Zakat assessment"),
      detail:
        d.latestAssessmentDate || t("لا يوجد احتساب بعد", "Not assessed yet"),
      done: !!d.latestAssessmentDate && health.assessments !== false,
    },
    {
      title: t("السداد", "Payments"),
      detail: paymentKnown
        ? `${money(d.allocatedZakahPaidSar)}`
        : "—",
      done: paymentKnown && Number(d.allocatedZakahPaidSar) > 0,
    },
    {
      title: t("اكتمال السداد", "Payment completed"),
      detail: paymentKnown
        ? `${t("المتبقي", "Remaining")}: ${money(d.remainingZakahSar)}`
        : "—",
      done:
        paymentKnown &&
        Number(d.explicitZakahDueSar) > 0 &&
        Number(d.remainingZakahSar) === 0,
    },
  ];
  return (
    <div className="ed-dashboard" dir={ar ? "rtl" : "ltr"}>
      <header className="ed-welcome">
        <div>
          <p className="ed-eyebrow">ZAKATFLOW</p>
          <h1>{t("نظرة عامة على زكاتك", "Your Zakat overview")}</h1>
          <p>
            {t(
              "أصولك، استحقاقاتك، وخطوتك التالية في مكان واحد.",
              "Your assets, obligations and next steps in one place.",
            )}
          </p>
        </div>
        <div className="ed-cycle-control">
          <Link className="ed-cycle-link" href={path("assessments")}>
            <Icon kind="clock" />
            {c
              ? `${t("الدورة الزكوية", "Zakat cycle")} #${c.cycle_no}`
              : t("إعداد الدورة الزكوية", "Set up Zakat cycle")}
            <span aria-hidden="true">‹</span>
          </Link>
          <small>
            <bdi>{c?.hawl_start_date || "—"}</bdi> —{" "}
            <bdi>{c?.hawl_due_date || "—"}</bdi>
          </small>

        </div>
      </header>
      {missing && (
        <p className="ed-warning" role="status">
          {t(
            "تعذر تحميل بعض البيانات. المؤشرات غير المتاحة معروضة بشرطة، وليست رصيدًا صفريًا.",
            "Some data could not be loaded. Unavailable indicators show a dash, not a zero balance.",
          )}
        </p>
      )}
      <section
        className="ed-kpis"
        aria-label={t("المؤشرات المالية", "Financial indicators")}
      >
        {metrics.map((m) => (
          <article key={m.key} className={`ed-metric ed-metric-${m.key}`}>
            <div className="ed-metric-heading">
              <h2>{m.label}</h2>
              <span className="ed-icon">
                <Icon kind={m.key} />
              </span>
            </div>
            {m.key === "metals" && m.known ? (
              <dl className="ed-metal-weights">
                {[{ label: t("الذهب", "Gold"), value: d.goldWeightKg }, { label: t("الفضة", "Silver"), value: d.silverWeightKg }].map((metal) => (
                  <div key={metal.label}>
                    <dt>{metal.label}</dt>
                    <dd><bdi>{weight(metal.value)} <span className="ed-unit">{t("كجم", "kg")}</span></bdi></dd>
                  </div>
                ))}
              </dl>
            ) : (
              <strong className="ed-number">{m.known ? amount(m.value) : "—"}</strong>
            )}
            <p>
              {m.known ? m.note : t("البيانات غير متاحة", "Data unavailable")}
            </p>
            {m.percent != null && m.known && (
              <progress max={100} value={m.percent} aria-label={m.label} />
            )}
          </article>
        ))}
      </section>
      {Number(d.priorCyclesUnpaidSar) > 0 && (
        <aside className="ed-warning">
          {t("رصيد مستحق من دورات سابقة", "Prior-cycle balance")}:{" "}
          {amount(d.priorCyclesUnpaidSar)}{" "}
          <Link href={path("payments")}>
            {t("مراجعة السداد", "Review payments")} ←
          </Link>
        </aside>
      )}
      <div className="ed-grid">
        <Panel
          title={t("توزيع الأصول", "Asset allocation")}
          href={path("assets")}
          action={t("عرض الكل", "View all")}
        >
          <div className="ed-allocation">
            <div
              className="ed-ring"
              style={{ background: gradient }}
              role="img"
              aria-label={t(
                "توزيع قيمة الأصول حسب الفئة؛ التفاصيل في القائمة المجاورة",
                "Asset value by category; details in adjacent list",
              )}
            >
              <div>
                <strong>
                  <bdi>{money(d.totalCurrentSar)}</bdi>
                </strong>

              </div>
            </div>
            <ul className="ed-legend">
              {segments.map((s, i) => (
                <li key={s.type}>
                  <span
                    className="ed-dot"
                    style={{ background: `var(--asset-chart-${i % 6 + 1}, ${colors[i % colors.length]})` }}
                  />
                  <span>{types[s.type]?.[ar ? 0 : 1] || s.type}</span>
                  <bdi>{money(s.value)}</bdi>
                  <small>
                    <bdi>{s.percent.toFixed(1)}%</bdi>
                  </small>
                </li>
              ))}
            </ul>
          </div>
          {!segments.length && (
            <p className="ed-empty">
              {t(
                "لا توجد قيم موجبة مسجلة لعرض التوزيع.",
                "No positive asset values available.",
              )}
            </p>
          )}
        </Panel>
        <Panel
          title={t("اتجاه الزكاة", "Zakat trend")}
          href={path("reports")}
          action={t("عرض التقرير", "View report")}
        >
          <p className="ed-caption">
            {t(
              "المستحق في آخر الاحتسابات المحفوظة",
              "Due across recent saved assessments",
            )}
          </p>
          {health.assessments === false || !history.length ? (
            <p className="ed-empty">
              {t(
                "يظهر الاتجاه بعد حفظ احتساب زكوي.",
                "Save an assessment to see the trend.",
              )}
            </p>
          ) : (
            <div
              className="ed-chart"
              aria-label={t(
                "مبالغ الزكاة بحسب تاريخ الاحتساب",
                "Zakat by assessment date",
              )}
            >
              {history.map((x: any) => (
                <div className="ed-bar-column" key={x.id}>
                  <div className="ed-bar-space">
                    <div
                      className="ed-bar"
                      style={{
                        height: `${(Math.max(0, Number(x.zakat_due) || 0) / maxDue) * 100}%`,
                      }}
                    />
                  </div>
                  <Money value={x.zakat_due} currency={x.currency || "SAR"}/>
                  <time dateTime={x.assessment_date}>{x.assessment_date}</time>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel
          title={t("تقدم السنة الزكوية", "Zakat year progress")}
          href={path("lots")}
          action={t("عرض التفاصيل", "View details")}
        >
          {progress ? (
            <>
              <div className="ed-hawl">
                <div
                  className="ed-ring ed-hawl-ring"
                  style={{
                    background: `conic-gradient(var(--asset-chart-1, #087653) ${progress.percent}%, var(--asset-chart-6, #dcefe6) 0)`,
                  }}
                >
                  <div>
                    <strong>{Math.round(progress.percent)}%</strong>
                  </div>
                </div>
                <div>
                  <strong className="ed-days">
                    {progress.elapsed} <small>{t("يومًا", "days")}</small>
                  </strong>
                  <p>
                    {t("من أصل", "of")} {progress.total} {t("يومًا", "days")}
                  </p>
                </div>
              </div>
              <div className="ed-timeline">
                <div>
                  <span />
                  {t("البداية", "Start")}
                  <time>{c.hawl_start_date}</time>
                </div>
                <div>
                  <span />
                  {t("اليوم", "Today")}
                  <time>{d.asOfDate}</time>
                </div>
                <div>
                  <span />
                  {t("الاستحقاق", "Due")}
                  <time>{c.hawl_due_date}</time>
                </div>
              </div>
            </>
          ) : (
            <p className="ed-empty">
              {t(
                "حدّد بداية الحول وتاريخ الاستحقاق لعرض التقدم.",
                "Set the Hawl start and due date to see progress.",
              )}
            </p>
          )}
        </Panel>
        <Panel
          title={t("أحدث المدفوعات", "Recent payments")}
          href={path("payments")}
          action={t("عرض الكل", "View all")}
        >
          <ul className="ed-list">
            {(health.payments === false ? [] : d.recentPayments || [])
              .slice(0, 5)
              .map((p: any) => (
                <li key={p.id}>
                  <span className="ed-list-icon">
                    <Icon kind="paid" />
                  </span>
                  <div>
                    <span>
                      {p.beneficiary || t("دفعة زكاة", "Zakat payment")}
                    </span>
                    <time>{p.payment_date}</time>
                  </div>
                  <strong>
                    <bdi>
                      <Money value={p.amount} currency={p.currency}/>
                    </bdi>
                  </strong>
                </li>
              ))}
          </ul>
          {(!d.recentPayments?.length || health.payments === false) && (
            <p className="ed-empty">
              {health.payments === false
                ? t("المدفوعات غير متاحة حاليًا", "Payments unavailable")
                : t("لا توجد مدفوعات مسجلة بعد", "No payments recorded yet")}
            </p>
          )}
        </Panel>
        <Panel
          title={t("أهم الأصول", "Top assets")}
          href={path("assets")}
          action={t("عرض الأصول", "View assets")}
        >
          <ul className="ed-list">
            {(d.topAssets || []).slice(0, 5).map((a: any, i: number) => (
              <li key={a.id}>
                <span className="ed-list-icon" style={{ color: colors[i] }}>
                  <Icon kind="assets" />
                </span>
                <div>
                  <span>{a.name}</span>
                  <small>{types[a.type]?.[ar ? 0 : 1] || a.type}</small>
                </div>
                <strong>{amount(a.value)}</strong>
                <small>
                  <bdi>
                    {Number(d.totalCurrentSar) > 0
                      ? (
                          (Number(a.value) / Number(d.totalCurrentSar)) *
                          100
                        ).toFixed(1)
                      : "—"}
                    %
                  </bdi>
                </small>
              </li>
            ))}
          </ul>
          {!d.topAssets?.length && (
            <p className="ed-empty">
              {t(
                "أضف أصلًا لعرض محفظتك هنا.",
                "Add an asset to see your portfolio here.",
              )}
            </p>
          )}
        </Panel>
        <Panel
          title={t("حالة الزكاة", "Zakat status")}
          href={path("assessments")}
          action={t("عرض التفاصيل", "View details")}
        >
          <ol className="ed-steps">
            {steps.map((s, i) => (
              <li key={s.title} className={s.done ? "is-done" : ""}>
                <span className="ed-step-icon" aria-hidden="true">
                  {s.done ? "✓" : i + 1}
                </span>
                <div>
                  <strong>{s.title}</strong>
                  <small>{s.detail}</small>
                </div>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
      <p className="ed-footnote">
        {t(
          "القيم حسب البيانات المسجلة. الاحتساب والسداد مرتبطان بالدورة الزكوية الحالية.",
          "Values reflect recorded data. Assessment and payments relate to the current Zakat cycle.",
        )}
        {currency === "USD" &&
          t(
            " · تحويل العرض: 1 USD = 3.75 SAR.",
            " · Display conversion: 1 USD = 3.75 SAR.",
          )}
      </p>
    </div>
  );
}
