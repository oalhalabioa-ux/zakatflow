"use client";
import YaqeenFilterSelect from "@/components/YaqeenFilterSelect";
import ActionButton,{ActionIconGlyph} from "@/components/ActionButton";
import DetailsDialog from "@/components/assets/DetailsDialog";
import AssetOperationDetails from "@/components/assets/AssetOperationDetails";
import {operationColumns,defaultOperationColumns,operationReportAmounts,operationColumnValue,operationFilteredSummary,operationReportState,operationStateLabel,operationTypeLabel,operationExportRows,type OperationColumn} from "@/lib/asset-operation-report";
import {vatReportPrintHtml} from "@/lib/vat-report-print";
import {reportCsv} from "@/lib/vat-financial-reports";
import {useParams} from "next/navigation";
import {Money,useDisplayMoney} from "@/components/DisplayCurrency";
import { useEffect, useMemo, useState } from "react";
type SortKey = "date" | "asset" | "type" | "value" | "currency";
type SortDirection = "asc" | "desc";
const TRANSACTION_TYPES = [
  ["ADD", "إضافة"],
  ["OPENING_BALANCE", "رصيد افتتاحي"],
  ["PURCHASE", "شراء"],
  ["SALE", "بيع"],
  ["WITHDRAWAL", "سحب"],
  ["ADJUSTMENT", "تسوية"],
] as const;
const numberFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const integerFormatter = new Intl.NumberFormat("en-US");

function assetTypeLabel(asset: any) { return asset?.asset_type_code || asset?.asset_class_code || asset?.asset_type || '—'; }
function assetOwnerLabel(asset: any) { return asset?.ownership_scope === 'ORGANIZATION' ? 'مؤسسي' : 'شخصي'; }

function assetName(row: any) {
  return row.asset_accounts?.name || row.asset_account_id || "—";
}

function transactionTypeLabel(type: string) {
  return TRANSACTION_TYPES.find(([value]) => value === type)?.[1] || type;
}

