'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { groupImportRecords, parseCsv, rowsToRecords } from '@/lib/vat-einvoice-import';
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
  currency: string;
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
  buyer_vat_number: string | null;
  buyer_address: string | null;
  buyer_city: string | null;
  lines: Array<{ id: string; item_name: string; quantity: number; unit_price: string; tax_amount: string; gross_amount: string }>;
};

const emptyLine = (): InvoiceLine => ({
  item_name: '', description: '', quantity: '1', unit_code: 'PCE', unit_price: '',
  discount_amount: '0', tax_category: 'S', tax_rate: '15',
  tax_exemption_reason_code: '', tax_exemption_reason: '',
});

export function VatEInvoiceRegister({
  organizationId,
  sellerProfile,
  vatNumber,
  registered,
  ar,
  onInvoiceIssued,
}: {
  organizationId: string;
  sellerProfile: SellerProfile;
  vatNumber: string;
  registered: boolean;
  ar: boolean;
  onInvoiceIssued?: () => void;
}) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [category, setCategory] = useState<'STANDARD' | 'SIMPLIFIED'>('STANDARD');
  const [documentType, setDocumentType] = useState<'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE'>('INVOICE');
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [issueTime, setIssueTime] = useState(() => new Date().toTimeString().slice(0, 5));
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
  const [lines, setLines] = useState<InvoiceLine[]>([emptyLine()]);
  const importInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
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
        setCanCreate(Boolean(body.is_admin && registered));
      })
      .catch((error) => { if (active) setMessage({ error: true, text: messageFor(error.message, ar) }); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [organizationId, registered, ar]);

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch('/api/vat/e-invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organization_id: organizationId,
          invoice_number: invoiceNumber,
          invoice_category: category,
          document_type: documentType,
          issue_date: issueDate,
          issue_time: issueTime,
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
          currency: 'SAR',
          lines: lines.map((line) => ({
            ...line,
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
      setInvoices((current) => [body, ...current]);
      setInvoiceNumber('');
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
      setLines([emptyLine()]);
      setMessage({ error: false, text: ar ? 'حُفظت مسودة الفاتورة. لم تصدر ولم تُرسل إلى زاتكا.' : 'Invoice draft saved. It has not been issued or sent to ZATCA.' });
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
      <div class="head"><div><div class="brand">ZakatFlow</div><div class="muted">${ar ? 'فاتورة ضريبية' : 'Tax invoice'} · ${esc(invoice.invoice_number)}</div></div><div><strong>${ar ? 'تاريخ الإصدار' : 'Issue date'}</strong><br>${esc(invoice.issue_date)}</div></div>
      <div class="grid"><div class="box"><h2>${ar ? 'البائع' : 'Seller'}</h2><p>${esc(invoice.seller_name)}</p><p>${esc(invoice.seller_vat_number)}</p><p>${esc(invoice.seller_address)}, ${esc(invoice.seller_district)}, ${esc(invoice.seller_city)}</p><p>${esc(invoice.seller_building_number)} · ${esc(invoice.seller_postal_code)}</p></div>
      <div class="box"><h2>${ar ? 'المشتري' : 'Buyer'}</h2><p>${esc(invoice.buyer_name || '—')}</p><p>${esc(invoice.buyer_vat_number || '')}</p><p>${esc(invoice.buyer_address || '')}</p><p>${esc(invoice.buyer_city || '')}</p></div></div>
      <table><thead><tr><th>${ar ? 'البند' : 'Item'}</th><th>${ar ? 'الكمية' : 'Qty'}</th><th>${ar ? 'سعر الوحدة' : 'Unit price'}</th><th>${ar ? 'الضريبة' : 'VAT'}</th><th>${ar ? 'الإجمالي' : 'Total'}</th></tr></thead><tbody>${invoice.lines.map((line) => `<tr><td>${esc(line.item_name)}</td><td>${esc(String(line.quantity))}</td><td>${formatAmount(line.unit_price)}</td><td>${formatAmount(line.tax_amount)}</td><td>${formatAmount(line.gross_amount)}</td></tr>`).join('')}</tbody></table>
      <div class="totals"><div><span>${ar ? 'ضريبة القيمة المضافة' : 'VAT'}</span><strong>${formatAmount(invoice.tax_total_amount)} SAR</strong></div><div><span>${ar ? 'الإجمالي المستحق' : 'Total due'}</span><strong>${formatAmount(invoice.payable_amount)} SAR</strong></div></div>
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

  return (
    <section className="vat-panel">
      <div className="vat-panel-head">
        <div>
          <span className="vat-eyebrow">{ar ? 'الفواتير الصادرة' : 'SALES INVOICES'}</span>
          <h2>{ar ? 'إنشاء فاتورة ضريبية' : 'Create a tax invoice'}</h2>
          <p>{ar ? 'أنشئ فاتورة، استوردها من CSV أو Excel، ثم أصدرها مع رمز QR بصيغة زاتكا للمرحلة الأولى.' : 'Create an invoice, import CSV or Excel, then issue it with a ZATCA Phase 1 QR code.'}</p>
        </div>
      </div>
      {!registered && <div className="vat-inline-warning">{ar ? 'يجب إكمال تسجيل ضريبة القيمة المضافة قبل إنشاء فاتورة.' : 'Complete VAT registration before creating an invoice.'}</div>}
      {!canCreate && registered && <div className="vat-inline-warning">{ar ? 'إنشاء الفواتير متاح لمالك المؤسسة أو مديرها فقط.' : 'Only an organization owner or admin can create invoices.'}</div>}
      {message && <div className={`vat-notice ${message.error ? 'error' : 'success'}`} role={message.error ? 'alert' : 'status'}>{message.text}</div>}

      <div className="vat-einvoice-import-actions">
        <input ref={importInput} type="file" accept=".csv,.xlsx" hidden onChange={(event) => void importFile(event.target.files?.[0])} />
        <button type="button" className="vat-button secondary" disabled={!canCreate || !sellerProfileReady || importing || busy} onClick={() => importInput.current?.click()}>{importing ? (ar ? 'جارٍ الاستيراد…' : 'Importing…') : (ar ? 'استيراد CSV / Excel' : 'Import CSV / Excel')}</button>
        <button type="button" className="vat-button secondary" onClick={downloadTemplate}>{ar ? 'تنزيل نموذج الاستيراد' : 'Download import template'}</button>
        <small>{ar ? 'كل صف يمثل بندًا؛ كرر رقم الفاتورة لضم البنود إلى فاتورة واحدة. الاستيراد يحفظ مسودات، وبيانات البائع تُسحب من ملف التسجيل.' : 'Each row is an invoice line; repeat the invoice number to group lines. Imports save drafts, and seller details come from the registration profile.'}</small>
      </div>

      <form className="vat-form-grid vat-einvoice-form" onSubmit={saveDraft}>
        <fieldset className="vat-einvoice-group">
          <legend>{ar ? 'بيانات الفاتورة' : 'Invoice details'}</legend>
          <div className="vat-einvoice-group-grid">
            <label><span>{ar ? 'رقم الفاتورة' : 'Invoice number'}</span><input required maxLength={100} value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} /></label>
            <label><span>{ar ? 'نوع الفاتورة' : 'Invoice type'}</span><select value={category} onChange={(event) => setCategory(event.target.value as typeof category)}><option value="STANDARD">{ar ? 'ضريبية قياسية' : 'Standard tax invoice'}</option><option value="SIMPLIFIED">{ar ? 'مبسطة' : 'Simplified'}</option></select></label>
            <label><span>{ar ? 'نوع المستند' : 'Document type'}</span><select value={documentType} onChange={(event) => setDocumentType(event.target.value as typeof documentType)}><option value="INVOICE">{ar ? 'فاتورة' : 'Invoice'}</option><option value="CREDIT_NOTE">{ar ? 'إشعار دائن' : 'Credit note'}</option><option value="DEBIT_NOTE">{ar ? 'إشعار مدين' : 'Debit note'}</option></select></label>
            <label><span>{ar ? 'تاريخ الإصدار' : 'Issue date'}</span><input required type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} /></label>
            <label><span>{ar ? 'وقت الإصدار' : 'Issue time'}</span><input required type="time" value={issueTime} onChange={(event) => setIssueTime(event.target.value)} /></label>
          </div>
        </fieldset>

        <fieldset className="vat-einvoice-group">
          <legend>{ar ? 'بيانات البائع' : 'Seller details'}</legend>
          <div className="vat-seller-profile-summary">
            <div><small>{ar ? 'الاسم النظامي' : 'Registered name'}</small><strong>{sellerProfile.registered_name || '—'}</strong></div>
            <div><small>{ar ? 'الرقم الضريبي' : 'VAT number'}</small><strong dir="ltr">{vatNumber || '—'}</strong></div>
            <div><small>{ar ? 'العنوان الوطني' : 'National address'}</small><strong>{[sellerProfile.seller_street, sellerProfile.seller_building_number, sellerProfile.seller_district, sellerProfile.seller_additional_number, sellerProfile.seller_city, sellerProfile.seller_postal_code].filter(Boolean).join(' · ') || '—'}</strong></div>
            <p>{ar ? 'تُسحب بيانات البائع من ملف التسجيل، وتحديثها متاح من إعدادات ملف التسجيل.' : 'Seller details come from the VAT registration profile. Update them in registration settings.'}</p>
          </div>
          {!sellerProfileReady && <div className="vat-inline-warning">{ar ? 'أكمل بيانات الاسم النظامي والعنوان الوطني في ملف تسجيل الضريبة قبل حفظ أو استيراد الفواتير.' : 'Complete the legal name and national address in the VAT registration profile before saving or importing invoices.'}</div>}
        </fieldset>

        {category === 'STANDARD' && <fieldset className="vat-einvoice-group">
          <legend>{ar ? 'بيانات المشتري' : 'Buyer details'}</legend>
          <div className="vat-einvoice-group-grid">
            <div className="vat-document-contact-field vat-einvoice-buyer-picker">
              <VatContactPicker
                key={`${organizationId}-einvoice-buyer`}
                organizationId={organizationId}
                role="CUSTOMER"
                ar={ar}
                label={ar ? 'العميل / المشتري المحفوظ' : 'Saved customer / buyer'}
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
            </div>
            <label><span>{ar ? 'اسم المشتري' : 'Buyer name'}</span><input required maxLength={200} value={buyerName} onChange={(event) => setBuyerName(event.target.value)} /></label>
            <label><span>{ar ? 'الرقم الضريبي للمشتري' : 'Buyer VAT number'}</span><input maxLength={15} value={buyerVatNumber} onChange={(event) => setBuyerVatNumber(event.target.value)} /></label>
            <label><span>{ar ? 'الشارع' : 'Street'}</span><input required maxLength={250} value={buyerAddress} onChange={(event) => setBuyerAddress(event.target.value)} /></label>
            <label><span>{ar ? 'رقم المبنى (4 أرقام)' : 'Building number (4 digits)'}</span><input required inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={buyerBuilding} onChange={(event) => setBuyerBuilding(event.target.value)} /></label>
            <label><span>{ar ? 'الحي' : 'District'}</span><input required maxLength={120} value={buyerDistrict} onChange={(event) => setBuyerDistrict(event.target.value)} /></label>
            <label><span>{ar ? 'الرقم الإضافي (4 أرقام)' : 'Additional number (4 digits)'}</span><input inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={buyerAdditional} onChange={(event) => setBuyerAdditional(event.target.value)} /></label>
            <label><span>{ar ? 'مدينة المشتري' : 'Buyer city'}</span><input required maxLength={120} value={buyerCity} onChange={(event) => setBuyerCity(event.target.value)} /></label>
            <label><span>{ar ? 'الرمز البريدي (5 أرقام)' : 'Postal code (5 digits)'}</span><input required inputMode="numeric" pattern="[0-9]{5}" maxLength={5} value={buyerPostalCode} onChange={(event) => setBuyerPostalCode(event.target.value)} /></label>
          </div>
        </fieldset>}

        {documentType !== 'INVOICE' && <fieldset className="vat-einvoice-group">
          <legend>{ar ? 'بيانات الإشعار' : 'Credit or debit note details'}</legend>
          <div className="vat-einvoice-group-grid vat-einvoice-group-grid-narrow">
            <label><span>{ar ? 'مرجع الفاتورة الأصلية' : 'Original invoice reference'}</span><input required maxLength={100} value={billingReference} onChange={(event) => setBillingReference(event.target.value)} /></label>
            <label><span>{ar ? 'سبب الإشعار' : 'Note reason'}</span><input required maxLength={500} value={noteReason} onChange={(event) => setNoteReason(event.target.value)} /></label>
          </div>
        </fieldset>}

        <div className="vat-einvoice-lines">
          <div className="vat-einvoice-lines-head"><strong>{ar ? 'بنود الفاتورة' : 'Invoice lines'}</strong><button type="button" className="vat-button secondary" onClick={() => setLines((current) => [...current, emptyLine()])}>{ar ? 'إضافة بند' : 'Add line'}</button></div>
          {lines.map((line, index) => <fieldset className="vat-einvoice-line" key={index}>
            <legend>{ar ? `البند ${index + 1}` : `Line ${index + 1}`}</legend>
            <label><span>{ar ? 'وصف السلعة أو الخدمة' : 'Item or service'}</span><input required maxLength={200} value={line.item_name} onChange={(event) => updateLine(index, { item_name: event.target.value })} /></label>
            <label><span>{ar ? 'الكمية' : 'Quantity'}</span><input required type="number" min="0.000001" step="0.000001" value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.target.value })} /></label>
            <label><span>{ar ? 'سعر الوحدة (ريال)' : 'Unit price (SAR)'}</span><input required type="number" min="0" step="0.000001" value={line.unit_price} onChange={(event) => updateLine(index, { unit_price: event.target.value })} /></label>
            <label><span>{ar ? 'الخصم (ريال)' : 'Discount (SAR)'}</span><input type="number" min="0" step="0.01" value={line.discount_amount} onChange={(event) => updateLine(index, { discount_amount: event.target.value })} /></label>
            <label><span>{ar ? 'التصنيف الضريبي' : 'Tax category'}</span><select value={line.tax_category} onChange={(event) => updateLine(index, { tax_category: event.target.value as InvoiceLine['tax_category'], tax_rate: event.target.value === 'S' ? '15' : '0' })}><option value="S">{ar ? 'قياسي' : 'Standard'}</option><option value="Z">{ar ? 'صفري' : 'Zero-rated'}</option><option value="E">{ar ? 'معفى' : 'Exempt'}</option><option value="O">{ar ? 'خارج النطاق' : 'Out of scope'}</option></select></label>
            {line.tax_category === 'S' && <label><span>{ar ? 'نسبة الضريبة %' : 'VAT rate %'}</span><input required type="number" min="0.01" max="100" step="0.01" value={line.tax_rate} onChange={(event) => updateLine(index, { tax_rate: event.target.value })} /></label>}
            {(line.tax_category === 'Z' || line.tax_category === 'E') && <>
              <label><span>{ar ? 'رمز سبب المعاملة' : 'Treatment reason code'}</span><input required maxLength={20} value={line.tax_exemption_reason_code} onChange={(event) => updateLine(index, { tax_exemption_reason_code: event.target.value })} /></label>
              <label><span>{ar ? 'شرح السبب' : 'Reason description'}</span><input required maxLength={500} value={line.tax_exemption_reason} onChange={(event) => updateLine(index, { tax_exemption_reason: event.target.value })} /></label>
            </>}
            {lines.length > 1 && <button type="button" className="vat-delete" aria-label={ar ? `حذف البند ${index + 1}` : `Remove line ${index + 1}`} onClick={() => setLines((current) => current.filter((_, i) => i !== index))}>×</button>}
          </fieldset>)}
        </div>
        <div className="vat-form-actions"><button className="vat-button primary" disabled={!canCreate || !sellerProfileReady || busy || importing || !vatNumber}>{busy ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : (ar ? 'حفظ كمسودة' : 'Save as draft')}</button></div>
      </form>

      <div className="vat-einvoice-list" aria-live="polite">
        {loading && <div className="vat-empty-row">{ar ? 'جارٍ تحميل الفواتير…' : 'Loading invoices…'}</div>}
        {!loading && invoices.map((invoice) => <div className="vat-einvoice-item" key={invoice.id}>
          <div><strong>{invoice.invoice_number}</strong><small>{invoice.issue_date} · {invoice.invoice_category === 'STANDARD' ? (ar ? 'قياسية' : 'Standard') : (ar ? 'مبسطة' : 'Simplified')} · {invoice.lines.length} {ar ? 'بنود' : 'lines'}</small></div>
          <div className="vat-einvoice-total">{formatAmount(invoice.payable_amount)} {invoice.currency}</div>
          <span className={`vat-status ${invoice.status === 'ISSUED' ? 'registered' : ''}`}>{invoice.status === 'ISSUED' ? (ar ? 'صادرة — QR المرحلة الأولى' : 'Issued — Phase 1 QR') : (ar ? 'مسودة' : 'Draft')}</span>
          <div className="vat-invoice-actions">
            {invoice.status === 'DRAFT' && <button type="button" className="vat-button primary" disabled={busy || importing || !canCreate || invoice.document_type !== 'INVOICE'} onClick={() => void issueInvoice(invoice)}>{ar ? 'إصدار' : 'Issue'}</button>}
            {invoice.status === 'ISSUED' && invoice.qr_code && <button type="button" className="vat-button secondary" onClick={() => void printInvoice(invoice)}>{ar ? 'طباعة / PDF' : 'Print / PDF'}</button>}
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
    'invoice_number', 'invoice_category', 'document_type', 'issue_date', 'issue_time',
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
