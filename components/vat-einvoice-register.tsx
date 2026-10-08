'use client';

import { vatNoteMessages } from '@/lib/vat-note-messages';

import { Fragment, FormEvent, useEffect, useState } from 'react';
import { applyInvoiceLineDiscount, normalizeInvoiceLinePrice, previewInvoiceLine } from '@/lib/vat-invoice-price-mode';
import { vatEInvoiceDraftSchema, calculateVatEInvoiceDraft } from '@/lib/vat-einvoice-draft';
import { VatInvoiceReceipts } from '@/components/vat-invoice-receipts';
import { InvoicePaymentBadge } from '@/components/invoice-payment-badge';
import { invoicePrintHtml } from '@/lib/vat-invoice-print';
import { InvoiceRegisterFilters } from '@/components/invoice-register-filters';
import { emptyInvoiceFilters, filterInvoiceRows, invoicePaymentState } from '@/lib/invoice-register-filters';
import { VatContactPicker, type VatContact } from '@/components/vat-contact-picker';

type SellerProfile = {
  registered_name: string;
  seller_street: string;
  seller_building_number: string;
  seller_district: string;
  seller_additional_number: string;
  seller_city: string;
  seller_postal_code: string;
};

type InvoiceLine = {
  item_name: string;
  description: string;
  quantity: string;
  unit_code: string;
  unit_price: string;
  discount_amount: string;
  tax_category: 'S' | 'Z' | 'E' | 'O';
  tax_rate: string;
  tax_exemption_reason_code: string;
  tax_exemption_reason: string;
};

type Invoice = {
  id: string;
  invoice_number: string;
  preceding_invoice_id?: string | null;
  financial_event?: { id: string; status: string } | null;
  document_type: string;
  invoice_category: string;
  status: string;
  issue_date: string;
  issue_time: string;
  due_date: string | null;
  currency: string;
  exchange_rate?: string;
  tax_total_amount_sar?: string;
  payable_amount: string;
  tax_total_amount: string;
  tax_exclusive_amount?: string;
  qr_code: string | null;
  seller_name: string;
  seller_vat_number: string;
  seller_address: string;
  seller_building_number: string;
  seller_district: string;
  seller_city: string;
  seller_postal_code: string;
  buyer_name: string | null;
  buyer_contact_id: string | null;
  buyer_vat_number: string | null;
  buyer_address: string | null;
  buyer_city: string | null;
  buyer_building_number?: string | null;
  buyer_district?: string | null;
  buyer_additional_number?: string | null;
  buyer_postal_code?: string | null;
  billing_reference?: string | null;
  note_reason?: string | null;
  accounting_document_id?: string | null;
  accounting_document?: { id: string; document_number: string; document_kind: string; zatca_status: string } | null;
  cash_flow?: { id: string; account_id?: string | null; amount: string; settled_amount: string; settlement_status: string; status: string; currency: string; due_date: string } | null;
  lines: Array<{
    id: string; item_name: string; description: string | null; quantity: number; unit_code: string;
    unit_price: string; discount_amount: string; tax_category: InvoiceLine['tax_category']; tax_rate: string;
    tax_exemption_reason_code: string | null; tax_exemption_reason: string | null; tax_amount: string; gross_amount: string;
  }>;
};

type VatCurrency = { code: string; name_ar: string; name_en: string; symbol: string | null; decimals: number };
type FxRate = { from_currency: string; to_currency: string; rate: string | number; valuation_date: string };

const emptyLine = (taxRate = '15'): InvoiceLine => ({
  item_name: '', description: '', quantity: '1', unit_code: 'PCE', unit_price: '',
  discount_amount: '0', tax_category: 'S', tax_rate: taxRate,
  tax_exemption_reason_code: '', tax_exemption_reason: '',
});

