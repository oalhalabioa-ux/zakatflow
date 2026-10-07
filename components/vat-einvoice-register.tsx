'use client';

import { Fragment, FormEvent, useEffect, useRef, useState } from 'react';
import { groupImportRecords, parseCsv, rowsToRecords } from '@/lib/vat-einvoice-import';
import { applyInvoiceLineDiscount, normalizeInvoiceLinePrice, previewInvoiceLine } from '@/lib/vat-invoice-price-mode';
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
  cash_flow?: { id: string; amount: string; settled_amount: string; settlement_status: string; status: string; currency: string; due_date: string } | null;
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
  const [noteReason, setNoteReason] = useState('');
  const [lines, setLines] = useState<InvoiceLine[]>(() => [emptyLine(String(standardTaxRate))]);
  const importInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [cashAccounts, setCashAccounts] = useState<Array<{id:string;name:string;currency:string}>>([]);
  const [noteSource, setNoteSource] = useState<Invoice | null>(null);
  const sellerProfileReady = Boolean(
    sellerProfile.registered_name.trim() && sellerProfile.seller_street.trim() &&
    /^\d{4}$/.test(sellerProfile.seller_building_number) && sellerProfile.seller_district.trim() &&
    /^\d{4}$/.test(sellerProfile.seller_additional_number) && sellerProfile.seller_city.trim() &&
    /^\d{5}$/.test(sellerProfile.seller_postal_code),
  );

  useEffect(() => {
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
    fetch(`/api/liquidity?organization_id=${encodeURIComponent(organizationId)}`).then(r => r.ok ? r.json() : null).then(body => {
      if (body?.accounts) setCashAccounts(body.accounts.map((a: any) => ({ id:a.id, name:a.name, currency:a.currency })));
    }).catch(() => undefined);
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
    if (editingDraftId) return;
    const latest = fxRates.find((item) => item.from_currency === currency && item.to_currency === 'SAR')
      ?? fxRates.find((item) => item.from_currency === 'SAR' && item.to_currency === currency);
    if (latest) setExchangeRate(String(latest.from_currency === currency ? latest.rate : (1 / Number(latest.rate))));
  }, [currency, fxRates, editingDraftId]);

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      let accountingDocumentId: string | null = null;
      if (!editingDraftId && documentType !== 'INVOICE') {
        if (!noteSource?.accounting_document_id) throw new Error('VAT_ORIGINAL_ACCOUNTING_INVOICE_REQUIRED');
        const accountingResponse = await fetch('/api/vat', {
          method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
            action:'add_document', organization_id:organizationId, document_type:'SALES', document_kind:documentType,
            document_number:invoiceNumber, transaction_date:issueDate, due_date:dueDate || issueDate,
            preceding_document_id:noteSource.accounting_document_id, counterparty_contact_id:buyerContactId,
            counterparty_name:buyerName, counterparty_tax_number:buyerVatNumber || null,
            supply_type:lines[0]?.tax_category === 'S' ? 'STANDARD' : lines[0]?.tax_category === 'Z' ? 'ZERO_RATED' : lines[0]?.tax_category === 'E' ? 'EXEMPT' : 'OUT_OF_SCOPE',
            net_amount:lines.reduce((sum,line)=>sum + Number(line.quantity||0)*Number(line.unit_price||0)-Number(line.discount_amount||0),0),
            lines:lines.map(line=>({description:line.item_name || line.description || 'Adjustment',unit:line.unit_code,quantity:Number(line.quantity),unit_price:Number(line.unit_price),discount_amount:Number(line.discount_amount||0),supply_type:line.tax_category === 'S' ? 'STANDARD' : line.tax_category === 'Z' ? 'ZERO_RATED' : line.tax_category === 'E' ? 'EXEMPT' : 'OUT_OF_SCOPE'})),
            currency, exchange_rate:Number(exchangeRate), recoverable_percent:100, notes:noteReason || billingReference,
          })
        });
        const accountingBody = await accountingResponse.json();
        if (!accountingResponse.ok) throw new Error(accountingBody?.error || `HTTP_${accountingResponse.status}`);
        accountingDocumentId = accountingBody.id;
      }
      const response = await fetch('/api/vat/e-invoices', {
        method: editingDraftId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(editingDraftId ? { invoice_id: editingDraftId } : {}),
          ...(!editingDraftId && accountingDocumentId ? { accounting_document_id: accountingDocumentId } : {}),
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
          note_reason: noteReason || null,
          lines: lines.map((line) => ({
            ...line,
            ...normalizeInvoiceLinePrice(lineForCalculation(line), pricesIncludeTax),
            description: line.description || null,
            tax_exemption_reason_code: line.tax_exemption_reason_code || null,
            tax_exemption_reason: line.tax_exemption_reason || null,
          })),
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        if (body?.error === 'INVALID_EINVOICE_DRAFT') {
          const issue = body.issues?.[0]?.message;
          throw new Error(issue || body.error);
        }
        throw new Error(body?.error || `HTTP_${response.status}`);
      }
      setInvoices((current) => editingDraftId
        ? current.map((invoice) => invoice.id === editingDraftId ? { ...invoice, ...body } : invoice)
        : [body, ...current]);
      setEditingDraftId(null);
      setNoteSource(null);
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
      setNoteReason('');
      setLines([emptyLine(String(standardTaxRate))]);
      setPricesIncludeTax(false);
      setFieldsMenuOpen(false);
      setCurrency('SAR');
      setExchangeRate('1');
      setShowDraftForm(false);
      setMessage({ error: false, text: documentType === 'INVOICE'
        ? (ar ? (editingDraftId ? 'حُفظت تعديلات المسودة. لم تصدر ولم تُرسل إلى زاتكا.' : 'حُفظت مسودة الفاتورة. لم تصدر ولم تُرسل إلى زاتكا.') : (editingDraftId ? 'Draft changes saved. It has not been issued or sent to ZATCA.' : 'Invoice draft saved. It has not been issued or sent to ZATCA.'))
        : (ar ? 'حُفظت مسودة الإشعار. إصدار الإشعارات غير متاح حاليًا.' : 'Note draft saved. Issuing credit/debit notes is not available yet.') });
    } catch (error) {
      setMessage({ error: true, text: messageFor(error instanceof Error ? error.message : 'UNKNOWN_ERROR', ar) });
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file?: File) {
    if (!file) return;
    setImporting(true);
    setMessage(null);
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('IMPORT_FILE_TOO_LARGE');
      let rows: unknown[][];
      if (/\.csv$/i.test(file.name)) {
        rows = parseCsv(await file.text());
      } else if (/\.xlsx$/i.test(file.name)) {
        const ExcelJS = (await import('exceljs')).default;
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(await file.arrayBuffer());
        const worksheet = workbook.worksheets[0];
        if (!worksheet) throw new Error('IMPORT_FILE_EMPTY');
        rows = worksheet.getSheetValues().slice(1).map((row) => Array.isArray(row) ? row.slice(1) : []);
      } else {
        throw new Error('IMPORT_FILE_TYPE_UNSUPPORTED');
      }

      const groups = groupImportRecords(rowsToRecords(rows));
      const notesUnsupported = groups.some((group) => {
        const type = (group.rows[0].document_type ?? '').trim().toUpperCase();
        return ['CREDIT_NOTE', 'DEBIT_NOTE', 'CREDIT NOTE', 'DEBIT NOTE', 'إشعار دائن', 'إشعار مدين'].includes(type);
      });
      if (notesUnsupported) throw new Error('EINVOICE_NOTES_NOT_SUPPORTED');
      let imported = 0;
      const failures: string[] = [];
      for (const group of groups) {
        const first = group.rows[0];
        const response = await fetch('/api/vat/e-invoices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            organization_id: organizationId,
            invoice_number: group.invoiceNumber,
            invoice_category: importCategory(first.invoice_category),
            document_type: first.document_type || 'INVOICE',
            issue_date: first.issue_date,
            due_date: (first as { due_date?: string }).due_date || null,
            issue_time: normalizeTime(first.issue_time),
            buyer_contact_id: null,
            seller_name: sellerProfile.registered_name,
            seller_vat_number: vatNumber,
            seller_address: sellerProfile.seller_street,
            seller_building_number: sellerProfile.seller_building_number,
            seller_district: sellerProfile.seller_district,
            seller_additional_number: sellerProfile.seller_additional_number,
            seller_city: sellerProfile.seller_city,
            seller_postal_code: sellerProfile.seller_postal_code,
            buyer_name: first.buyer_name || null,
            buyer_vat_number: first.buyer_vat_number || null,
            buyer_address: first.buyer_address || null,
            buyer_building_number: first.buyer_building_number || null,
            buyer_district: first.buyer_district || null,
            buyer_additional_number: first.buyer_additional_number || null,
            buyer_city: first.buyer_city || null,
            buyer_postal_code: first.buyer_postal_code || null,
            billing_reference: first.billing_reference || null,
            note_reason: first.note_reason || null,
            lines: group.rows.map((row) => ({
              item_name: row.item_name,
              description: row.description || null,
              quantity: row.quantity,
              unit_code: row.unit_code || 'PCE',
              unit_price: row.unit_price,
              discount_amount: row.discount_amount || '0',
              tax_category: importTaxCategory(row.tax_category),
              tax_rate: row.tax_rate || '15',
              tax_exemption_reason_code: row.tax_exemption_reason_code || null,
              tax_exemption_reason: row.tax_exemption_reason || null,
            })),
          }),
        });
        const body = await response.json();
        if (response.ok) imported++;
        else failures.push(`${group.invoiceNumber}: ${body?.issues?.[0]?.message || body?.error || response.status}`);
      }
      const refresh = await fetch(`/api/vat/e-invoices?organization_id=${encodeURIComponent(organizationId)}`);
      if (refresh.ok) {
        const body = await refresh.json();
        setInvoices(body.invoices ?? []);
        const names = (body.invoices ?? []).flatMap((invoice: Invoice) => invoice.lines.map((line) => line.item_name));
        setServiceCatalog((current) => Array.from(new Set([...current, ...names].filter(Boolean))));
      }
      setMessage({
        error: failures.length > 0,
        text: ar
          ? `تم استيراد ${imported} مسودة${failures.length ? `، وتعذر استيراد ${failures.length}: ${failures.slice(0, 3).join('؛ ')}` : ''}.`
          : `Imported ${imported} draft(s)${failures.length ? `; ${failures.length} failed: ${failures.slice(0, 3).join('; ')}` : '.'}`,
      });
    } catch (error) {
      setMessage({ error: true, text: messageFor(error instanceof Error ? error.message : 'IMPORT_FAILED', ar) });
    } finally {
      setImporting(false);
      if (importInput.current) importInput.current.value = '';
    }
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

  async function collectInvoice(invoice: Invoice) {
    if (!invoice.cash_flow?.id) {
      setMessage({ error: true, text: ar ? 'لا يوجد تدفق قبض مرتبط بهذه الفاتورة المحاسبية.' : 'No collection flow is linked to this accounting invoice.' });
      return;
    }
    const outstanding = Math.max(0, Number(invoice.cash_flow.amount) - Number(invoice.cash_flow.settled_amount || 0));
    if (outstanding <= 0) return;
    const eligibleAccounts = cashAccounts.filter((account) => account.currency === invoice.cash_flow?.currency);
    if (!eligibleAccounts.length) {
      setMessage({ error:true, text: ar ? 'لا يوجد حساب بنكي/صندوق نشط بنفس عملة الفاتورة.' : 'No active bank/cash account uses the invoice currency.' }); return;
    }
    const choices = eligibleAccounts.map((account,index) => `${index+1}. ${account.name} (${account.currency})`).join('\n');
    const choice = window.prompt((ar ? 'اختر حساب القبض برقم الخيار:' : 'Choose the collection account by number:') + '\n' + choices, '1');
    if (!choice) return;
    const accountId = eligibleAccounts[Number(choice)-1]?.id;
    if (!accountId) { setMessage({error:true,text:ar?'اختيار الحساب غير صحيح.':'Invalid account selection.'}); return; }
    const amountText = window.prompt(ar ? `مبلغ القبض (المتبقي ${formatAmount(outstanding)} ${invoice.cash_flow.currency}):` : `Collection amount (outstanding ${formatAmount(outstanding)} ${invoice.cash_flow.currency}):`, String(outstanding));
    if (!amountText) return;
    const amount = Number(amountText);
    if (!(amount > 0) || amount > outstanding) {
      setMessage({ error: true, text: ar ? 'مبلغ القبض غير صحيح أو أكبر من الرصيد المتبقي.' : 'Collection amount is invalid or exceeds the outstanding balance.' });
      return;
    }
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/liquidity/${invoice.cash_flow.id}`, { method: 'PATCH', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ status:'ACTUAL', account_id:accountId, amount, settlement_date:new Date().toISOString().slice(0,10) }) });
      const body = await response.json();
      if (!response.ok && response.status !== 202) throw new Error(body?.error || `HTTP_${response.status}`);
      const refresh = await fetch(`/api/vat/e-invoices?organization_id=${encodeURIComponent(organizationId)}`);
      if (refresh.ok) setInvoices((await refresh.json()).invoices ?? []);
      setMessage({ error: false, text: response.status === 202 ? (ar ? 'تم تسجيل القبض وهو بانتظار الموافقة المالية.' : 'Collection recorded and is pending financial approval.') : (ar ? 'تم تسجيل القبض وتحديث الذمة والسيولة.' : 'Collection posted; receivable and liquidity were updated.') });
    } catch (error) { setMessage({ error:true, text:messageFor(error instanceof Error ? error.message : 'COLLECTION_FAILED', ar) }); }
    finally { setBusy(false); }
  }

  function startNote(invoice: Invoice, kind: 'CREDIT_NOTE'|'DEBIT_NOTE') {
    if (!invoice.accounting_document_id || invoice.status !== 'ISSUED') return;
    setEditingDraftId(null);
    setNoteSource(invoice);
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
    setNoteReason('');
    setLines(invoice.lines.map((line) => ({ item_name:line.item_name, description:line.description || '', quantity:String(line.quantity), unit_code:line.unit_code, unit_price:String(line.unit_price), discount_amount:String(line.discount_amount), tax_category:line.tax_category, tax_rate:String(line.tax_rate), tax_exemption_reason_code:line.tax_exemption_reason_code || '', tax_exemption_reason:line.tax_exemption_reason || '' })));
    setShowDraftForm(true);
    window.scrollTo({ top:0, behavior:'smooth' });
  }

  function editDraft(invoice: Invoice) {
    if (invoice.status !== 'DRAFT') return;
    setEditingDraftId(invoice.id);
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
    if (!invoice.qr_code) return;
    const popup = window.open('', '_blank', 'width=900,height=1000');
    if (!popup) {
      setMessage({ error: true, text: ar ? 'اسمح بالنوافذ المنبثقة لطباعة الفاتورة.' : 'Allow pop-ups to print the invoice.' });
      return;
    }
    try {
    const QRCode = (await import('qrcode')).default;
    const qrImage = await QRCode.toDataURL(invoice.qr_code, { errorCorrectionLevel: 'M', margin: 2, width: 220 });
    const esc = escapeHtml;
    popup.document.write(`<!doctype html><html lang="${ar ? 'ar' : 'en'}" dir="${ar ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${esc(invoice.invoice_number)}</title><style>
      body{font:15px Arial,sans-serif;color:#12352e;margin:30px}.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0b6b53;padding-bottom:18px}.brand{font-size:24px;font-weight:700}.muted{color:#61736f}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:24px 0}.box{border:1px solid #dbe6e2;border-radius:10px;padding:14px}.box h2{font-size:15px;margin:0 0 12px}.box p{margin:5px 0}.label{color:#61736f;font-size:12px}table{width:100%;border-collapse:collapse;margin-top:22px}th,td{text-align:start;border-bottom:1px solid #dbe6e2;padding:10px}th{background:#f0f6f3}.totals{margin:18px 0 0 auto;width:300px}.totals div{display:flex;justify-content:space-between;padding:6px}.qr{display:flex;justify-content:space-between;align-items:end;margin-top:28px}.qr img{width:155px}@media print{body{margin:12mm}button{display:none}}
      </style></head><body>
      <div class="head"><div><div class="brand">ZakatFlow</div><div class="muted">${ar ? 'فاتورة ضريبية' : 'Tax invoice'} · ${esc(invoice.invoice_number)}</div></div><div><strong>${ar ? 'تاريخ الإصدار' : 'Issue date'}</strong><br>${esc(invoice.issue_date)}${invoice.due_date ? `<p>${ar ? 'تاريخ الاستحقاق' : 'Due date'}: ${esc(invoice.due_date)}</p>` : ''}</div></div>
      <div class="grid"><div class="box"><h2>${ar ? 'البائع' : 'Seller'}</h2><p>${esc(invoice.seller_name)}</p><p>${esc(invoice.seller_vat_number)}</p><p>${esc(invoice.seller_address)}, ${esc(invoice.seller_district)}, ${esc(invoice.seller_city)}</p><p>${esc(invoice.seller_building_number)} · ${esc(invoice.seller_postal_code)}</p></div>
      <div class="box"><h2>${ar ? 'المشتري' : 'Buyer'}</h2><p>${esc(invoice.buyer_name || '—')}</p><p>${esc(invoice.buyer_vat_number || '')}</p><p>${esc(invoice.buyer_address || '')}</p><p>${esc(invoice.buyer_city || '')}</p></div></div>
      <table><thead><tr><th>${ar ? 'البند' : 'Item'}</th><th>${ar ? 'الكمية' : 'Qty'}</th><th>${ar ? 'سعر الوحدة' : 'Unit price'}</th><th>${ar ? 'الضريبة' : 'VAT'}</th><th>${ar ? 'الإجمالي' : 'Total'}</th></tr></thead><tbody>${invoice.lines.map((line) => `<tr><td>${esc(line.item_name)}</td><td>${esc(String(line.quantity))}</td><td>${formatAmount(line.unit_price)} ${esc(invoice.currency)}</td><td>${formatAmount(line.tax_amount)} ${esc(invoice.currency)}</td><td>${formatAmount(line.gross_amount)} ${esc(invoice.currency)}</td></tr>`).join('')}</tbody></table>
      <div class="totals"><div><span>${ar ? 'ضريبة القيمة المضافة' : 'VAT'}</span><strong>${formatAmount(invoice.tax_total_amount)} ${esc(invoice.currency)}</strong></div>${invoice.currency !== 'SAR' ? `<div><span>${ar ? 'ضريبة القيمة المضافة بالريال' : 'VAT in SAR'}</span><strong>${formatAmount(invoice.tax_total_amount_sar || 0)} SAR</strong></div>` : ''}<div><span>${ar ? 'الإجمالي المستحق' : 'Total due'}</span><strong>${formatAmount(invoice.payable_amount)} ${esc(invoice.currency)}</strong></div>${invoice.currency !== 'SAR' ? `<div><span>${ar ? 'سعر الصرف إلى الريال' : 'Exchange rate to SAR'}</span><strong>${esc(String(invoice.exchange_rate || 1))}</strong></div>` : ''}</div>
      <div class="qr"><span class="muted">${ar ? 'رمز QR — صيغة زاتكا للمرحلة الأولى' : 'QR code — ZATCA Phase 1 format'}</span><img src="${qrImage}" alt="ZATCA QR"></div><script>window.onload=()=>window.print()</script></body></html>`);
    popup.document.close();
    } catch {
      popup.close();
      setMessage({ error: true, text: ar ? 'تعذر إعداد نسخة الطباعة. أعد المحاولة.' : 'Could not prepare the printable invoice. Please retry.' });
    }
  }

  function updateLine(index: number, changes: Partial<InvoiceLine>) {
    setLines((current) => current.map((line, i) => i === index ? { ...line, ...changes } : line));
  }

  function startDraft(type: 'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE') {
    setEditingDraftId(null);
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
  const subtotal = lines.reduce((sum, line) => sum + lineAmounts(line).net, 0);
  const totalTax = lines.reduce((sum, line) => sum + lineAmounts(line).tax, 0);
  const grandTotal = lines.reduce((sum, line) => sum + lineAmounts(line).total, 0);

  return (
    <section className="vat-panel">
      <div className="vat-panel-head vat-einvoice-register-heading">
        <div>
          <span className="vat-eyebrow">{ar ? 'الفواتير الصادرة' : 'SALES INVOICES'}</span>
          <h2>{ar ? 'الفواتير والإشعارات' : 'Invoices and notes'}</h2>
          <p>{ar ? 'أضف مستندًا، أدخل بنوده، ثم احفظه كمسودة للمراجعة.' : 'Add a document, enter its line items, and save it as a draft for review.'}</p>
        </div>
        <div className="vat-add-menu-wrap">
          <button type="button" className="vat-button primary vat-add-document" aria-expanded={addMenuOpen} onClick={() => setAddMenuOpen((open) => !open)} disabled={!canCreate || !sellerProfileReady || busy || importing}>
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

      <div className="vat-einvoice-import-actions">
        <input ref={importInput} type="file" accept=".csv,.xlsx" hidden onChange={(event) => void importFile(event.target.files?.[0])} />
        <button type="button" className="vat-button secondary" disabled={!canCreate || !sellerProfileReady || importing || busy} onClick={() => importInput.current?.click()}>{importing ? (ar ? 'جارٍ الاستيراد…' : 'Importing…') : (ar ? 'استيراد CSV / Excel' : 'Import CSV / Excel')}</button>
        <button type="button" className="vat-button secondary" onClick={downloadTemplate}>{ar ? 'تنزيل نموذج الاستيراد' : 'Download import template'}</button>
        <small>{ar ? 'كل صف يمثل بندًا؛ كرر رقم الفاتورة لضم البنود إلى فاتورة واحدة. الاستيراد يحفظ مسودات، وبيانات البائع تُسحب من ملف التسجيل.' : 'Each row is an invoice line; repeat the invoice number to group lines. Imports save drafts, and seller details come from the registration profile.'}</small>
      </div>

      {showDraftForm && <form className="vat-form-grid vat-einvoice-form" onSubmit={saveDraft}>
        <fieldset className="vat-einvoice-group">
          <legend>{documentType === 'INVOICE' ? (ar ? 'بيانات الفاتورة' : 'Invoice details') : (ar ? 'بيانات الإشعار' : 'Note details')}</legend>
          <div className="vat-einvoice-group-grid vat-einvoice-first-row">
            {category === 'STANDARD' && <div className="vat-document-contact-field vat-einvoice-buyer-picker">
              <VatContactPicker
                key={`${organizationId}-einvoice-buyer`}
                organizationId={organizationId}
                role="CUSTOMER"
                ar={ar}
                label={ar ? 'العميل / المشتري' : 'Customer / buyer'}
                value={buyerContactId}
                required
                requireSaudiAddress
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
            </div>}
            <label><span>{ar ? 'نوع الفاتورة' : 'Invoice type'}</span><select value={category} onChange={(event) => {
              const nextCategory = event.target.value as typeof category;
              setCategory(nextCategory);
              if (nextCategory === 'SIMPLIFIED') {
                setBuyerContactId(''); setBuyerName(''); setBuyerVatNumber(''); setBuyerAddress('');
                setBuyerBuilding(''); setBuyerDistrict(''); setBuyerAdditional(''); setBuyerCity(''); setBuyerPostalCode('');
              }
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
            <label><span>{ar ? 'مرجع الفاتورة الأصلية' : 'Original invoice reference'}</span><input required maxLength={100} value={billingReference} onChange={(event) => setBillingReference(event.target.value)} /></label>
            <label><span>{ar ? 'سبب الإشعار' : 'Note reason'}</span><input required maxLength={500} value={noteReason} onChange={(event) => setNoteReason(event.target.value)} /></label>
          </div>
        </fieldset>}

        <div className="vat-einvoice-lines">
          <div className="vat-einvoice-lines-toolbar">
            <div className="vat-einvoice-lines-heading"><span className="vat-einvoice-section-icon" aria-hidden="true">▤</span><div><strong>{ar ? 'بنود الفاتورة' : 'Invoice items'}</strong><small>{ar ? 'أدخل البنود وسيتم احتساب الضريبة والإجماليات تلقائيًا.' : 'Enter line items; tax and totals are calculated automatically.'}</small></div></div>
            <div className="vat-einvoice-lines-controls">
              <label className="vat-einvoice-currency"><span>{ar ? 'العملة' : 'Currency'}</span><select value={currency} onChange={(event) => setCurrency(event.target.value)}>{currencies.map((item) => <option key={item.code} value={item.code}>{item.code} · {ar ? item.name_ar : item.name_en}</option>)}</select></label>
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
        <div className="vat-form-actions"><button type="button" className="vat-button secondary" onClick={() => { setShowDraftForm(false); setEditingDraftId(null); setAddMenuOpen(false); }}>{ar ? 'إلغاء' : 'Cancel'}</button><button className="vat-button primary" disabled={!canCreate || !sellerProfileReady || busy || importing || !vatNumber || !Number.isFinite(Number(exchangeRate)) || Number(exchangeRate) <= 0}>{busy ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : (ar ? (editingDraftId ? 'حفظ التعديلات' : 'حفظ كمسودة') : (editingDraftId ? 'Save changes' : 'Save as draft'))}</button></div>
      </form>}

      <div className="vat-einvoice-list" aria-live="polite">
        {loading && <div className="vat-empty-row">{ar ? 'جارٍ تحميل الفواتير…' : 'Loading invoices…'}</div>}
        {!loading && invoices.map((invoice) => <div className="vat-einvoice-item" key={invoice.id}>
          <div><strong>{invoice.invoice_number}</strong><small>{invoice.document_type !== 'INVOICE' ? (invoice.document_type === 'CREDIT_NOTE' ? (ar ? 'إشعار دائن' : 'Credit note') : (ar ? 'إشعار مدين' : 'Debit note')) : (ar ? 'فاتورة' : 'Invoice')} · {invoice.issue_date}{invoice.due_date ? ` · ${ar ? 'استحقاق' : 'Due'}: ${invoice.due_date}` : ''} · {invoice.invoice_category === 'STANDARD' ? (ar ? 'قياسية' : 'Standard') : (ar ? 'مبسطة' : 'Simplified')} · {invoice.lines.length} {ar ? 'بنود' : 'lines'}</small></div>
          <div className="vat-einvoice-total">{formatAmount(invoice.payable_amount)} {invoice.currency}{invoice.currency !== 'SAR' && invoice.exchange_rate && <small className="vat-einvoice-sar-total">{formatAmount(Number(invoice.payable_amount) * Number(invoice.exchange_rate))} SAR</small>}</div>
          <span className={`vat-status ${invoice.status === 'ISSUED' ? 'registered' : ''}`}>{invoice.status === 'ISSUED' ? (ar ? 'صادرة — QR المرحلة الأولى' : 'Issued — Phase 1 QR') : (ar ? 'مسودة' : 'Draft')}</span>
          <div className="vat-invoice-actions">
            {invoice.status === 'DRAFT' && <button type="button" className="vat-button secondary" disabled={busy || importing || !canCreate || editingDraftId === invoice.id} onClick={() => editDraft(invoice)}>{ar ? (editingDraftId === invoice.id ? 'قيد التعديل' : 'تعديل') : (editingDraftId === invoice.id ? 'Editing' : 'Edit')}</button>}
            {invoice.cash_flow && Math.max(0, Number(invoice.cash_flow.amount)-Number(invoice.cash_flow.settled_amount||0)) > 0 && <button type="button" className="vat-button secondary" disabled={busy} onClick={() => void collectInvoice(invoice)}>{ar ? `قبض المتبقي ${formatAmount(Math.max(0,Number(invoice.cash_flow.amount)-Number(invoice.cash_flow.settled_amount||0)))}` : `Collect ${formatAmount(Math.max(0,Number(invoice.cash_flow.amount)-Number(invoice.cash_flow.settled_amount||0)))}`}</button>}
            {invoice.cash_flow && Math.max(0, Number(invoice.cash_flow.amount)-Number(invoice.cash_flow.settled_amount||0)) === 0 && <span className="vat-status registered">{ar ? 'مسددة' : 'Paid'}</span>}
            {invoice.status === 'DRAFT' && <button type="button" className="vat-button primary" disabled={busy || importing || !canCreate || editingDraftId === invoice.id || invoice.document_type !== 'INVOICE' || !invoice.accounting_document_id} onClick={() => void issueInvoice(invoice)}>{ar ? 'إصدار ZATCA' : 'Issue ZATCA'}</button>}
            {invoice.status === 'ISSUED' && invoice.document_type === 'INVOICE' && <button type="button" className="vat-button secondary" disabled={busy} onClick={() => startNote(invoice,'CREDIT_NOTE')}>{ar ? 'إشعار دائن' : 'Credit note'}</button>}
            {invoice.status === 'ISSUED' && invoice.document_type === 'INVOICE' && <button type="button" className="vat-button secondary" disabled={busy} onClick={() => startNote(invoice,'DEBIT_NOTE')}>{ar ? 'إشعار مدين' : 'Debit note'}</button>}
            {invoice.status === 'ISSUED' && invoice.qr_code && <button type="button" className="vat-button secondary" onClick={() => void printInvoice(invoice)}>{ar ? 'عرض / PDF' : 'View / PDF'}</button>}
          </div>
        </div>)}
        {!loading && !invoices.length && <div className="vat-empty-row">{ar ? 'لا توجد فواتير بعد.' : 'No invoices yet.'}</div>}
      </div>
      <p className="vat-einvoice-help">{ar ? 'رمز QR عند الإصدار يطبق حقول المرحلة الأولى (الاسم، الرقم الضريبي، الوقت، الإجمالي والضريبة). لا ترسل هذه العملية الفاتورة إلى زاتكا ولا تطبق تكامل المرحلة الثانية أو ختم XML. إذا كان نشاطك ضمن موجة المرحلة الثانية، أكمل ربط الإنتاج قبل الاعتماد.' : 'Issuing creates the five Phase 1 QR fields (seller, VAT number, timestamp, total and VAT). It does not submit the invoice to ZATCA or apply Phase 2 XML stamping. If your business is in a Phase 2 wave, complete production onboarding before relying on this flow.'}</p>
    </section>
  );
}

function formatAmount(value: string | number) {
  return Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function downloadTemplate() {
  const columns = [
    'invoice_number', 'invoice_category', 'document_type', 'issue_date', 'due_date', 'issue_time',
    'buyer_name', 'buyer_vat_number', 'buyer_address', 'buyer_building_number', 'buyer_district', 'buyer_additional_number', 'buyer_city', 'buyer_postal_code',
    'billing_reference', 'note_reason', 'item_name', 'description', 'quantity', 'unit_code', 'unit_price', 'discount_amount', 'tax_category', 'tax_rate', 'tax_exemption_reason_code', 'tax_exemption_reason',
  ];
  const blob = new Blob([`${columns.join(',')}\r\n`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'zakatflow-vat-invoice-import-template.csv';
  link.click();
  URL.revokeObjectURL(url);
}

function importCategory(value?: string): 'STANDARD' | 'SIMPLIFIED' {
  const category = (value ?? '').trim().toUpperCase();
  return category === 'SIMPLIFIED' || category === 'مبسطة' ? 'SIMPLIFIED' : 'STANDARD';
}

function importTaxCategory(value?: string): InvoiceLine['tax_category'] {
  const category = (value ?? 'S').trim().toUpperCase();
  if (category === 'Z' || category === 'ZERO_RATED' || category === 'صفري') return 'Z';
  if (category === 'E' || category === 'EXEMPT' || category === 'معفى') return 'E';
  if (category === 'O' || category === 'OUT_OF_SCOPE' || category === 'خارج النطاق') return 'O';
  return 'S';
}

function normalizeTime(value?: string) {
  const raw = (value ?? '').trim();
  if (/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(raw)) return raw.length === 5 ? `${raw}:00` : raw;
  const fraction = Number(raw);
  if (Number.isFinite(fraction) && fraction >= 0 && fraction < 1) {
    const seconds = Math.round(fraction * 86400) % 86400;
    return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  return raw;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

function messageFor(code: string, ar: boolean) {
  const labels: Record<string, [string, string]> = {
    UNAUTHORIZED: ['يلزم تسجيل الدخول.', 'Please sign in.'],
    ORGANIZATION_ACCESS_REQUIRED: ['ليس لديك صلاحية الوصول إلى هذه المؤسسة.', 'You do not have access to this organization.'],
    ORGANIZATION_ADMIN_REQUIRED: ['إنشاء المسودات متاح لمالك المؤسسة أو مديرها.', 'Only an organization owner or admin can create drafts.'],
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
    QR_FIELD_TOO_LONG: ['إحدى بيانات QR أطول من الحد المسموح.', 'A QR field exceeds the supported size.'],
  };
  if (code.startsWith('LINE_DISCOUNT_EXCEEDS_AMOUNT:')) return ar ? 'لا يمكن أن يتجاوز الخصم إجمالي قيمة البند.' : 'A line discount cannot exceed the line amount.';
  return labels[code]?.[ar ? 0 : 1] ?? (ar ? 'تعذر حفظ المسودة. تحقق من البيانات ثم أعد المحاولة.' : 'Could not save the draft. Check the details and try again.');
}