export default function Transactions() {
  const money=useDisplayMoney();const params=useParams();const ar=params.locale!=="en";
  const [selectedOperation,setSelectedOperation]=useState<any>(null),[sourceFilter,setSourceFilter]=useState(''),[stateFilter,setStateFilter]=useState(''),[reportColumns,setReportColumns]=useState<OperationColumn[]>([...defaultOperationColumns]);
  const t=(a:string,e:string)=>ar?a:e;
  const [rows, setRows] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [sort, setSort] = useState<{
    key: SortKey;
    direction: SortDirection;
  }>({ key: "date", direction: "desc" });
  const [showDeleted,setShowDeleted]=useState(false);
  const [query, setQuery] = useState("");
  const [sourceTransactionId,setSourceTransactionId]=useState('');
  useEffect(()=>{setSourceTransactionId(new URLSearchParams(window.location.search).get('transaction_id')||'')},[]);
  const [typeFilter, setTypeFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState<any>({
    asset_account_id: "",
    transaction_type: "ADD",
    transaction_date: new Date().toISOString().slice(0, 10),
    quantity: 1,
    currency: "SAR",
    unit_price: "",
    gross_value: "",
    base_currency: "SAR",
    fx_rate: 1,
    base_value: "",
    notes: "",
    adjustment_direction: "IN",
    proceeds_account_id: "",
    disposal_zero_value: false,
  });
  const [catalog,setCatalog]=useState<any>({});
  const [requestId,setRequestId]=useState(()=>crypto.randomUUID());
  const selectedAsset=assets.find(a=>a.id===form.asset_account_id);
  const ownerBase=selectedAsset?.ownership_scope==="ORGANIZATION"?catalog.organizations?.find((o:any)=>o.id===selectedAsset.organization_id)?.base_currency:catalog.base_currency;
  const [entryOpen, setEntryOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const load = async (deleted=showDeleted) => {
    setLoading(true);
    setLoadError("");
    try {
      const [transactionsResponse, assetsResponse,catalogResponse] = await Promise.all([
        fetch(`/api/transactions${deleted?"?deleted=true":""}`),
        fetch("/api/assets"),
        fetch("/api/assets/catalog"),
      ]);
      if (!transactionsResponse.ok || !assetsResponse.ok || !catalogResponse.ok)
        throw new Error("LOAD_FAILED");
      const [transactions, assetRows] = await Promise.all([
        transactionsResponse.json(),
        assetsResponse.json(),
      ]);
      const catalogData=await catalogResponse.json();setCatalog(catalogData);
      setRows(transactions);
      setAssets(assetRows);
    } catch {
      setRows([]);
      setAssets([]);
      setLoadError("تعذر تحميل سجل المعاملات. حاول تحديث الصفحة.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const [deletingId,setDeletingId]=useState<string|null>(null);
  async function restoreTransaction(row:any){setDeletingId(row.id);try{const r=await fetch("/api/transactions",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:row.id})});if(!r.ok)throw Error("تعذر استعادة العملية");setMsg("تمت استعادة العملية");await load();}catch(e:any){setMsg(e.message);}finally{setDeletingId(null);}}
  async function removeTransaction(row:any){
    if(!confirm("حذف هذه العملية غير المرتبطة؟ سيُحفظ سجل الحذف للمراجعة."))return;
    setDeletingId(row.id);setMsg("");
    try{
      const response=await fetch("/api/transactions",{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({id:row.id})});
      const result=await response.json();
      if(!response.ok)throw Error(result.error?.includes("TRANSACTION_DELETE_LINKED")?"العملية مرتبطة بأثر مالي أو أصل؛ لا يمكن حذفها.":"تعذر حذف العملية.");
      setMsg("تم حذف العملية غير المرتبطة وحفظ سجلها للمراجعة.");await load();
    }catch(error:any){setMsg(error.message);}finally{setDeletingId(null);}
  }
  async function save() {
    if (saving || !form.asset_account_id) return;
    setSaving(true);
    try {
    setMsg("جار الحفظ…");
    const r = await fetch("/api/transactions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...form,request_id:requestId,funding_account_id:form.funding_account_id||null,counterparty_id:form.counterparty_id||null,due_date:form.due_date||null,vat_amount:Number(form.vat_amount||0),recoverable_percent:Number(form.recoverable_percent??100),
        quantity: Number(form.quantity),
        unit_price: form.unit_price === "" ? undefined : Number(form.unit_price),
        gross_value: Number(form.gross_value),
        base_value: Number(form.base_value),
      }),
    });
    setMsg(
      r.ok
        ? selectedAsset?.ownership_scope==="ORGANIZATION"?"تم حفظ مسودة الشراء. أكمل الاعتماد والترحيل من التفاصيل والإجراءات.":"تم حفظ المعاملة وتحديث رصيد الأصل."
        : (await r.json()).error || "خطأ",
    );
    if (r.ok) {setRequestId(crypto.randomUUID());setEntryOpen(false);setForm((x:any)=>({...x,asset_account_id:"",quantity:1,unit_price:"",gross_value:"",base_value:"",proceeds_account_id:"",funding_account_id:"",counterparty_id:"",vat_amount:"",notes:""}));await load();}
    } catch { setMsg("تعذر حفظ المعاملة. حاول مرة أخرى."); } finally { setSaving(false); }
  }
  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ar");
    return rows.filter((row) => {
      const matchesQuery =
        !normalizedQuery ||
        `${assetName(row)} ${row.reference??row.metadata?.invoice_reference??""} ${row.counterparty_name??""}`.toLocaleLowerCase("ar").includes(normalizedQuery) ||
        String(row.transaction_type || "")
          .toLocaleLowerCase("ar")
          .includes(normalizedQuery) ||
        transactionTypeLabel(row.transaction_type)
          .toLocaleLowerCase("ar")
          .includes(normalizedQuery);
      const matchesType =
        !typeFilter || (row.operation_type??row.transaction_type) === typeFilter;
      const date = String(row.transaction_date || "");
      const matchesFrom = !dateFrom || date >= dateFrom;
      const matchesTo = !dateTo || date <= dateTo;
      return (!sourceTransactionId || row.id === sourceTransactionId) && matchesQuery && matchesType && matchesFrom && matchesTo && (!sourceFilter||row.source_label===sourceFilter) && (!stateFilter||operationReportState(row)===stateFilter);
    });
  }, [rows, query, typeFilter, dateFrom, dateTo, sourceTransactionId,sourceFilter,stateFilter]);
  const sortedRows = useMemo(() => {
    const valueOf = (row: any) => {
      if (sort.key === "date") return String(row.transaction_date || "");
      if (sort.key === "asset") return String(assetName(row));
      if (sort.key === "type") return String(row.transaction_type || "");
      if (sort.key === "currency") return String(row.base_currency || "");
      const base = Number(row.base_value) || 0; return row.metadata?.asset_effect_base != null ? Number(row.metadata.asset_effect_base) : base;
    };
    return [...filteredRows].sort((a, b) => {
      const left = valueOf(a);
      const right = valueOf(b);
      const compared =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left).localeCompare(String(right), "ar", {
              numeric: true,
              sensitivity: "base",
            });
      return sort.direction === "asc" ? compared : -compared;
    });
  }, [filteredRows, sort]);
  const summary=useMemo(()=>operationFilteredSummary(filteredRows),[filteredRows]);
  function exportReport(kind:'PDF'|'CSV'){
    if(kind==='CSV'){const url=URL.createObjectURL(new Blob([reportCsv(operationExportRows(sortedRows,ar))],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='asset-operations.csv';link.click();URL.revokeObjectURL(url);return;}
    const selected=[...reportColumns];if(!selected.includes('currency'))selected.push('currency');
    const win=window.open('','_blank');if(!win){setMsg(t('اسمح بفتح نافذة الطباعة','Allow the print window'));return;}win.opener=null;
    const columns=selected.map(key=>operationColumns.find(c=>c[0]===key)![ar?1:2]);
    win.document.write(vatReportPrintHtml(t('تقرير عمليات الأصول','Asset operations report'),`${dateFrom||'—'} → ${dateTo||'—'} · ${sortedRows.length} ${t('عملية','operations')}`,columns,sortedRows.map(row=>selected.map(key=>operationColumnValue(row,key,ar))),ar,'#24616f').replace('الفواتير والتسويات المعتمدة · المبالغ حسب عملة التقرير','العمليات وفق الفلاتر والحالة الظاهرة · المبالغ بالعملات المسجلة').replace('Posted invoices and settlements · Amounts in report currency','Operations by active filters and status · Recorded currencies'));win.document.close();
  }
  const hasFilters = Boolean(sourceTransactionId || query || typeFilter || dateFrom || dateTo || sourceFilter || stateFilter);
  const displayMetric = (value: string) =>
    loading ? "…" : loadError ? "—" : value;
  const changeSort = (key: SortKey) => {
    setSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  };
  const sortMark = (key: SortKey) =>
    sort.key === key ? (sort.direction === "asc" ? "↑" : "↓") : "↕";
  return (
    <main className="container transactions-page">
      <div className="page-head transaction-page-head">
        <div>
          <span className="pill">سجل العمليات</span>
          <h1>
            <span className="page-title-icon" aria-hidden="true">
              ⇄
            </span>{" "}
            سجل المعاملات
          </h1>
          <p className="muted">
            تابع حركة الأصول وابحث في العمليات. أضف المعاملة بعد تحديد الأصل ونوع الحركة وقيمتها.
          </p>
        </div>
        <ActionButton icon="plus" label={t("إضافة معاملة","Add transaction")} aria-expanded={entryOpen} aria-controls="transaction-entry" onClick={()=>{setEntryOpen(!entryOpen);setMsg("");}}/>
      </div>
      {msg && !entryOpen && <p role="status" className="notice">{msg}</p>}
      {loadError && <div className="notice">{loadError}</div>}
      <section className="transaction-kpis section">
        <TransactionKpi
          icon="▤"
          label="عدد المعاملات"
          value={displayMetric(integerFormatter.format(summary.count))}
        />
        <TransactionKpi
          icon="◆"
          label="صافي أثر الأصول المرحل"
          value={displayMetric(summary.net==null?"عملات متعددة":money(summary.net,summary.currency||catalog.base_currency||"SAR"))}
        />
        <TransactionKpi
          icon="▦"
          label="الأصول المتحركة"
          value={displayMetric(integerFormatter.format(summary.assets))}
        />
        <TransactionKpi
          icon="◷"
          label="آخر حركة"
          value={displayMetric(summary.latest)}
        />
      </section>
      {entryOpen && <div id="transaction-entry" className="card section transaction-entry-card">
        <div className="transaction-section-head">
          <div>
            <span className="transaction-ledger-kicker">إدخال حركة جديدة</span>
            <h2>إضافة معاملة</h2>
          </div>
          <ActionButton icon="close" label={t("إغلاق النموذج","Close form")} disabled={saving} onClick={()=>setEntryOpen(false)}/>
        </div>
        <p className="muted">١. اختر الأصل ونوع الحركة · ٢. أدخل التاريخ والكمية والقيمة · ٣. راجع البيانات واحفظ</p>
        <div className="form-grid">
          <h3 className="transaction-form-section-title">بيانات الحركة</h3>
          <Field label="الأصل">
            <select
              value={form.asset_account_id}
              onChange={(e) => { const selected = assets.find((a) => a.id === e.target.value); setForm({ ...form, asset_account_id: e.target.value, proceeds_account_id:"",funding_account_id:"",counterparty_id:"",currency: selected?.currency || form.currency,base_currency:selected?.ownership_scope==="ORGANIZATION"?catalog.organizations?.find((o:any)=>o.id===selected.organization_id)?.base_currency:catalog.base_currency }); }}
            >
              <option value="">اختر الأصل</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} — {assetTypeLabel(a)} — {assetOwnerLabel(a)}
                </option>
              ))}
            </select>
          </Field>
          {form.asset_account_id && (() => { const selected=assets.find((a)=>a.id===form.asset_account_id); return selected ? <div className="notice"><strong>تصنيف الأصل:</strong> {selected.asset_class_code || "Legacy"} / {assetTypeLabel(selected)} · <strong>الملكية:</strong> {assetOwnerLabel(selected)}{form.transaction_type==="PURCHASE" && selected.ownership_scope==="ORGANIZATION" ? " · شراء أصل مؤسسي — المعالجة المالية حسب تصنيف الأصل، وليس مصروفًا تشغيليًا (OPEX) تلقائيًا" : ""}</div> : null; })()}
          <Field label="النوع">
            <select
              value={form.transaction_type}
              onChange={(e) =>
                setForm({ ...form, transaction_type: e.target.value })
              }
            >
              {TRANSACTION_TYPES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label} — {value}
                </option>
              ))}
            </select>
          </Field>
          {form.transaction_type === "SALE" && (
            <Field label="إيداع متحصلات البيع في">
              <select value={form.proceeds_account_id} onChange={(e) => setForm({ ...form, proceeds_account_id: e.target.value })}>
                <option value="">اختر الصندوق أو البنك</option>
                {assets.filter((a) => a.asset_type === "CASH" || a.asset_type === "BANK").map((a) => <option key={a.id} value={a.id}>{a.name} — {assetTypeLabel(a)} — {assetOwnerLabel(a)}</option>)}
              </select>
            </Field>
          )}
          {form.transaction_type === "ADJUSTMENT" && (
            <Field label="اتجاه التسوية">
              <select value={form.adjustment_direction} onChange={(e) => setForm({ ...form, adjustment_direction: e.target.value })}>
                <option value="IN">زيادة الرصيد</option>
                <option value="OUT">تخفيض الرصيد</option>
              </select>
            </Field>
          )}
          {form.transaction_type === "ADJUSTMENT" && form.adjustment_direction === "OUT" && (
            <label className="muted"><input type="checkbox" checked={Boolean(form.disposal_zero_value)} onChange={(e) => setForm({ ...form, disposal_zero_value: e.target.checked, unit_price: e.target.checked ? 0 : form.unit_price, gross_value: e.target.checked ? 0 : form.gross_value, base_value: e.target.checked ? 0 : form.base_value })} /> استغناء عن أصل بقيمة صفرية — بدون أي أثر على النقدية</label>
          )}
          <Field label="التاريخ">
            <input
              type="date"
              value={form.transaction_date}
              onChange={(e) =>
                setForm({ ...form, transaction_date: e.target.value })
              }
            />
          </Field>
          <h3 className="transaction-form-section-title">الكمية والتقييم</h3>
          <Field label="الكمية">
            <input
              type="number"
              step="any"
              value={form.quantity}
              onChange={(e) => { const quantity = e.target.value; const grossValue = (Number(quantity) || 0) * (Number(form.unit_price) || 0); setForm({ ...form, quantity, gross_value: grossValue || "", base_value: grossValue ? grossValue * (Number(form.fx_rate) || 1) : "" }); }}
            />
          </Field>
          <Field label="سعر الوحدة">
            <input
              type="number"
              min="0"
              step="any"
              value={form.unit_price}
              onChange={(e) => {
                const unitPrice = e.target.value;
                const grossValue = (Number(form.quantity) || 0) * (Number(unitPrice) || 0);
                setForm({ ...form, unit_price: unitPrice, gross_value: grossValue || "", base_value: grossValue ? grossValue * (Number(form.fx_rate) || 1) : "" });
              }}
            />
          </Field>
          <Field label="إجمالي القيمة">
            <input type="number" step="any" value={form.gross_value} readOnly />
          </Field>
          {form.transaction_type==="PURCHASE"&&<><h3 className="transaction-form-section-title">الفاتورة والتمويل</h3><Field label="ضريبة الفاتورة (بعملة المعاملة)"><input type="number" min="0" step="any" value={form.vat_amount||0} onChange={e=>setForm({...form,vat_amount:e.target.value})}/></Field>{selectedAsset?.ownership_scope==="ORGANIZATION"?<><Field label="المورد"><select value={form.counterparty_id||""} onChange={e=>setForm({...form,counterparty_id:e.target.value})}><option value="">اختر المورد</option>{(catalog.counterparties||[]).filter((p:any)=>p.organization_id===selectedAsset.organization_id&&["SUPPLIER","BOTH"].includes(p.party_type)).map((p:any)=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="رقم الفاتورة"><input value={form.reference||""} onChange={e=>setForm({...form,reference:e.target.value})}/></Field><Field label="تاريخ استحقاق الدفع"><input type="date" min={form.transaction_date} value={form.due_date||""} onChange={e=>setForm({...form,due_date:e.target.value})}/></Field><Field label="نسبة استرداد الضريبة %"><input type="number" min="0" max="100" value={form.recoverable_percent??100} onChange={e=>setForm({...form,recoverable_percent:e.target.value})}/></Field></>:<Field label="حساب تمويل الشراء"><select value={form.funding_account_id||""} onChange={e=>setForm({...form,funding_account_id:e.target.value})}><option value="">اختر حساب التمويل</option>{assets.filter(a=>a.ownership_scope==="PERSONAL"&&["CASH","BANK"].includes(a.asset_type)&&a.currency===form.currency).map(a=><option key={a.id} value={a.id}>{a.name} · {a.currency}</option>)}</select></Field>}</>}
          {selectedAsset?.ownership_scope==="ORGANIZATION"&&form.transaction_type!=="PURCHASE"&&<div className="notice">الإهلاك والبيع والاستبعاد المؤسسي متاحة من عمليات الأصل في <a href="assets">صفحة الأصول</a> مع الاعتماد المالي.</div>}
          <h3 className="transaction-form-section-title">العملة وسعر الصرف</h3>
          <Field label="عملة المعاملة">
            <input readOnly value={form.currency} onChange={(e) => { const currency=e.target.value.toUpperCase(); const same=currency===form.base_currency; setForm({ ...form, currency, fx_rate:same?1:form.fx_rate, base_value:same?form.gross_value:(Number(form.gross_value)||0)*(Number(form.fx_rate)||1) }); }} />
          </Field>
          <Field label="العملة الأساسية">
            <input readOnly value={ownerBase||form.base_currency} onChange={(e) => { const base_currency=e.target.value.toUpperCase(); const same=base_currency===form.currency; setForm({ ...form, base_currency, fx_rate:same?1:form.fx_rate, base_value:same?form.gross_value:(Number(form.gross_value)||0)*(Number(form.fx_rate)||1) }); }} />
          </Field>
          <Field label="سعر الصرف">
            <input
              type="number"
              min="0"
              step="any"
              value={form.currency === form.base_currency ? 1 : form.fx_rate}
              disabled={form.currency === form.base_currency}
              onChange={(e) => {
                const fxRate = e.target.value;
                setForm({ ...form, fx_rate: fxRate, base_value: (Number(form.gross_value) || 0) * (Number(fxRate) || 0) });
              }}
            />
          </Field>
          <Field label="القيمة بالعملة الأساسية">
            <input type="number" step="any" value={form.base_value} readOnly />
          </Field>
          <label className="transaction-form-notes">ملاحظات المعاملة<textarea value={form.notes} rows={2} onChange={e=>setForm({...form,notes:e.target.value})} placeholder="مرجع أو تفاصيل إضافية (اختياري)"/></label>
        </div>
        <ActionButton icon="save" label={saving?t("جار الحفظ","Saving"):t("حفظ المعاملة","Save transaction")} showLabel onClick={save} disabled={saving||!form.asset_account_id||(selectedAsset?.ownership_scope==="ORGANIZATION"&&form.transaction_type!=="PURCHASE")||(form.transaction_type==="SALE"&&!form.proceeds_account_id)}/>
        {msg && <p role="status" className="muted">{msg}</p>}
      </div>}
      <div className="card section transaction-ledger-card">
        <div className="transaction-ledger-head">
          <div>
            <span className="transaction-ledger-kicker">سجل الحركة</span>
            <h2>المعاملات المسجلة</h2>
          </div>
          <span className="transaction-ledger-count">
            {integerFormatter.format(filteredRows.length)} من {integerFormatter.format(rows.length)}
          </span>
        </div>
        <div className="transaction-filters" role="group" aria-label={t("تصفية المعاملات","Filter transactions")}>
          <label className="transaction-filter-search">
            <span>{t("بحث","Search")}</span>
            <span className="transaction-search-control"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg><input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("ابحث بالأصل أو المرجع أو الجهة","Search asset, reference or counterparty")}
            /></span>
          </label>
          <div className="transaction-filter-field"><span>{t('نوع المعاملة','Transaction type')}</span><YaqeenFilterSelect label={t('نوع المعاملة','Transaction type')} value={typeFilter} onChange={setTypeFilter} options={[{value:'',label:t('جميع الأنواع','All types')},...[...TRANSACTION_TYPES,['DEPRECIATION','إهلاك'],['DISPOSAL','استبعاد']].map(([value,label])=>({value,label:ar?label:operationTypeLabel(value,false)}))]}/></div>
          <div className="transaction-filter-field"><span>{t('المصدر','Source')}</span><YaqeenFilterSelect label={t('المصدر','Source')} value={sourceFilter} onChange={setSourceFilter} options={[{value:'',label:t('كل المصادر','All sources')},...[...new Set(rows.map(r=>r.source_label).filter(Boolean))].map(source=>({value:source,label:source}))]}/></div>
          <div className="transaction-filter-field"><span>{t('الحالة','Status')}</span><YaqeenFilterSelect label={t('الحالة','Status')} value={stateFilter} onChange={setStateFilter} options={[{value:'',label:t('كل الحالات','All states')},...['RECORDED','DRAFT','PLANNED','COMMITTED','ACTUAL','REVERSED','CANCELLED','UNLINKED'].map(state=>({value:state,label:operationStateLabel(state,ar)}))]}/></div>
          <label>
            <span>{t("من تاريخ","From date")}</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
            />
          </label>
          <label>
            <span>{t("إلى تاريخ","To date")}</span>
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
            />
          </label>
          <div className="transaction-filter-controls"><ActionButton icon="history" showLabel label={showDeleted?t("العودة للعمليات","Back to operations"):t("العمليات المحذوفة","Deleted operations")} aria-pressed={showDeleted} onClick={()=>{setShowDeleted(!showDeleted);void load(!showDeleted);}}/>
          {hasFilters && (
            <button
              type="button"
              title={t("مسح الفلاتر","Clear filters")} aria-label={t("مسح الفلاتر","Clear filters")} className="btn secondary transaction-clear-filters"
              onClick={() => {
                setSourceFilter("");setStateFilter("");setQuery("");
                setSourceTransactionId('');
                window.history.replaceState({},'',window.location.pathname);
                setTypeFilter("");
                setDateFrom("");
                setDateTo("");
              }}
            >
              <span className="transaction-clear-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m4 14 10-10 7 7-10 10H7l-3-3v-4Zm5-5 7 7M9 21h12"/></svg></span><span className="transaction-clear-label">{t("مسح الفلاتر","Clear filters")}</span>
            </button>
          )}</div>
        </div>
        <div className="operation-report-actions transaction-report-toolbar"><details><summary className="btn secondary action-button" title={t('تخصيص الأعمدة','Choose columns')} aria-label={t('تخصيص الأعمدة','Choose columns')}><ActionIconGlyph name="filter"/><span>{t("الأعمدة","Columns")}</span></summary><div className="form-grid transaction-column-menu">{operationColumns.map(([key,label,en])=><label key={key}><input type="checkbox" checked={reportColumns.includes(key)} disabled={['date','asset'].includes(key)} onChange={e=>setReportColumns(cols=>e.target.checked?operationColumns.map(c=>c[0]).filter(k=>cols.includes(k)||k===key):cols.filter(k=>k!==key))}/>{ar?label:en}</label>)}</div></details><span className="transaction-legacy-exports"><ActionButton icon="print" showLabel label={t('طباعة التقرير PDF','Print report PDF')} onClick={()=>exportReport('PDF')}/><ActionButton icon="download" showLabel label={t('تصدير التقرير CSV','Export report CSV')} onClick={()=>exportReport('CSV')}/></span><details className="transaction-export-menu" onKeyDown={e=>{if(e.key==='Escape'){e.currentTarget.open=false;e.currentTarget.querySelector('summary')?.focus()}}}><summary className="btn secondary action-button"><ActionIconGlyph name="download"/><span>{t('تصدير التقرير','Export report')}</span><svg className="transaction-export-chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m5 7 5 5 5-5"/></svg></summary><div className="transaction-export-options"><button type="button" onClick={e=>{e.currentTarget.closest('details')?.removeAttribute('open');exportReport('PDF')}}><ActionIconGlyph name="print"/>{t('طباعة / حفظ PDF','Print / save PDF')}</button><button type="button" onClick={e=>{e.currentTarget.closest('details')?.removeAttribute('open');exportReport('CSV')}}><ActionIconGlyph name="download"/>{t('تصدير CSV','Export CSV')}</button></div></details><small>{t('المبالغ بعملة عرض الأساس؛ التصدير بالعملات المسجلة. الفلاتر تنعكس على المؤشرات، والمسودات لا تدخل صافي الأثر المرحل.','Filters apply to indicators and exports. Drafts are excluded from posted net movement.')}</small></div>
        {selectedOperation&&<DetailsDialog label={t("تفاصيل العملية والإجراءات","Operation details and actions")} onClose={()=>setSelectedOperation(null)}><AssetOperationDetails key={selectedOperation.id} record={selectedOperation} ar={ar} onClose={()=>setSelectedOperation(null)} onChanged={()=>void load()}/></DetailsDialog>}
        <div className="transaction-table-wrap"><table className="table"><thead><tr>{reportColumns.map(key=>{const column=operationColumns.find(c=>c[0]===key)!;return ['date','asset','type','currency'].includes(key)?<SortableHeader key={key} label={column[ar?1:2]} column={key as SortKey} sort={sort} onSort={changeSort} mark={sortMark(key as SortKey)}/>:<th key={key}>{column[ar?1:2]}</th>})}<th>{t('الإجراءات','Actions')}</th></tr></thead><tbody>{sortedRows.map(row=><tr key={row.id}>{reportColumns.map(key=>{const v=operationColumnValue(row,key,ar),cash=['net','tax','total','unitPrice','baseTotal','applied','outstanding','bookEffect','gain'].includes(key),baseMoney=['baseTotal','applied','outstanding','bookEffect','gain'].includes(key);return <td key={key}>{key==='status'?<span className="pill">{v}</span>:typeof v==='number'&&cash?<Money value={key==='net'?operationReportAmounts(row).baseNet:key==='tax'?operationReportAmounts(row).baseTax:key==='total'?operationReportAmounts(row).baseTotal:key==='unitPrice'?v*operationReportAmounts(row).fx:v} currency={row.base_currency} organizationId={row.organization_id}/>:key==='asset'?<><strong>{v}</strong><small className="operation-status-note">{row.reference??row.metadata?.invoice_reference??row.counterparty_name??''}</small></>:key==='type'?<>{v}<small className="operation-status-note">{row.source_label}</small></>:typeof v==='number'?numberFormatter.format(v):v}</td>})}<td><ActionButton icon="details" label={t('التفاصيل والإجراءات','Details and actions')} onClick={()=>{if(row.metadata?.investment_id)window.location.href=`/${ar?'ar':'en'}/investments?investment_id=${row.metadata.investment_id}`;else setSelectedOperation(row);}}/></td></tr>)}{!loading&&!sortedRows.length&&<tr><td colSpan={reportColumns.length+1} className="muted">{hasFilters?'لا توجد معاملات مطابقة للفلاتر الحالية.':'لا توجد معاملات بعد.'}</td></tr>}</tbody></table></div>
      </div>
    </main>
  );
}

function TransactionKpi({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: string;
}) {
  return (
    <div className="card transaction-kpi">
      <div className="transaction-kpi-head">
        <span aria-hidden="true">{icon}</span>
        <small className="muted">{label}</small>
      </div>
      <strong>{value}</strong>
    </div>
  );
}

function SortableHeader({
  label,
  column,
  sort,
  onSort,
  mark,
}: {
  label: string;
  column: SortKey;
  sort: { key: SortKey; direction: SortDirection };
  onSort: (key: SortKey) => void;
  mark: string;
}) {
  const active = sort.key === column;
  return (
    <th aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        className={`transaction-sort${active ? " active" : ""}`}
        title={label} aria-label={label} onClick={() => onSort(column)}
      >
        <span>{label}</span>
        <span aria-hidden="true">{mark}</span>
      </button>
    </th>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children?: React.ReactNode;
}) {
  return (
    <label>
      {label}
      {children}
    </label>
  );
}