export function VatEInvoiceRegister({
  organizationId,
  sellerProfile,
  vatNumber,
  standardTaxRate,
  registered,
  ar,
  onInvoiceIssued,
}: {
  organizationId: string;
  sellerProfile: SellerProfile;
  vatNumber: string;
  standardTaxRate: number;
  registered: boolean;
  ar: boolean;
  onInvoiceIssued?: () => void;
}) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState({ ...emptyInvoiceFilters });
  const visibleInvoices = filterInvoiceRows(invoices, filters, invoice => ({ id:invoice.id, number:invoice.invoice_number, name:invoice.buyer_name || '', date:invoice.issue_date, due:invoice.due_date, status:invoice.status, category:invoice.invoice_category, currency:invoice.currency, baseAmount:Number(invoice.payable_amount) * Number(invoice.exchange_rate || 1), flow:invoice.cash_flow }));
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [showDraftForm, setShowDraftForm] = useState(false);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [category, setCategory] = useState<'STANDARD' | 'SIMPLIFIED'>('STANDARD');
  const [documentType, setDocumentType] = useState<'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE'>('INVOICE');
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [issueTime, setIssueTime] = useState(() => new Date().toTimeString().slice(0, 5));
  const [currency, setCurrency] = useState('SAR');
  const [exchangeRate, setExchangeRate] = useState('1');
  const [currencies, setCurrencies] = useState<VatCurrency[]>([{ code: 'SAR', name_ar: 'ريال سعودي', name_en: 'Saudi Riyal', symbol: 'ر.س', decimals: 2 }]);
  const [fxRates, setFxRates] = useState<FxRate[]>([]);
  const [pricesIncludeTax, setPricesIncludeTax] = useState(false);
  const [fieldsMenuOpen, setFieldsMenuOpen] = useState(false);
  const [showUnitColumn, setShowUnitColumn] = useState(false);
  const [discountMode, setDiscountMode] = useState<'NONE' | 'AMOUNT' | 'PERCENT'>('AMOUNT');
  const [serviceCatalog, setServiceCatalog] = useState<string[]>([]);
  const [addingServiceIndex, setAddingServiceIndex] = useState<number | null>(null);
  const [buyerContactId, setBuyerContactId] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [buyerVatNumber, setBuyerVatNumber] = useState('');
  const [buyerAddress, setBuyerAddress] = useState('');
  const [buyerBuilding, setBuyerBuilding] = useState('');
  const [buyerDistrict, setBuyerDistrict] = useState('');
  const [buyerCity, setBuyerCity] = useState('');
  const [buyerPostalCode, setBuyerPostalCode] = useState('');
  const [buyerAdditional, setBuyerAdditional] = useState('');
  const [billingReference, setBillingReference] = useState('');
  const [precedingInvoiceId, setPrecedingInvoiceId] = useState<string | null>(null);
  const [noteReason, setNoteReason] = useState('');
  const [lines, setLines] = useState<InvoiceLine[]>(() => [emptyLine(String(standardTaxRate))]);
  const [cashAccounts, setCashAccounts] = useState<Array<{id:string;name:string;currency:string}>>([]);
  const [noteSource, setNoteSource] = useState<Invoice | null>(null);
  const [receiptInvoice, setReceiptInvoice] = useState<Invoice | null>(null);
  const [collectionInvoice, setCollectionInvoice] = useState<Invoice | null>(null);
  const [collectionAccountId, setCollectionAccountId] = useState('');
  const [collectionAmount, setCollectionAmount] = useState('');
  const [collectionDate, setCollectionDate] = useState(() => new Date().toISOString().slice(0,10));
  const [accountingSourceId, setAccountingSourceId] = useState<string | null>(null);
  const sellerProfileReady = Boolean(
    sellerProfile.registered_name.trim() && sellerProfile.seller_street.trim() &&
    /^\d{4}$/.test(sellerProfile.seller_building_number) && sellerProfile.seller_district.trim() &&
    /^\d{4}$/.test(sellerProfile.seller_additional_number) && sellerProfile.seller_city.trim() &&
    /^\d{5}$/.test(sellerProfile.seller_postal_code),
  );

  useEffect(() => {
    setInvoices([]);
    setCashAccounts([]);
    setCanCreate(false);
    setShowDraftForm(false);
    setEditingDraftId(null);
    setAccountingSourceId(null);
    setNoteSource(null);
    setCollectionInvoice(null);
    setReceiptInvoice(null);
    setMessage(null);
    setBuyerContactId('');
    setBuyerName('');
    setBuyerVatNumber('');
    setBuyerAddress('');
    setBuyerBuilding('');
    setBuyerDistrict('');
    setBuyerAdditional('');
    setBuyerCity('');
    setBuyerPostalCode('');
  }, [organizationId]);

  useEffect(() => {
    if (!organizationId) return;
    let active = true;
    setLoading(true);
    fetch(`/api/vat/e-invoices?organization_id=${encodeURIComponent(organizationId)}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error || `HTTP_${response.status}`);
        return body;
      })
      .then((body) => {
        if (!active) return;
        setInvoices(body.invoices ?? []);
        const existingNames = (body.invoices ?? []).flatMap((invoice: Invoice) => invoice.lines.map((line) => line.item_name));
        setServiceCatalog((current) => Array.from(new Set([...current, ...existingNames].filter(Boolean))));
        setCanCreate(Boolean(body.is_admin && registered));
      })
      .catch((error) => { if (active) setMessage({ error: true, text: messageFor(error.message, ar) }); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [organizationId, registered, ar]);

  useEffect(() => {
    if (!organizationId) return;
    let active = true;
    setCashAccounts([]);
    fetch(`/api/liquidity?organization_id=${encodeURIComponent(organizationId)}`).then(r => r.ok ? r.json() : null).then(body => {
      if (active && body?.accounts) setCashAccounts(body.accounts.map((a: any) => ({ id:a.id, name:a.name, currency:a.currency })));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [organizationId]);

  useEffect(() => {
    if (!organizationId) return;
    let active = true;
    Promise.all([
      fetch('/api/currencies').then((response) => response.ok ? response.json() : []),
      fetch(`/api/fx?organization_id=${encodeURIComponent(organizationId)}`).then((response) => response.ok ? response.json() : []),
    ]).then(([currencyRows, rateRows]) => {
      if (!active) return;
      const available = Array.isArray(currencyRows) ? currencyRows as VatCurrency[] : [];
      if (!available.some((item) => item.code === 'SAR')) available.unshift({ code: 'SAR', name_ar: 'ريال سعودي', name_en: 'Saudi Riyal', symbol: 'ر.س', decimals: 2 });
      setCurrencies(available);
      setFxRates(Array.isArray(rateRows) ? rateRows as FxRate[] : []);
    }).catch(() => undefined);
    try {
      const catalog = JSON.parse(localStorage.getItem(`vat-einvoice-service-catalog:${organizationId}`) || '[]');
      if (active && Array.isArray(catalog)) setServiceCatalog(catalog.filter((item): item is string => typeof item === 'string'));
    } catch { /* Keep the in-memory catalog if local storage is unavailable. */ }
    return () => { active = false; };
  }, [organizationId]);

  useEffect(() => {
    if (currency === 'SAR') { setExchangeRate('1'); return; }
    if (editingDraftId || accountingSourceId) return;
    const latest = fxRates.find((item) => item.from_currency === currency && item.to_currency === 'SAR')
      ?? fxRates.find((item) => item.from_currency === 'SAR' && item.to_currency === currency);
    setExchangeRate(latest ? String(latest.from_currency === currency ? latest.rate : (1 / Number(latest.rate))) : '');
  }, [currency, fxRates, editingDraftId, accountingSourceId]);

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const draftPayload = {
          organization_id: organizationId,
          invoice_number: invoiceNumber,
          invoice_category: category,
          document_type: documentType,
          issue_date: issueDate,
          due_date: dueDate || null,
          issue_time: issueTime,
          currency,
          exchange_rate: Number(exchangeRate),
          buyer_contact_id: buyerContactId || null,
          seller_name: sellerProfile.registered_name,
          seller_vat_number: vatNumber,
          seller_address: sellerProfile.seller_street,
          seller_building_number: sellerProfile.seller_building_number,
          seller_district: sellerProfile.seller_district,
          seller_additional_number: sellerProfile.seller_additional_number,
          seller_city: sellerProfile.seller_city,
          seller_postal_code: sellerProfile.seller_postal_code,
          seller_country_code: 'SA',
          buyer_name: buyerName || null,
          buyer_vat_number: buyerVatNumber || null,
          buyer_address: buyerAddress || null,
          buyer_building_number: buyerBuilding || null,
          buyer_district: buyerDistrict || null,
          buyer_additional_number: buyerAdditional || null,
          buyer_city: buyerCity || null,
          buyer_postal_code: buyerPostalCode || null,
          buyer_country_code: 'SA',
          billing_reference: billingReference || null,
          preceding_invoice_id: precedingInvoiceId,
          note_reason: noteReason || null,
          lines: lines.map((line) => ({
            ...line,
            ...normalizeInvoiceLinePrice(lineForCalculation(line), pricesIncludeTax),
            description: line.description || null,
            tax_exemption_reason_code: line.tax_exemption_reason_code || null,
            tax_exemption_reason: line.tax_exemption_reason || null,
          })),
        };
      const validated = vatEInvoiceDraftSchema.safeParse(draftPayload);
      if (!validated.success) throw new Error(validated.error.issues[0]?.message || "INVALID_EINVOICE_DRAFT");
      if (validated.data.lines.some((line) => line.tax_category === 'S' && line.tax_rate !== standardTaxRate)) throw new Error('STANDARD_TAX_RATE_MISMATCH');
      calculateVatEInvoiceDraft(validated.data);
      let accountingDocumentId: string | null = null;
      if (!accountingSourceId) {
        if (documentType !== 'INVOICE' && !noteSource?.accounting_document_id) throw new Error('VAT_ORIGINAL_ACCOUNTING_INVOICE_REQUIRED');
        if (!buyerContactId) throw new Error('VAT_STABLE_CONTACT_REQUIRED');
        const accountingLines = lines.map((line) => {
          const normalized = normalizeInvoiceLinePrice(lineForCalculation(line), pricesIncludeTax);
          return {
            description: line.item_name || line.description || (documentType === 'INVOICE' ? 'Sale' : 'Adjustment'),
            unit: line.unit_code,
            quantity: Number(line.quantity),
            unit_price: Number(normalized.unit_price),
            discount_amount: Number(normalized.discount_amount || 0),
            supply_type: line.tax_category === 'S' ? 'STANDARD' : line.tax_category === 'Z' ? 'ZERO_RATED' : line.tax_category === 'E' ? 'EXEMPT' : 'OUT_OF_SCOPE',
          };
        });
        const accountingResponse = await fetch('/api/vat', {
          method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
            action:'add_document', organization_id:organizationId, document_type:'SALES', document_kind:documentType,
            document_number:invoiceNumber, transaction_date:issueDate, due_date:dueDate || issueDate,
            ...(documentType !== 'INVOICE' ? { preceding_document_id: noteSource?.accounting_document_id } : {}),
            counterparty_contact_id:buyerContactId, counterparty_name:buyerName, counterparty_tax_number:buyerVatNumber || null,
            supply_type:accountingLines[0]?.supply_type || 'STANDARD',
            net_amount:accountingLines.reduce((sum,line)=>sum + line.quantity*line.unit_price-line.discount_amount,0),
            lines:accountingLines, currency, exchange_rate:Number(exchangeRate), recoverable_percent:100,
            notes:noteReason || billingReference || (documentType === 'INVOICE' ? 'Created from ZATCA invoice workspace' : null),
          })
        });
        const accountingBody = await accountingResponse.json();
        if (!accountingResponse.ok) throw new Error(accountingBody?.error || `HTTP_${accountingResponse.status}`);
        accountingDocumentId = accountingBody.id;
        // Preserve the created source across a failed ZATCA save so retry never creates a second sale.
        setAccountingSourceId(accountingDocumentId);
      }
      const response = await fetch('/api/vat/e-invoices', {
        method: editingDraftId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draftPayload, ...(editingDraftId ? { invoice_id: editingDraftId } : {}),
          ...(accountingDocumentId || accountingSourceId ? { accounting_document_id: accountingDocumentId || accountingSourceId } : {}) }),
      });
      const body = await response.json();
      if (!response.ok) {
        if (body?.error === 'INVALID_EINVOICE_DRAFT') {
          const issue = body.issues?.[0]?.message;
          throw new Error(issue || body.error);
        }
        throw new Error(body?.error || `HTTP_${response.status}`);
      }
      const refreshed = await fetch(`/api/vat/e-invoices?organization_id=${encodeURIComponent(organizationId)}`);
      if (refreshed.ok) {
        const refreshedBody = await refreshed.json();
        setInvoices(refreshedBody.invoices ?? []);
      } else {
        setInvoices((current) => editingDraftId
          ? current.map((invoice) => invoice.id === editingDraftId ? { ...invoice, ...body } : invoice)
          : [body, ...current]);
      }
      setEditingDraftId(null);
      setNoteSource(null);
      setAccountingSourceId(null);
      setInvoiceNumber('');
      setDueDate('');
      setBuyerName('');
      setBuyerContactId('');
      setBuyerVatNumber('');
      setBuyerAddress('');
      setBuyerBuilding('');
      setBuyerDistrict('');
      setBuyerAdditional('');
      setBuyerCity('');
      setBuyerPostalCode('');
      setBillingReference('');
    setPrecedingInvoiceId(null);
      setNoteReason('');
      setLines([emptyLine(String(standardTaxRate))]);
      setPricesIncludeTax(false);
      setFieldsMenuOpen(false);
      setCurrency('SAR');
      setExchangeRate('1');
      setShowDraftForm(false);
      setMessage({ error: false, text: documentType === 'INVOICE'
        ? (ar ? (editingDraftId ? 'حُفظت تعديلات المسودة. لم تصدر ولم تُرسل إلى زاتكا.' : 'حُفظت مسودة الفاتورة. لم تصدر ولم تُرسل إلى زاتكا.') : (editingDraftId ? 'Draft changes saved. It has not been issued or sent to ZATCA.' : 'Invoice draft saved. It has not been issued or sent to ZATCA.'))
        : (ar ? 'حُفظت مسودة الإشعار المرتبط. أصدر الإشعار ثم اعتمد أثره المحاسبي.' : 'Linked note draft saved. Issue it, then post its accounting effect.') });
    } catch (error) {
      setMessage({ error: true, text: messageFor(error instanceof Error ? error.message : 'UNKNOWN_ERROR', ar) });
    } finally {
      setBusy(false);
    }
  }

  async function deleteDraft(invoice: Invoice) {
    if (invoice.status !== 'DRAFT') return;
    const prompt = ar ? 'حذف المسودة رقم ' + invoice.invoice_number + '؟ لا يمكن التراجع عن الحذف.' : 'Delete draft ' + invoice.invoice_number + '? This cannot be undone.';
    if (!window.confirm(prompt)) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch('/api/vat/e-invoices?invoice_id=' + encodeURIComponent(invoice.id), { method: 'DELETE' });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || ('HTTP_' + response.status));
      setInvoices((current) => current.filter((item) => item.id !== invoice.id));
      setMessage({ error:false, text: ar ? 'تم حذف المسودة غير المصدرة بأمان.' : 'The unissued draft was deleted safely.' });
    } catch (error) {
      const code = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      setMessage({ error:true, text: code === 'EINVOICE_REQUEST_FAILED' || code === 'UNKNOWN_ERROR'
        ? (ar ? 'تعذر حذف المسودة. أعد المحاولة؛ لم يتم تأكيد الحذف.' : 'Could not delete the draft. Retry; deletion was not confirmed.')
        : messageFor(code, ar) });
    } finally { setBusy(false); }
  }

  async function postNote(invoice: Invoice) {
    if (!invoice.accounting_document_id) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(invoice.document_type === 'INVOICE' ? '/api/vat/recognition' : '/api/vat/notes', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ organization_id:organizationId, document_id:invoice.accounting_document_id }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || 'VAT_NOTE_POST_FAILED');
      const refresh = await fetch(`/api/vat/e-invoices?organization_id=${encodeURIComponent(organizationId)}`);
      if (refresh.ok) setInvoices((await refresh.json()).invoices ?? []);
      onInvoiceIssued?.();
      setMessage({ error:false, text:response.status===202 ? (ar?'الإشعار بانتظار الموافقة حسب سياسة المنشأة.':'Note awaits approval under organization policy.') : (ar?(invoice.document_type === 'INVOICE'?'تم اعتماد الفاتورة محاسبيًا دون حركة نقدية.':'تم ترحيل أثر الإشعار وتحديث الذمم والسيولة المتوقعة. رد المبلغ يحتاج تسوية منفصلة.'):'Note posted; obligations and cash forecast updated. Refund requires a separate settlement.') });
    } catch(error) { setMessage({error:true,text:messageFor(error instanceof Error?error.message:'VAT_NOTE_POST_FAILED',ar)}); }
    finally { setBusy(false); }
  }

  async function issueInvoice(invoice: Invoice) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch('/api/vat/e-invoices/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organization_id: organizationId, invoice_id: invoice.id }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || `HTTP_${response.status}`);
      setInvoices((current) => current.map((item) => item.id === invoice.id ? { ...item, ...body } : item));
      onInvoiceIssued?.();
      setMessage({ error: false, text: ar ? 'صدرت الفاتورة وحُفظ رمز QR بصيغة زاتكا للمرحلة الأولى.' : 'Invoice issued and its ZATCA Phase 1 QR payload was saved.' });
    } catch (error) {
      setMessage({ error: true, text: messageFor(error instanceof Error ? error.message : 'EINVOICE_ISSUE_FAILED', ar) });
    } finally {
      setBusy(false);
    }
  }

  function prepareAccountingInvoiceForZatca(invoice: Invoice) {
    setEditingDraftId(null);
    setAccountingSourceId(invoice.accounting_document_id || null);
    setNoteSource(null);
    setBuyerAddress(invoice.buyer_address || '');
    setBuyerBuilding(invoice.buyer_building_number || '');
    setBuyerDistrict(invoice.buyer_district || '');
    setBuyerCity(invoice.buyer_city || '');
    setBuyerPostalCode(invoice.buyer_postal_code || '');
    setBuyerAdditional(invoice.buyer_additional_number || '');
    setBillingReference('');
    setPrecedingInvoiceId(null);
    setNoteReason('');
    setPricesIncludeTax(false);
    setDiscountMode('AMOUNT');
    setIssueTime(new Date().toTimeString().slice(0,5));
    setDocumentType('INVOICE');
    setInvoiceNumber(invoice.invoice_number);
    setIssueDate(invoice.issue_date);
    setDueDate(invoice.due_date || invoice.issue_date);
    setCurrency(invoice.currency);
    setExchangeRate(String(invoice.exchange_rate || 1));
    setBuyerContactId(invoice.buyer_contact_id || '');
    setBuyerName(invoice.buyer_name || '');
    setBuyerVatNumber(invoice.buyer_vat_number || '');
    setLines(invoice.lines.map((line)=>({ item_name:line.item_name,description:line.description || '',quantity:String(line.quantity),unit_code:line.unit_code,unit_price:String(line.unit_price),discount_amount:String(line.discount_amount),tax_category:line.tax_category,tax_rate:String(line.tax_rate),tax_exemption_reason_code:line.tax_exemption_reason_code || '',tax_exemption_reason:line.tax_exemption_reason || '' })));
    setShowDraftForm(true);
    window.scrollTo({top:0,behavior:'smooth'});
  }

  function openCollection(invoice: Invoice) {
    if (!invoice.cash_flow?.id) {
      setMessage({ error: true, text: ar ? 'لا يوجد تدفق قبض مرتبط بهذه الفاتورة المحاسبية.' : 'No collection flow is linked to this accounting invoice.' });
      return;
    }
    const outstanding = Math.max(0, Number(invoice.cash_flow.amount) - Number(invoice.cash_flow.settled_amount || 0));
    const eligibleAccounts = cashAccounts.filter((account) => account.currency === invoice.cash_flow?.currency);
    if (!eligibleAccounts.length) {
      setMessage({ error:true, text: ar ? 'لا يوجد حساب بنكي/صندوق نشط بنفس عملة الفاتورة.' : 'No active bank/cash account uses the invoice currency.' });
      return;
    }
    setReceiptInvoice(null);
    setCollectionInvoice(invoice);
    setCollectionAccountId(eligibleAccounts.some((account) => account.id === invoice.cash_flow?.account_id) ? invoice.cash_flow.account_id || '' : '');
    setCollectionAmount(String(outstanding));
    setCollectionDate(new Date().toISOString().slice(0,10));
    setMessage(null);
  }

  async function confirmCollection() {
    const invoice = collectionInvoice;
    if (!invoice?.cash_flow?.id) return;
    const outstanding = Math.max(0, Number(invoice.cash_flow.amount) - Number(invoice.cash_flow.settled_amount || 0));
    const amount = Number(collectionAmount);
    if (!collectionAccountId) { setMessage({error:true,text:ar?'اختر حساب القبض.':'Choose a collection account.'}); return; }
    if (!Number.isFinite(amount) || !(amount > 0) || amount > outstanding) {
      setMessage({ error:true, text:ar?'مبلغ القبض يجب أن يكون أكبر من صفر ولا يتجاوز المتبقي.':'Collection amount must be positive and not exceed outstanding.' }); return;
    }
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/liquidity/${invoice.cash_flow.id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({status:'ACTUAL',account_id:collectionAccountId,amount,settlement_date:collectionDate}) });
      const body = await response.json();
      if (!response.ok && response.status !== 202) throw new Error(body?.error || `HTTP_${response.status}`);
      const refresh = await fetch(`/api/vat/e-invoices?organization_id=${encodeURIComponent(organizationId)}`);
      if (refresh.ok) setInvoices((await refresh.json()).invoices ?? []);
      setCollectionInvoice(null);
      setMessage({error:false,text:response.status===202?(body.settlement_event_id ? (ar?'حُفظ سند القبض بانتظار الموافقة؛ لم يتحرك رصيد البنك بعد.':'Receipt saved pending approval; the bank balance has not changed.') : (ar?'لم يُسجل القبض بعد: الفاتورة بانتظار الموافقة المالية.':'Collection has not been recorded: invoice recognition needs financial approval.')):(ar?'تم تسجيل القبض وتحديث الذمة والسيولة.':'Collection posted; receivable and liquidity were updated.')});
    } catch(error) { setMessage({error:true,text:messageFor(error instanceof Error?error.message:'COLLECTION_FAILED',ar)}); }
    finally { setBusy(false); }
  }

  function startNote(invoice: Invoice, kind: 'CREDIT_NOTE'|'DEBIT_NOTE') {
    if (!invoice.accounting_document_id || !['ISSUED','CLEARED','REPORTED','SUBMITTED'].includes(invoice.status)) return;
    setEditingDraftId(null);
    setNoteSource(invoice);
    setAccountingSourceId(null);
    setDocumentType(kind);
    setCategory(invoice.invoice_category as typeof category);
    setInvoiceNumber(`${invoice.invoice_number}-${kind === 'CREDIT_NOTE' ? 'CN' : 'DN'}`);
    setIssueDate(new Date().toISOString().slice(0,10));
    setDueDate(new Date().toISOString().slice(0,10));
    setCurrency(invoice.currency);
    setExchangeRate(String(invoice.exchange_rate || 1));
    setBuyerContactId(invoice.buyer_contact_id || '');
    setBuyerName(invoice.buyer_name || '');
    setBuyerVatNumber(invoice.buyer_vat_number || '');
    setBuyerAddress(invoice.buyer_address || '');
    setBuyerBuilding(invoice.buyer_building_number || '');
    setBuyerDistrict(invoice.buyer_district || '');
    setBuyerAdditional(invoice.buyer_additional_number || '');
    setBuyerCity(invoice.buyer_city || '');
    setBuyerPostalCode(invoice.buyer_postal_code || '');
    setBillingReference(invoice.invoice_number);
    setPrecedingInvoiceId(invoice.id);
    setNoteReason('');
    setLines(invoice.lines.map((line) => ({ item_name:line.item_name, description:line.description || '', quantity:String(line.quantity), unit_code:line.unit_code, unit_price:String(line.unit_price), discount_amount:String(line.discount_amount), tax_category:line.tax_category, tax_rate:String(line.tax_rate), tax_exemption_reason_code:line.tax_exemption_reason_code || '', tax_exemption_reason:line.tax_exemption_reason || '' })));
    setShowDraftForm(true);
    window.scrollTo({ top:0, behavior:'smooth' });
  }

  function editDraft(invoice: Invoice) {
    if (invoice.status !== 'DRAFT') return;
    setEditingDraftId(invoice.id);
    setNoteSource(null);
    setPrecedingInvoiceId(invoice.preceding_invoice_id || null);
    setAccountingSourceId(invoice.accounting_document_id || null);
    setDocumentType(invoice.document_type as typeof documentType);
    setCategory(invoice.invoice_category as typeof category);
    setInvoiceNumber(invoice.invoice_number);
    setIssueDate(invoice.issue_date);
    setIssueTime((invoice.issue_time || '12:00').slice(0, 5));
    setDueDate(invoice.due_date || '');
    setCurrency(invoice.currency || 'SAR');
    setExchangeRate(String(invoice.exchange_rate || 1));
    setBuyerContactId(invoice.buyer_contact_id || '');
    setBuyerName(invoice.buyer_name || '');
    setBuyerVatNumber(invoice.buyer_vat_number || '');
    setBuyerAddress(invoice.buyer_address || '');
    setBuyerBuilding(invoice.buyer_building_number || '');
    setBuyerDistrict(invoice.buyer_district || '');
    setBuyerAdditional(invoice.buyer_additional_number || '');
    setBuyerCity(invoice.buyer_city || '');
    setBuyerPostalCode(invoice.buyer_postal_code || '');
    setBillingReference(invoice.billing_reference || '');
    setNoteReason(invoice.note_reason || '');
    setLines(invoice.lines.map((line) => ({
      item_name: line.item_name,
      description: line.description || '',
      quantity: String(line.quantity),
      unit_code: line.unit_code || 'PCE',
      unit_price: String(line.unit_price),
      discount_amount: String(line.discount_amount || 0),
      tax_category: line.tax_category,
      tax_rate: String(line.tax_rate || 0),
      tax_exemption_reason_code: line.tax_exemption_reason_code || '',
      tax_exemption_reason: line.tax_exemption_reason || '',
    })));
    setPricesIncludeTax(false);
    setDiscountMode(invoice.lines.some((line) => Number(line.discount_amount) > 0) ? 'AMOUNT' : 'NONE');
    setShowUnitColumn(invoice.lines.some((line) => line.unit_code && line.unit_code !== 'PCE'));
    setFieldsMenuOpen(false);
    setShowDraftForm(true);
    setMessage(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function printInvoice(invoice: Invoice) {
    const popup = window.open('', '_blank');
    if (!popup) { setMessage({error:true,text:ar?'اسمح بالنوافذ المنبثقة لطباعة الفاتورة.':'Allow pop-ups to print the invoice.'}); return; }
    popup.opener = null;
    try {
      const draft = ['DRAFT','ACCOUNTING_READY'].includes(invoice.status);
      const qrImage = !draft && invoice.qr_code ? await (await import('qrcode')).default.toDataURL(invoice.qr_code,{errorCorrectionLevel:'M',margin:2,width:220}) : null;
      popup.document.write(invoicePrintHtml({
        number:invoice.invoice_number,date:invoice.issue_date,due:invoice.due_date,currency:invoice.currency,exchangeRate:invoice.exchange_rate,
        title:invoice.document_type==='CREDIT_NOTE'?(ar?'إشعار دائن':'Credit note'):invoice.document_type==='DEBIT_NOTE'?(ar?'إشعار مدين':'Debit note'):invoice.invoice_category==='SIMPLIFIED'?(ar?'فاتورة ضريبية مبسطة':'Simplified tax invoice'):(ar?'فاتورة ضريبية':'Tax invoice'),
        draft,seller:{name:invoice.seller_name,vat:invoice.seller_vat_number,street:invoice.seller_address,district:invoice.seller_district,city:invoice.seller_city,building:invoice.seller_building_number,postal:invoice.seller_postal_code},
        buyer:{name:invoice.buyer_name || '',vat:invoice.buyer_vat_number,street:invoice.buyer_address,district:invoice.buyer_district,city:invoice.buyer_city,building:invoice.buyer_building_number,postal:invoice.buyer_postal_code},
        net:invoice.tax_exclusive_amount ?? Number(invoice.payable_amount)-Number(invoice.tax_total_amount),tax:invoice.tax_total_amount,total:invoice.payable_amount,note:invoice.note_reason,
        lines:invoice.lines.map(line=>({name:line.item_name,quantity:line.quantity,unitPrice:line.unit_price,discount:line.discount_amount,tax:line.tax_amount,total:line.gross_amount})),
      },ar,qrImage));
      popup.document.close();
    } catch { popup.close(); setMessage({error:true,text:ar?'تعذر إعداد نسخة الطباعة. أعد المحاولة.':'Could not prepare the printable invoice. Retry.'}); }
  }
  function updateLine(index: number, changes: Partial<InvoiceLine>) {
    setLines((current) => current.map((line, i) => i === index ? { ...line, ...changes } : line));
  }

  function startDraft(type: 'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE') {
    setEditingDraftId(null);
    setAccountingSourceId(null);
    setNoteSource(null);
    setIssueDate(new Date().toISOString().slice(0,10));
    setIssueTime(new Date().toTimeString().slice(0,5));
    setInvoiceNumber('');
    setDueDate('');
    setBuyerContactId('');
    setBuyerName('');
    setBuyerVatNumber('');
    setBuyerAddress('');
    setBuyerBuilding('');
    setBuyerDistrict('');
    setBuyerAdditional('');
    setBuyerCity('');
    setBuyerPostalCode('');
    setBillingReference('');
    setPrecedingInvoiceId(null);
    setNoteReason('');
    setLines([emptyLine(String(standardTaxRate))]);
    setPricesIncludeTax(false);
    setFieldsMenuOpen(false);
    setShowUnitColumn(false);
    setCurrency('SAR');
    setExchangeRate('1');
    setAddingServiceIndex(null);
    setDiscountMode('AMOUNT');
    setDocumentType(type);
    setShowDraftForm(true);
    setAddMenuOpen(false);
    setMessage(null);
  }

  function lineAmounts(line: InvoiceLine) {
    try { return previewInvoiceLine(lineForCalculation(line), pricesIncludeTax); }
    catch { return { net: 0, tax: 0, total: 0 }; }
  }

  function lineForCalculation(line: InvoiceLine): InvoiceLine {
    return applyInvoiceLineDiscount(line, discountMode);
  }

  function addService(index: number) {
    const name = lines[index]?.item_name.trim();
    if (!name) return;
    const next = Array.from(new Set([...serviceCatalog, name]));
    setServiceCatalog(next);
    try { localStorage.setItem(`vat-einvoice-service-catalog:${organizationId}`, JSON.stringify(next)); } catch { /* Keep the service available for this session. */ }
    setAddingServiceIndex(null);
  }

  const selectedCurrency = currencies.find((item) => item.code === currency);
  const currencyLabel = selectedCurrency?.symbol || currency;
  const latestFx = currency === 'SAR' ? null : fxRates.find((item) => item.from_currency === currency && item.to_currency === 'SAR')
    ?? fxRates.find((item) => item.from_currency === 'SAR' && item.to_currency === currency);
  const latestFxDate = latestFx?.valuation_date;
  const previewTotals = (() => {
    try {
      return calculateVatEInvoiceDraft({ lines: lines.map((line) => {
        const normalized = normalizeInvoiceLinePrice(lineForCalculation(line), pricesIncludeTax);
        return { ...line, quantity: Number(line.quantity), unit_price: Number(normalized.unit_price), discount_amount: Number(normalized.discount_amount || 0), tax_rate: Number(line.tax_rate) };
      }) }).totals;
    } catch { return null; }
  })();
  const subtotal = Number(previewTotals?.tax_exclusive_amount || 0);
  const totalTax = Number(previewTotals?.tax_total_amount || 0);
  const grandTotal = Number(previewTotals?.payable_amount || 0);

  return (
    <section className="vat-panel">
      <div className="vat-panel-head vat-einvoice-register-heading">
        <div>
          <span className="vat-eyebrow">{ar ? 'الفواتير الصادرة' : 'SALES INVOICES'}</span>
          <h2>{ar ? 'الفواتير والإشعارات' : 'Invoices and notes'}</h2>
          <p>{ar ? 'أضف مستندًا، أدخل بنوده، ثم احفظه كمسودة للمراجعة.' : 'Add a document, enter its line items, and save it as a draft for review.'}</p>
        </div>
        <div className="vat-add-menu-wrap">
          <button type="button" className="vat-button primary vat-add-document" aria-expanded={addMenuOpen} onClick={() => setAddMenuOpen((open) => !open)} disabled={!canCreate || !sellerProfileReady || busy}>
            <span aria-hidden="true">＋</span>{ar ? 'إضافة' : 'Add'}
          </button>
          {addMenuOpen && <div className="vat-add-menu" role="group" aria-label={ar ? 'نوع المستند الجديد' : 'New document type'}>
            <button type="button" onClick={() => startDraft('INVOICE')}><strong>{ar ? 'فاتورة' : 'Invoice'}</strong><small>{ar ? 'إنشاء فاتورة بيع جديدة' : 'Create a new sales invoice'}</small></button>
            <button type="button" onClick={() => startDraft('CREDIT_NOTE')}><strong>{ar ? 'إشعار دائن' : 'Credit note'}</strong><small>{ar ? 'مسودة مرتبطة بفاتورة أصلية' : 'Draft linked to an original invoice'}</small></button>
            <button type="button" onClick={() => startDraft('DEBIT_NOTE')}><strong>{ar ? 'إشعار مدين' : 'Debit note'}</strong><small>{ar ? 'مسودة مرتبطة بفاتورة أصلية' : 'Draft linked to an original invoice'}</small></button>
          </div>}
        </div>
      </div>
      {!registered && <div className="vat-inline-warning">{ar ? 'يجب إكمال تسجيل ضريبة القيمة المضافة قبل إنشاء فاتورة.' : 'Complete VAT registration before creating an invoice.'}</div>}
      {!canCreate && registered && <div className="vat-inline-warning">{ar ? 'إنشاء الفواتير متاح لمالك المؤسسة أو مديرها فقط.' : 'Only an organization owner or admin can create invoices.'}</div>}
      {showDraftForm && documentType !== 'INVOICE' && <div className="vat-inline-warning">{ar ? 'يمكن حفظ الإشعار كمسودة الآن؛ إصدار الإشعارات الدائنة والمدينة غير متاح بعد.' : 'This note can be saved as a draft. Issuing credit and debit notes is not available yet.'}</div>}
      {message && <div className={`vat-notice ${message.error ? 'error' : 'success'}`} role={message.error ? 'alert' : 'status'}>{message.text}</div>}

      {showDraftForm && <form className="vat-form-grid vat-einvoice-form" onSubmit={saveDraft}>
        <fieldset className="vat-einvoice-group">
          <legend>{documentType === 'INVOICE' ? (ar ? 'بيانات الفاتورة' : 'Invoice details') : (ar ? 'بيانات الإشعار' : 'Note details')}</legend>
          <div className="vat-einvoice-group-grid vat-einvoice-first-row">
            <div className="vat-document-contact-field vat-einvoice-buyer-picker">
              <VatContactPicker
                key={`${organizationId}-einvoice-buyer`}
                organizationId={organizationId}
                role="CUSTOMER"
                ar={ar}
                label={ar ? 'العميل / المشتري' : 'Customer / buyer'}
                value={buyerContactId}
                required
                requireSaudiAddress={category === 'STANDARD'}
                onChange={(contact: VatContact | null) => {
                  setBuyerContactId(contact?.id ?? '');
                  setBuyerName(contact?.name ?? '');
                  setBuyerVatNumber(contact?.vat_number ?? '');
                  setBuyerAddress(contact?.street ?? '');
                  setBuyerBuilding(contact?.building_number ?? '');
                  setBuyerDistrict(contact?.district ?? '');
                  setBuyerAdditional(contact?.additional_number ?? '');
                  setBuyerCity(contact?.city ?? '');
                  setBuyerPostalCode(contact?.postal_code ?? '');
                }}
              />
              {category === 'SIMPLIFIED' && <small>{ar ? 'اختر العميل لربط الفاتورة بالمستحق وسندات القبض؛ تفاصيل العنوان غير مطلوبة للمبسطة.' : 'Select a customer to link the receivable and receipts; address details are not required for simplified invoices.'}</small>}
            </div>
            <label><span>{ar ? 'نوع الفاتورة' : 'Invoice type'}</span><select value={category} onChange={(event) => {
              const nextCategory = event.target.value as typeof category;
              setCategory(nextCategory);
            }}><option value="STANDARD">{ar ? 'ضريبية قياسية' : 'Standard tax invoice'}</option><option value="SIMPLIFIED">{ar ? 'مبسطة' : 'Simplified'}</option></select></label>
            <label><span>{ar ? 'رقم الفاتورة' : 'Invoice number'}</span><input required maxLength={100} value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} /></label>
            <label><span>{ar ? 'تاريخ الفاتورة' : 'Invoice date'}</span><input required type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} /></label>
            <label><span>{ar ? 'تاريخ الاستحقاق' : 'Due date'} <small>{ar ? 'اختياري' : 'Optional'}</small></span><input type="date" min={issueDate} value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
            <div className={`vat-document-type-summary ${ar ? 'is-arabic' : ''}`}><small>{ar ? 'نوع المستند' : 'Document type'}</small><strong>{documentType === 'INVOICE' ? (ar ? 'فاتورة' : 'Invoice') : documentType === 'CREDIT_NOTE' ? (ar ? 'إشعار دائن' : 'Credit note') : (ar ? 'إشعار مدين' : 'Debit note')}</strong></div>
          </div>
        </fieldset>
        <div className="vat-einvoice-time-row">
          <label><span>{ar ? 'وقت الإصدار' : 'Issue time'}</span><input required type="time" value={issueTime} onChange={(event) => setIssueTime(event.target.value)} /></label>
        </div>
        {!sellerProfileReady && <div className="vat-inline-warning vat-einvoice-seller-warning">{ar ? 'أكمل ملف تسجيل البائع قبل حفظ الفاتورة.' : 'Complete the seller registration profile before saving the invoice.'}</div>}

        {documentType !== 'INVOICE' && <fieldset className="vat-einvoice-group">
          <legend>{ar ? 'بيانات الإشعار' : 'Credit or debit note details'}</legend>
          <div className="vat-einvoice-group-grid vat-einvoice-group-grid-narrow">
            <label><span>{ar?'الفاتورة الأصلية':'Original invoice'}</span><select required value={precedingInvoiceId || ''} onChange={event=>{const original=invoices.find(row=>row.id===event.target.value);if(original)startNote(original,documentType as 'CREDIT_NOTE'|'DEBIT_NOTE');}}><option value="">{ar?'اختر الفاتورة الأصلية الصادرة':'Choose issued original'}</option>{invoices.filter(row=>row.document_type==='INVOICE' && row.accounting_document_id && ['ISSUED','CLEARED','REPORTED','SUBMITTED'].includes(row.status)).map(row=><option key={row.id} value={row.id}>{row.invoice_number} · {row.buyer_name}</option>)}</select></label>
            <label><span>{ar ? 'مرجع الفاتورة الأصلية' : 'Original invoice reference'}</span><input required maxLength={100} value={billingReference} readOnly={Boolean(precedingInvoiceId)} onChange={(event) => setBillingReference(event.target.value)} /></label>
            <label><span>{ar ? 'سبب الإشعار' : 'Note reason'}</span><input required maxLength={500} value={noteReason} onChange={(event) => setNoteReason(event.target.value)} /></label>
          </div>
        </fieldset>}

        <div className="vat-einvoice-lines">
          <div className="vat-einvoice-lines-toolbar">
            <div className="vat-einvoice-lines-heading"><span className="vat-einvoice-section-icon" aria-hidden="true">▤</span><div><strong>{ar ? 'بنود الفاتورة' : 'Invoice items'}</strong><small>{ar ? 'أدخل البنود وسيتم احتساب الضريبة والإجماليات تلقائيًا.' : 'Enter line items; tax and totals are calculated automatically.'}</small></div></div>
            <div className="vat-einvoice-lines-controls">
              <label className="vat-einvoice-currency"><span>{ar ? 'العملة' : 'Currency'}</span><select disabled={Boolean(precedingInvoiceId)} value={currency} onChange={(event) => setCurrency(event.target.value)}>{currencies.map((item) => <option key={item.code} value={item.code}>{item.code} · {ar ? item.name_ar : item.name_en}</option>)}</select></label>
              <button type="button" className="vat-button secondary vat-edit-fields" aria-expanded={fieldsMenuOpen} aria-controls="vat-einvoice-field-settings" onClick={() => setFieldsMenuOpen((value) => !value)}>{ar ? 'تعديل الحقول' : 'Edit fields'} <span aria-hidden="true">{fieldsMenuOpen ? '⌃' : '⌄'}</span></button>
            </div>
          </div>
          {currency !== 'SAR' && <div className="vat-einvoice-fx-rate"><label><span>{ar ? `سعر الصرف (${currency} إلى SAR)` : `Exchange rate (${currency} to SAR)`}</span><input required type="number" min="0.0000000001" step="0.0000000001" value={exchangeRate} onChange={(event) => setExchangeRate(event.target.value)} /></label><small>{latestFxDate ? (ar ? `آخر سعر محفوظ بتاريخ ${latestFxDate} — يمكنك تعديله لهذه الفاتورة.` : `Latest saved rate: ${latestFxDate}. You can adjust it for this invoice.`) : (ar ? 'لا يوجد سعر صرف محفوظ لهذه العملة؛ أدخل السعر يدويًا.' : 'No saved exchange rate for this currency. Enter it manually.')}</small></div>}
          {fieldsMenuOpen && <div className="vat-einvoice-field-settings" id="vat-einvoice-field-settings" role="group" aria-label={ar ? 'إعدادات حقول الفاتورة' : 'Invoice field settings'}>
            <label><span>{ar ? 'طريقة عرض السعر' : 'Price mode'}</span><select value={pricesIncludeTax ? 'INCLUSIVE' : 'EXCLUSIVE'} onChange={(event) => setPricesIncludeTax(event.target.value === 'INCLUSIVE')}><option value="EXCLUSIVE">{ar ? 'غير شامل الضريبة' : 'Exclusive of tax'}</option><option value="INCLUSIVE">{ar ? 'شامل الضريبة' : 'Inclusive of tax'}</option></select></label>
            <label><span>{ar ? 'طريقة الخصم' : 'Discount type'}</span><select value={discountMode} onChange={(event) => { setDiscountMode(event.target.value as typeof discountMode); setLines((current) => current.map((line) => ({ ...line, discount_amount: '0' }))); }}><option value="NONE">{ar ? 'بدون خصم' : 'No discount'}</option><option value="AMOUNT">{ar ? 'خصم بقيمة' : 'Fixed amount'}</option><option value="PERCENT">{ar ? 'خصم بنسبة مئوية' : 'Percentage discount'}</option></select></label>
            <label className="vat-einvoice-field-toggle"><input type="checkbox" checked={showUnitColumn} onChange={(event) => setShowUnitColumn(event.target.checked)} /><span>{ar ? 'إظهار وحدة القياس' : 'Show unit'}</span></label>
          </div>}
          <div className="vat-einvoice-lines-head"><small>{ar ? 'الوصف، الكمية، سعر الوحدة والمعاملة الضريبية' : 'Description, qty, unit price and tax treatment'}</small><div className="vat-einvoice-line-tools"><button type="button" className="vat-button secondary vat-clear-lines" onClick={() => setLines([emptyLine(String(standardTaxRate))])}>{ar ? 'مسح البنود' : 'Clear lines'}</button></div></div>
          <div className="vat-einvoice-line-scroll"><table className="vat-einvoice-line-table">
            <thead><tr><th>{ar ? 'الوصف / الصنف' : 'Description / item'}</th><th>{ar ? 'الكمية' : 'Qty'}</th><th>{ar ? 'سعر الوحدة' : 'Unit price'}</th><th>{ar ? 'نسبة الضريبة' : 'Tax rate'}</th>{showUnitColumn && <th>{ar ? 'وحدة القياس' : 'Unit'}</th>}{discountMode !== 'NONE' && <th>{discountMode === 'PERCENT' ? (ar ? 'الخصم %' : 'Discount %') : (ar ? 'الخصم (قيمة)' : 'Discount amount')}</th>}<th>{ar ? 'الإجمالي' : 'Total'}</th><th><span className="vat-sr-only">{ar ? 'إجراء' : 'Action'}</span></th></tr></thead>
            <tbody>{lines.map((line, index) => <Fragment key={index}>
              <tr>
                <td><div className="vat-einvoice-service-picker"><select aria-label={ar ? `اختيار وصف البند ${index + 1}` : `Choose line ${index + 1} description`} required value={addingServiceIndex === index ? '__ADD_SERVICE__' : (serviceCatalog.includes(line.item_name) ? line.item_name : (line.item_name ? '__CUSTOM__' : ''))} onChange={(event) => { if (event.target.value === '__ADD_SERVICE__') { updateLine(index, { item_name: '' }); setAddingServiceIndex(index); } else if (event.target.value === '__CUSTOM__') return; else { updateLine(index, { item_name: event.target.value }); setAddingServiceIndex(null); } }}><option value="" disabled>{ar ? 'اختر خدمة أو أضف جديدة' : 'Choose or add a service'}</option>{serviceCatalog.map((name) => <option key={name} value={name}>{name}</option>)}{line.item_name && !serviceCatalog.includes(line.item_name) && <option value="__CUSTOM__">{line.item_name}</option>}<option value="__ADD_SERVICE__">{ar ? '＋ إضافة خدمة جديدة' : '＋ Add a new service'}</option></select>{addingServiceIndex === index && <div className="vat-einvoice-add-service"><input aria-label={ar ? 'اسم الخدمة الجديدة' : 'New service name'} autoFocus required maxLength={200} placeholder={ar ? 'اسم الخدمة' : 'Service name'} value={line.item_name} onChange={(event) => updateLine(index, { item_name: event.target.value })} /><button type="button" className="vat-button secondary" onClick={() => addService(index)}>{ar ? 'حفظ' : 'Save'}</button></div>}</div></td>
                <td><input aria-label={ar ? `كمية البند ${index + 1}` : `Line ${index + 1} quantity`} required type="number" min="0.000001" step="0.000001" value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.target.value })} /></td>
                <td><input aria-label={ar ? `سعر البند ${index + 1}` : `Line ${index + 1} unit price`} required type="number" min="0" step="0.000001" placeholder={ar ? 'المبلغ' : 'Amount'} value={line.unit_price} onChange={(event) => updateLine(index, { unit_price: event.target.value })} /></td>
                <td><div className="vat-einvoice-tax-cell"><select aria-label={ar ? `تصنيف البند ${index + 1}` : `Line ${index + 1} tax treatment`} value={line.tax_category} onChange={(event) => updateLine(index, { tax_category: event.target.value as InvoiceLine['tax_category'], tax_rate: event.target.value === 'S' ? String(standardTaxRate) : '0' })}><option value="S">{ar ? 'قياسي' : 'Standard'}</option><option value="Z">{ar ? 'صفري' : 'Zero-rated'}</option><option value="E">{ar ? 'معفى' : 'Exempt'}</option><option value="O">{ar ? 'خارج النطاق' : 'Out of scope'}</option></select>{line.tax_category === 'S' ? <input aria-label={ar ? `نسبة ضريبة البند ${index + 1}` : `Line ${index + 1} VAT rate`} required type="number" min="0.01" max="100" step="0.01" value={line.tax_rate} onChange={(event) => updateLine(index, { tax_rate: event.target.value })} /> : <span className="vat-einvoice-zero-rate">0%</span>}</div></td>
                {showUnitColumn && <td><select aria-label={ar ? `وحدة البند ${index + 1}` : `Line ${index + 1} unit`} value={line.unit_code} onChange={(event) => updateLine(index, { unit_code: event.target.value })}><option value="PCE">{ar ? 'قطعة' : 'Piece'}</option><option value="HUR">{ar ? 'ساعة' : 'Hour'}</option><option value="DAY">{ar ? 'يوم' : 'Day'}</option><option value="KGM">{ar ? 'كجم' : 'Kilogram'}</option><option value="LTR">{ar ? 'لتر' : 'Litre'}</option><option value="MTR">{ar ? 'متر' : 'Metre'}</option></select></td>}
                {discountMode !== 'NONE' && <td><input aria-label={discountMode === 'PERCENT' ? (ar ? `نسبة خصم البند ${index + 1}` : `Line ${index + 1} discount percentage`) : (ar ? `قيمة خصم البند ${index + 1}` : `Line ${index + 1} discount amount`)} type="number" min="0" max={discountMode === 'PERCENT' ? 100 : undefined} step="0.01" value={line.discount_amount} onChange={(event) => updateLine(index, { discount_amount: event.target.value })} /></td>}
                <td className="vat-einvoice-line-total">{formatAmount(lineAmounts(line).total)} <small>{currency}</small></td>
                <td>{lines.length > 1 && <button type="button" className="vat-delete" aria-label={ar ? `حذف البند ${index + 1}` : `Remove line ${index + 1}`} onClick={() => setLines((current) => current.filter((_, i) => i !== index))}>×</button>}</td>
              </tr>
              {(line.tax_category === 'Z' || line.tax_category === 'E') && <tr className="vat-einvoice-tax-reason"><td colSpan={6 + Number(showUnitColumn) + Number(discountMode !== 'NONE')}><div>
                <label><span>{ar ? 'رمز سبب المعاملة' : 'Treatment reason code'}</span><input required maxLength={20} value={line.tax_exemption_reason_code} onChange={(event) => updateLine(index, { tax_exemption_reason_code: event.target.value })} /></label>
                <label><span>{ar ? 'شرح السبب' : 'Reason description'}</span><input required maxLength={500} value={line.tax_exemption_reason} onChange={(event) => updateLine(index, { tax_exemption_reason: event.target.value })} /></label>
              </div></td></tr>}
            </Fragment>)}</tbody>
            <tfoot><tr><td colSpan={6 + Number(showUnitColumn) + Number(discountMode !== 'NONE')}><button type="button" className="vat-add-line-inline" onClick={() => setLines((current) => [...current, emptyLine(String(standardTaxRate))])}><span aria-hidden="true">＋</span>{ar ? 'إضافة بند' : 'Add item'}</button></td></tr></tfoot>
          </table></div>
          <div className="vat-einvoice-line-summary" role="group" aria-label={ar ? 'ملخص الفاتورة' : 'Invoice summary'}>
            <div className="vat-einvoice-summary-fx">
              <small><span aria-hidden="true">ⓘ</span>{ar ? 'سعر الصرف المستخدم' : 'Exchange rate'}</small>
              <strong>{currency === 'SAR' ? (ar ? 'العملة الأساسية · SAR' : 'Base currency · SAR') : <bdi dir="ltr">1 {currency} = {formatAmount(Number(exchangeRate || 0))} SAR</bdi>}</strong>
            </div>
            <div className="vat-einvoice-summary-item">
              <span className="vat-einvoice-summary-copy"><small>{ar ? 'الإجمالي قبل الضريبة' : 'Subtotal before VAT'}</small><strong>{formatAmount(subtotal)} <small>{currency}</small></strong>{currency !== 'SAR' && <em>{formatAmount(subtotal * Number(exchangeRate || 0))} SAR</em>}</span>
            </div>
            <div className="vat-einvoice-summary-item tax">
              <span className="vat-einvoice-summary-copy"><small>{ar ? 'ضريبة القيمة المضافة' : 'VAT'}</small><strong>{formatAmount(totalTax)} <small>{currency}</small></strong>{currency !== 'SAR' && <em>{formatAmount(totalTax * Number(exchangeRate || 0))} SAR</em>}</span>
            </div>
            <div className="vat-einvoice-summary-item total">
              <span className="vat-einvoice-summary-copy"><small>{ar ? 'الإجمالي المستحق' : 'Total due'}</small><strong>{formatAmount(grandTotal)} <small>{currency}</small></strong>{currency !== 'SAR' && <em>{formatAmount(grandTotal * Number(exchangeRate || 0))} SAR</em>}</span>
            </div>
          </div>
        </div>
        <div className="vat-form-actions"><button type="button" className="vat-button secondary" disabled={busy} onClick={() => { setShowDraftForm(false); setEditingDraftId(null); setAccountingSourceId(null); setNoteSource(null); setAddMenuOpen(false); }}>{ar ? 'إلغاء' : 'Cancel'}</button><button className="vat-button primary" disabled={!canCreate || !sellerProfileReady || busy || !vatNumber || !Number.isFinite(Number(exchangeRate)) || Number(exchangeRate) <= 0}>{busy ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : (ar ? (editingDraftId ? 'حفظ التعديلات' : 'حفظ كمسودة') : (editingDraftId ? 'Save changes' : 'Save as draft'))}</button></div>
      </form>}

      {collectionInvoice?.cash_flow && <div className="vat-import-panel">
        <div className="vat-section-heading"><div><h4>{ar ? 'تسجيل وتأكيد قبض الفاتورة' : 'Record and confirm invoice collection'}</h4><p>{ar ? `فاتورة ${collectionInvoice.invoice_number} · العميل: ${collectionInvoice.buyer_name || '—'}` : `Invoice ${collectionInvoice.invoice_number} · Customer: ${collectionInvoice.buyer_name || '—'}`}</p></div></div>
        <div className="vat-grid">
          <label><span>{ar ? 'إجمالي الفاتورة' : 'Invoice total'}</span><input value={`${formatAmount(collectionInvoice.cash_flow.amount)} ${collectionInvoice.cash_flow.currency}`} disabled /></label>
          <label><span>{ar ? 'المقبوض سابقًا' : 'Previously collected'}</span><input value={`${formatAmount(collectionInvoice.cash_flow.settled_amount || 0)} ${collectionInvoice.cash_flow.currency}`} disabled /></label>
          <label><span>{ar ? 'المتبقي' : 'Outstanding'}</span><input value={`${formatAmount(Math.max(0,Number(collectionInvoice.cash_flow.amount)-Number(collectionInvoice.cash_flow.settled_amount||0)))} ${collectionInvoice.cash_flow.currency}`} disabled /></label>
          <label><span>{ar ? 'مبلغ القبض' : 'Collection amount'}</span><input type="number" min="0.01" step="0.01" value={collectionAmount} onChange={(e)=>setCollectionAmount(e.target.value)} /></label>
          <label><span>{ar ? 'تاريخ القبض' : 'Collection date'}</span><input type="date" value={collectionDate} onChange={(e)=>setCollectionDate(e.target.value)} /></label>
          <label><span>{ar ? 'حساب القبض' : 'Collection account'}</span><select value={collectionAccountId} onChange={(e)=>setCollectionAccountId(e.target.value)}><option value="">{ar ? 'اختر حساب القبض' : 'Choose collection account'}</option>{cashAccounts.filter(a=>a.currency===collectionInvoice.cash_flow?.currency).map(a=><option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}</select></label>
        </div>
        <div className="vat-form-actions"><button type="button" className="vat-button secondary" disabled={busy} onClick={()=>setCollectionInvoice(null)}>{ar?'إلغاء':'Cancel'}</button><button type="button" className="vat-button primary" disabled={busy || !collectionAccountId || !collectionAmount || !collectionDate} onClick={()=>void confirmCollection()}>{busy?(ar?'جارٍ التسجيل…':'Posting…'):(ar?'تأكيد القبض':'Confirm collection')}</button></div>
      </div>}

      {receiptInvoice?.accounting_document_id && <VatInvoiceReceipts key={`${organizationId}:${receiptInvoice.accounting_document_id}`} organizationId={organizationId} documentId={receiptInvoice.accounting_document_id} invoiceNumber={receiptInvoice.invoice_number} accounts={cashAccounts} canEdit={canCreate} ar={ar} onClose={() => setReceiptInvoice(null)} onPosted={() => {
        fetch(`/api/vat/e-invoices?organization_id=${encodeURIComponent(organizationId)}`).then(async (response) => { if (response.ok) setInvoices((await response.json()).invoices ?? []); }).catch(() => undefined);
        onInvoiceIssued?.();
      }} />}
      <InvoiceRegisterFilters value={filters} onChange={setFilters} ar={ar} count={visibleInvoices.length} total={invoices.length} currencies={[...new Set(invoices.map(invoice => invoice.currency))].sort()} statuses={[['DRAFT',ar?'مسودة':'Draft'],['ACCOUNTING_READY',ar?'جاهزة للإصدار':'Ready to issue'],['ISSUED',ar?'صادرة':'Issued'],['CLEARED',ar?'معتمدة':'Cleared'],['REPORTED',ar?'مبلغ عنها':'Reported'],['SUBMITTED',ar?'مرسلة':'Submitted'],['REJECTED',ar?'مرفوضة':'Rejected'],['VOID',ar?'ملغاة':'Void']]} categories={[['STANDARD',ar?'ضريبية':'Standard'],['SIMPLIFIED',ar?'مبسطة':'Simplified']]} />
      <div className="vat-einvoice-list" aria-live="polite">
        {loading && <div className="vat-empty-row">{ar ? 'جارٍ تحميل الفواتير…' : 'Loading invoices…'}</div>}
        {!loading && visibleInvoices.map((invoice) => <div className="vat-einvoice-item" key={invoice.id}>
          <div><strong>{invoice.invoice_number} <span className="vat-invoice-party">{invoice.buyer_name || (ar ? 'عميل غير محدد' : 'No customer')}</span></strong><small>{invoice.document_type !== 'INVOICE' ? (invoice.document_type === 'CREDIT_NOTE' ? (ar ? 'إشعار دائن' : 'Credit note') : (ar ? 'إشعار مدين' : 'Debit note')) : (ar ? 'فاتورة' : 'Invoice')} · {invoice.issue_date}{invoice.due_date ? ` · ${ar ? 'استحقاق' : 'Due'}: ${invoice.due_date}` : ''} · {invoice.invoice_category === 'STANDARD' ? (ar ? 'قياسية' : 'Standard') : (ar ? 'مبسطة' : 'Simplified')} · {invoice.lines.length} {ar ? 'بنود' : 'lines'}</small></div>
          <div className="vat-einvoice-total">{formatAmount(invoice.payable_amount)} {invoice.currency}{invoice.currency !== 'SAR' && invoice.exchange_rate && <small className="vat-einvoice-sar-total">{formatAmount(Number(invoice.payable_amount) * Number(invoice.exchange_rate))} SAR</small>}</div>
          <span className={`vat-status ${invoice.status === 'ISSUED' ? 'registered' : ''}`}>{invoice.status === 'ISSUED' ? (ar ? 'صادرة — QR المرحلة الأولى' : 'Issued — Phase 1 QR') : invoice.status === 'ACCOUNTING_READY' ? (ar ? 'جاهزة للإصدار' : 'Ready to issue') : invoice.status === 'DRAFT' && !invoice.accounting_document_id ? (ar ? 'مسودة غير مرتبطة محاسبيًا' : 'Unlinked accounting draft') : invoice.status === 'DRAFT' ? (ar ? 'مسودة' : 'Draft') : ({ SUBMITTED: ar ? 'مرسلة' : 'Submitted', CLEARED: ar ? 'معتمدة من زاتكا' : 'Cleared', REPORTED: ar ? 'تم الإبلاغ' : 'Reported', REJECTED: ar ? 'مرفوضة' : 'Rejected', VOID: ar ? 'ملغاة' : 'Void' } as Record<string,string>)[invoice.status] || invoice.status}</span>
          {invoice.cash_flow && <div className="vat-invoice-outstanding"><small>{ar ? 'المتبقي' : 'Outstanding'}</small><strong>{formatAmount(Math.max(0,Number(invoice.cash_flow.amount)-Number(invoice.cash_flow.settled_amount||0)))} {invoice.cash_flow.currency}</strong><small>{invoicePaymentState({id:invoice.id,number:'',name:'',date:'',currency:invoice.currency,baseAmount:0,flow:invoice.cash_flow}) === 'PARTIAL' ? (ar ? 'تحصيل جزئي' : 'Partially collected') : ''}</small></div>}
          <InvoicePaymentBadge flow={invoice.cash_flow} ar={ar} note={invoice.document_type !== 'INVOICE'} />
          <div className="vat-invoice-actions" role="group" aria-label={ar ? `إجراءات الفاتورة ${invoice.invoice_number}` : `Invoice ${invoice.invoice_number} actions`}>
            {invoice.accounting_document_id && invoice.document_type === 'INVOICE' && <button type="button" className="vat-button secondary" disabled={busy} onClick={() => { setReceiptInvoice(invoice); setCollectionInvoice(null); }}>{ar ? 'سندات القبض' : 'Receipts'}</button>}
            {invoice.status === 'ACCOUNTING_READY' && <button type="button" className="vat-button primary" disabled={busy || !canCreate} onClick={() => prepareAccountingInvoiceForZatca(invoice)}>{ar ? 'تجهيز مسودة زاتكا' : 'Prepare ZATCA draft'}</button>}
            {invoice.document_type === 'INVOICE' && invoice.financial_event && invoice.financial_event.status === 'COMMITTED' && <button type="button" className="vat-button secondary" disabled={busy || !canCreate} onClick={()=>postNote(invoice)}>{ar?'اعتماد المحاسبة':'Post accounting'}</button>}
            {invoice.document_type !== 'INVOICE' && ['ISSUED','CLEARED','REPORTED','SUBMITTED'].includes(invoice.status) && invoice.financial_event?.status !== 'ACTUAL' && <button type="button" className="vat-button primary" disabled={busy || !canCreate} onClick={() => postNote(invoice)}>{ar ? 'اعتماد الأثر المحاسبي' : 'Post accounting effect'}</button>}
            {invoice.document_type !== 'INVOICE' && invoice.financial_event?.status === 'ACTUAL' && <span className="vat-payment-badge paid">{ar ? 'الأثر مرحّل' : 'Effect posted'}</span>}
            {invoice.document_type !== 'INVOICE' && invoice.cash_flow && <a className="vat-button secondary" href={ar?'/ar/liquidity':'/en/liquidity'}>{ar?'تسوية الإشعار في السيولة':'Settle note in liquidity'}</a>}
            {invoice.status === 'DRAFT' && invoice.document_type === 'INVOICE' && <button type="button" className="vat-button secondary" disabled={busy || !canCreate || editingDraftId === invoice.id} onClick={() => editDraft(invoice)}>{ar ? (editingDraftId === invoice.id ? 'قيد التعديل' : 'تعديل') : (editingDraftId === invoice.id ? 'Editing' : 'Edit')}</button>}
            {invoice.document_type === 'INVOICE' && invoice.cash_flow && Math.max(0, Number(invoice.cash_flow.amount)-Number(invoice.cash_flow.settled_amount||0)) > 0 && <button type="button" className="vat-button secondary" disabled={busy || !canCreate} onClick={() => openCollection(invoice)}>{ar ? 'قبض' : 'Collect'}</button>}
            {invoice.status === 'DRAFT' && <button type="button" className="vat-button primary" disabled={busy || !canCreate || editingDraftId === invoice.id || !invoice.accounting_document_id} onClick={() => void issueInvoice(invoice)}>{ar ? 'إصدار — QR المرحلة الأولى' : 'Issue — Phase 1 QR'}</button>}
            {invoice.status === 'DRAFT' && <button type="button" className="vat-button vat-action-danger" disabled={busy || !canCreate || editingDraftId === invoice.id} onClick={() => void deleteDraft(invoice)}>{ar ? 'حذف' : 'Delete'}</button>}
            {['ISSUED','CLEARED','REPORTED','SUBMITTED'].includes(invoice.status) && invoice.document_type === 'INVOICE' && <button type="button" className="vat-button secondary" disabled={busy} onClick={() => startNote(invoice,'CREDIT_NOTE')}>{ar ? 'إشعار دائن' : 'Credit note'}</button>}
            {['ISSUED','CLEARED','REPORTED','SUBMITTED'].includes(invoice.status) && invoice.document_type === 'INVOICE' && <button type="button" className="vat-button secondary" disabled={busy} onClick={() => startNote(invoice,'DEBIT_NOTE')}>{ar ? 'إشعار مدين' : 'Debit note'}</button>}
            {!['VOID','REJECTED'].includes(invoice.status) && <button type="button" className="vat-button secondary" onClick={() => void printInvoice(invoice)}>{ar ? 'طباعة / PDF' : 'Print / PDF'}</button>}
          </div>
        </div>)}
        {!loading && !visibleInvoices.length && <div className="vat-empty-row">{invoices.length ? (ar ? 'لا توجد فواتير تطابق الفلاتر.' : 'No invoices match the filters.') : (ar ? 'لا توجد فواتير بعد.' : 'No invoices yet.')}</div>}
      </div>
      <p className="vat-einvoice-help">{ar ? 'رمز QR عند الإصدار يطبق حقول المرحلة الأولى (الاسم، الرقم الضريبي، الوقت، الإجمالي والضريبة). لا ترسل هذه العملية الفاتورة إلى زاتكا ولا تطبق تكامل المرحلة الثانية أو ختم XML. إذا كان نشاطك ضمن موجة المرحلة الثانية، أكمل ربط الإنتاج قبل الاعتماد.' : 'Issuing creates the five Phase 1 QR fields (seller, VAT number, timestamp, total and VAT). It does not submit the invoice to ZATCA or apply Phase 2 XML stamping. If your business is in a Phase 2 wave, complete production onboarding before relying on this flow.'}</p>
    </section>
  );
}

function formatAmount(value: string | number) {
  return Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function messageFor(code: string, ar: boolean) {
  const labels: Record<string, [string, string]> = {
    ...vatNoteMessages,
    UNAUTHORIZED: ['يلزم تسجيل الدخول.', 'Please sign in.'],
    ORGANIZATION_ACCESS_REQUIRED: ['ليس لديك صلاحية الوصول إلى هذه المؤسسة.', 'You do not have access to this organization.'],
    ORGANIZATION_ADMIN_REQUIRED: ['إنشاء المسودات متاح لمالك المؤسسة أو مديرها.', 'Only an organization owner or admin can create drafts.'],
    EINVOICE_ACCOUNTING_BASE_CURRENCY_UNSUPPORTED: ['يلزم أساس محاسبي بالريال لربط هذه الفاتورة متعددة العملات.', 'This multicurrency ZATCA link requires a SAR accounting base.'],
    STANDARD_TAX_RATE_MISMATCH: ['نسبة الضريبة القياسية يجب أن تطابق النسبة المسجلة للمنشأة.', 'Standard tax rate must match the organization registration.'],
    EINVOICE_ACCOUNTING_SOURCE_MISMATCH: ['بيانات الفاتورة لا تطابق مصدرها المحاسبي.', 'Invoice details do not match the accounting source.'],
    EINVOICE_DRAFT_LOCKED: ['الفاتورة صادرة ولا تقبل التعديل المباشر.', 'The issued invoice cannot be edited directly.'],
    VAT_NOTE_MUST_BE_ISSUED: ['أصدر الإشعار قبل ترحيل أثره.', 'Issue the note before posting its effect.'],
    VAT_ORIGINAL_RECOGNITION_REQUIRED: ['اعتمد الفاتورة الأصلية محاسبيًا أولًا.', 'Post original invoice recognition first.'],
    VAT_CREDIT_EXCEEDS_ORIGINAL: ['إجمالي الإشعارات الدائنة يتجاوز قيمة الفاتورة الأصلية أو ضريبتها.', 'Credits exceed original invoice value or VAT.'],
    VAT_NOTE_FILED_PERIOD_LOCKED: ['هذه الفترة مقدمة؛ اختر الفترة الصحيحة للإشعار وراجع معالجة التصحيح.', 'Period is filed; choose the correct note period and review correction treatment.'],
    VAT_NOTE_ORIGINAL_IDENTITY_OR_CURRENCY_MISMATCH: ['يجب مطابقة العميل والعملة وسعر الصرف مع الأصل.', 'Customer, currency and FX must match original.'],
    VAT_DOCUMENT_SETTLED_LOCKED: ['بدأ القبض على هذه الفاتورة؛ لا يمكن تغيير قيمتها أو عميلها.', 'Collection has started; invoice value and customer are locked.'],
    VAT_FINANCIAL_EVENT_LOCKED: ['الفاتورة مرحلة محاسبيًا؛ استخدم إجراء تصحيح معتمد.', 'The accounting event is posted; use an approved correction.'],
    SETTLEMENT_INSTRUCTION_CONFLICT: ['يوجد سند قبض محفوظ ببيانات مختلفة. افتح سندات قبض الفاتورة لمراجعته وتعديله قبل إعادة التنفيذ.', 'A saved receipt has different details. Open the invoice receipts to review and amend it before retrying.'],
    SETTLEMENT_EXCEEDS_FLOW_OUTSTANDING: ['المبلغ يتجاوز المتبقي الحالي. حدّث الفواتير وأدخل المبلغ الصحيح.', 'Amount exceeds current outstanding. Refresh and enter the correct amount.'],
    SETTLEMENT_FLOW_ACCOUNT_MISMATCH: ['هذا المستحق مرتبط بحساب قبض محدد؛ اختر الحساب نفسه.', 'This receivable is linked to a collection account; use that account.'],
    EINVOICE_REQUEST_FAILED: ['تعذر الحفظ. راجع البيانات؛ لم يتم تأكيد الحفظ.', 'Save failed. Review the details; saving was not confirmed.'],
    ACCOUNTING_INVOICE_NUMBER_EXISTS: ['رقم الفاتورة مستخدم محاسبيًا؛ افتح الفاتورة من السجل لتجهيزها لزاتكا.', 'This number exists in accounting. Prepare that invoice from the register.'],
    VAT_PROFILE_REQUIRED: ['احفظ ملف التسجيل الضريبي أولًا.', 'Save the VAT registration profile first.'],
    VAT_REGISTRATION_REQUIRED: ['يجب أن تكون المؤسسة مسجلة في ضريبة القيمة المضافة.', 'The organization must be VAT registered.'],
    SELLER_VAT_MISMATCH: ['يجب أن يطابق رقم البائع الرقم الضريبي المسجل للمؤسسة.', 'The seller VAT number must match the organization profile.'],
    SELLER_PROFILE_INCOMPLETE: ['أكمل الاسم النظامي والعنوان الوطني في ملف التسجيل قبل حفظ الفاتورة.', 'Complete the legal name and national address in the registration profile before saving.'],
    INVALID_CURRENCY_CODE: ['رمز العملة يجب أن يكون من ثلاثة أحرف كبيرة.', 'Currency code must be a three-letter ISO code.'],
    CURRENCY_NOT_ACTIVE: ['العملة المختارة غير مفعّلة. فعّلها من إعدادات العملات ثم أعد المحاولة.', 'The selected currency is not active. Enable it in currency settings and try again.'],
    SAR_EXCHANGE_RATE_MUST_BE_ONE: ['سعر الريال السعودي يجب أن يساوي 1.', 'The SAR exchange rate must equal 1.'],
    VAT_CONTACT_NOT_FOUND: ['الجهة المختارة غير موجودة في المؤسسة.', 'The selected contact was not found in this organization.'],
    VAT_CONTACT_TYPE_MISMATCH: ['الجهة المحددة ليست مسجلة كعميل.', 'The selected contact is not registered as a customer.'],
    EINVOICE_NUMBER_EXISTS: ['رقم الفاتورة مستخدم من قبل في هذه المؤسسة.', 'This invoice number is already used in this organization.'],
    PRECEDING_INVOICE_NOT_ISSUED: ['يجب أن تكون الفاتورة الأصلية صادرة قبل إنشاء الإشعار.', 'The original invoice must be issued before creating a note.'],
    NOTE_INVOICE_CATEGORY_MISMATCH: ['يجب أن يطابق نوع الإشعار نوع الفاتورة الأصلية.', 'The note category must match the original invoice.'],
    STANDARD_TAX_RATE_REQUIRED: ['أدخل نسبة ضريبة أكبر من صفر للبند القياسي.', 'Enter a VAT rate above zero for a standard line.'],
    ZERO_TAX_RATE_REQUIRED: ['استخدم نسبة صفرية لتصنيف البند المحدد.', 'Use a zero rate for the selected tax category.'],
    TAX_TREATMENT_REASON_REQUIRED: ['أدخل رمز وسبب الإعفاء أو النسبة الصفرية.', 'Enter a reason code and description for exempt or zero-rated lines.'],
    STANDARD_BUYER_REQUIRED: ['أدخل اسم المشتري للفاتورة القياسية.', 'Enter the buyer name for a standard invoice.'],
    STANDARD_BUYER_ADDRESS_REQUIRED: ['أدخل عنوان المشتري للفاتورة القياسية.', 'Enter the buyer address for a standard invoice.'],
    STANDARD_BUYER_CITY_REQUIRED: ['أدخل مدينة المشتري للفاتورة القياسية.', 'Enter the buyer city for a standard invoice.'],
    STANDARD_BUYER_DISTRICT_REQUIRED: ['أدخل حي المشتري للفاتورة القياسية.', 'Enter the buyer district for a standard invoice.'],
    STANDARD_BUYER_POSTAL_REQUIRED: ['أدخل الرمز البريدي للمشتري من 5 أرقام.', 'Enter the buyer 5-digit postal code.'],
    STANDARD_BUYER_BUILDING_REQUIRED: ['أدخل رقم مبنى المشتري من 4 أرقام.', 'Enter the buyer 4-digit building number.'],
    INVALID_SELLER_BUILDING_NUMBER: ['رقم مبنى البائع يجب أن يتكون من 4 أرقام.', 'Seller building number must contain 4 digits.'],
    INVALID_SELLER_ADDITIONAL_NUMBER: ['الرقم الإضافي للبائع يجب أن يتكون من 4 أرقام.', 'Seller additional number must contain 4 digits.'],
    INVALID_SELLER_POSTAL_CODE: ['الرمز البريدي للبائع يجب أن يتكون من 5 أرقام.', 'Seller postal code must contain 5 digits.'],
    INVALID_BUYER_BUILDING_NUMBER: ['رقم مبنى المشتري يجب أن يتكون من 4 أرقام.', 'Buyer building number must contain 4 digits.'],
    INVALID_BUYER_POSTAL_CODE: ['الرمز البريدي للمشتري يجب أن يتكون من 5 أرقام.', 'Buyer postal code must contain 5 digits.'],
    INVALID_BUYER_ADDITIONAL_NUMBER: ['الرقم الإضافي للمشتري يجب أن يتكون من 4 أرقام.', 'Buyer additional number must contain 4 digits.'],
    NOTE_INVOICE_REFERENCE_REQUIRED: ['أدخل مرجع الفاتورة الأصلية للإشعار.', 'Enter the original invoice reference for this note.'],
    NOTE_REASON_REQUIRED: ['أدخل سبب الإشعار.', 'Enter a reason for the note.'],
    DUE_DATE_BEFORE_ISSUE_DATE: ['يجب أن يكون تاريخ الاستحقاق في يوم الإصدار أو بعده.', 'The due date must be on or after the issue date.'],
    EINVOICE_NOTES_NOT_SUPPORTED: ['استيراد الإشعارات الدائنة والمدينة غير متاح حاليًا؛ استورد الفواتير فقط.', 'Credit and debit note import is not available yet; import invoices only.'],
    EINVOICE_NOT_DRAFT: ['هذه الفاتورة ليست مسودة قابلة للإصدار.', 'This invoice is not a draft that can be issued.'],
    NOTE_ISSUANCE_NOT_SUPPORTED: ['إصدار الإشعارات الدائنة أو المدينة غير متاح حتى الآن.', 'Credit and debit note issuance is not available yet.'],
    EINVOICE_ISSUE_FAILED: ['تعذر إصدار الفاتورة. تحقق من البيانات وحاول مجددًا.', 'Could not issue the invoice. Check the details and try again.'],
    IMPORT_FILE_TOO_LARGE: ['حجم الملف يتجاوز 5 ميغابايت.', 'The file exceeds 5 MB.'],
    IMPORT_FILE_EMPTY: ['الملف لا يحتوي على صفوف بيانات.', 'The file has no data rows.'],
    IMPORT_HEADERS_MISSING: ['يجب أن يحتوي الملف على عمودي invoice_number و item_name على الأقل.', 'The file must include invoice_number and item_name columns.'],
    IMPORT_FILE_TYPE_UNSUPPORTED: ['اختر ملف CSV أو Excel بصيغة XLSX.', 'Choose a CSV or XLSX Excel file.'],
    IMPORT_TOO_MANY_INVOICES: ['الحد الأقصى 200 فاتورة في العملية الواحدة.', 'Import up to 200 invoices at a time.'],
    IMPORT_CSV_UNCLOSED_QUOTE: ['يوجد اقتباس غير مغلق في ملف CSV.', 'A quoted field is not closed in the CSV file.'],
    IMPORT_INVOICE_NUMBER_MISSING: ['يوجد صف بلا رقم فاتورة.', 'A row is missing an invoice number.'],
    EINVOICE_NOT_FOUND: ['لم يتم العثور على الفاتورة.', 'Invoice not found.'],
    EINVOICE_DELETE_ISSUED_FORBIDDEN: ['لا يمكن حذف فاتورة صادرة. استخدم إشعارًا دائنًا أو مدينًا.', 'An issued invoice cannot be deleted. Use a credit or debit note.'],
    EINVOICE_DELETE_SETTLED_FORBIDDEN: ['لا يمكن حذف فاتورة بدأ عليها قبض أو تسوية.', 'An invoice with collection or settlement activity cannot be deleted.'],
    EINVOICE_DELETE_FINANCIAL_LOCKED: ['لا يمكن حذف مسودة ارتبطت بتسجيل مالي معتمد أو فعلي أو موازنة.', 'A draft linked to approved or actual recognition or a budget cannot be deleted.'],
    EINVOICE_DELETE_REFERENCED_FORBIDDEN: ['لا يمكن حذف مسودة مرتبطة بمستندات أخرى.', 'A draft referenced by other documents cannot be deleted.'],
    VAT_DOCUMENT_NUMBER_EXISTS: ['رقم الفاتورة مستخدم محاسبيًا من قبل في هذه المؤسسة.', 'This invoice number already exists in the accounting register.'],
    VAT_FINANCIAL_ENTITY_REQUIRED: ['يجب ضبط كيان مالي واحد نشط للمنشأة قبل الحفظ.', 'Configure exactly one active financial entity before saving.'],
    VAT_FINANCIAL_CLASSIFICATIONS_REQUIRED: ['تصنيفات الإيراد والضريبة في الأساس المالي غير مكتملة.', 'Financial Core revenue/tax classifications are incomplete.'],
    VAT_STABLE_CONTACT_REQUIRED: ['اختر عميلاً محفوظًا من قائمة العملاء قبل الحفظ.', 'Select a saved customer before saving.'],
    QR_FIELD_TOO_LONG: ['إحدى بيانات QR أطول من الحد المسموح.', 'A QR field exceeds the supported size.'],
  };
  if (code.startsWith('LINE_DISCOUNT_EXCEEDS_AMOUNT:')) return ar ? 'لا يمكن أن يتجاوز الخصم إجمالي قيمة البند.' : 'A line discount cannot exceed the line amount.';
  if (labels[code]) return labels[code][ar ? 0 : 1];
  const safeCode = /^[A-Z0-9_:-]+$/.test(code) ? code : 'UNKNOWN_ERROR';
  return ar ? 'تعذر حفظ المسودة (' + safeCode + ').' : 'Could not save the draft (' + safeCode + ').';
}
