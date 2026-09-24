'use client';

import { FormEvent, useEffect, useState } from 'react';

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
  lines: Array<{ id: string; item_name: string; quantity: number; unit_price: string; tax_amount: string }>;
};

const emptyLine = (): InvoiceLine => ({
  item_name: '', description: '', quantity: '1', unit_code: 'PCE', unit_price: '',
  discount_amount: '0', tax_category: 'S', tax_rate: '15',
  tax_exemption_reason_code: '', tax_exemption_reason: '',
});

export function VatEInvoiceRegister({
  organizationId,
  organizationName,
  vatNumber,
  registered,
  ar,
}: {
  organizationId: string;
  organizationName: string;
  vatNumber: string;
  registered: boolean;
  ar: boolean;
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
  const [sellerName, setSellerName] = useState(organizationName);
  const [sellerAddress, setSellerAddress] = useState('');
  const [sellerBuilding, setSellerBuilding] = useState('');
  const [sellerDistrict, setSellerDistrict] = useState('');
  const [sellerAdditional, setSellerAdditional] = useState('');
  const [sellerCity, setSellerCity] = useState('');
  const [sellerPostalCode, setSellerPostalCode] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [buyerVatNumber, setBuyerVatNumber] = useState('');
  const [buyerAddress, setBuyerAddress] = useState('');
  const [buyerBuilding, setBuyerBuilding] = useState('');
  const [buyerDistrict, setBuyerDistrict] = useState('');
  const [buyerCity, setBuyerCity] = useState('');
  const [buyerPostalCode, setBuyerPostalCode] = useState('');
  const [billingReference, setBillingReference] = useState('');
  const [noteReason, setNoteReason] = useState('');
  const [lines, setLines] = useState<InvoiceLine[]>([emptyLine()]);

  useEffect(() => {
    setSellerName(organizationName);
  }, [organizationName]);

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
          seller_name: sellerName,
          seller_vat_number: vatNumber,
          seller_address: sellerAddress,
          seller_building_number: sellerBuilding,
          seller_district: sellerDistrict,
          seller_additional_number: sellerAdditional,
          seller_city: sellerCity,
          seller_postal_code: sellerPostalCode,
          seller_country_code: 'SA',
          buyer_name: buyerName || null,
          buyer_vat_number: buyerVatNumber || null,
          buyer_address: buyerAddress || null,
          buyer_building_number: buyerBuilding || null,
          buyer_district: buyerDistrict || null,
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
      setBuyerVatNumber('');
      setBuyerAddress('');
      setBuyerBuilding('');
      setBuyerDistrict('');
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

  function updateLine(index: number, changes: Partial<InvoiceLine>) {
    setLines((current) => current.map((line, i) => i === index ? { ...line, ...changes } : line));
  }

  return (
    <section className="vat-panel">
      <div className="vat-panel-head">
        <div>
          <span className="vat-eyebrow">{ar ? 'مسودات الفواتير' : 'INVOICE DRAFTS'}</span>
          <h2>{ar ? 'إنشاء مسودة فاتورة إلكترونية' : 'Create an e-invoice draft'}</h2>
          <p>{ar ? 'أدخل بيانات الفاتورة وبنودها. تحفظ هذه المرحلة مسودة فقط ولا تصدر الفاتورة أو ترسلها إلى زاتكا.' : 'Enter the invoice details and lines. This stage saves drafts only and does not issue or send invoices to ZATCA.'}</p>
        </div>
      </div>
      {!registered && <div className="vat-inline-warning">{ar ? 'يجب إكمال تسجيل ضريبة القيمة المضافة قبل إعداد مسودة فاتورة.' : 'Complete VAT registration before creating an invoice draft.'}</div>}
      {!canCreate && registered && <div className="vat-inline-warning">{ar ? 'إنشاء المسودات متاح لمالك المؤسسة أو مديرها فقط.' : 'Only an organization owner or admin can create invoice drafts.'}</div>}
      {message && <div className={`vat-notice ${message.error ? 'error' : 'success'}`} role={message.error ? 'alert' : 'status'}>{message.text}</div>}

      <form className="vat-form-grid vat-einvoice-form" onSubmit={saveDraft}>
        <label><span>{ar ? 'رقم الفاتورة' : 'Invoice number'}</span><input required maxLength={100} value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} /></label>
        <label><span>{ar ? 'نوع الفاتورة' : 'Invoice type'}</span><select value={category} onChange={(event) => setCategory(event.target.value as typeof category)}><option value="STANDARD">{ar ? 'ضريبية قياسية' : 'Standard tax invoice'}</option><option value="SIMPLIFIED">{ar ? 'مبسطة' : 'Simplified'}</option></select></label>
        <label><span>{ar ? 'نوع المستند' : 'Document type'}</span><select value={documentType} onChange={(event) => setDocumentType(event.target.value as typeof documentType)}><option value="INVOICE">{ar ? 'فاتورة' : 'Invoice'}</option><option value="CREDIT_NOTE">{ar ? 'إشعار دائن' : 'Credit note'}</option><option value="DEBIT_NOTE">{ar ? 'إشعار مدين' : 'Debit note'}</option></select></label>
        <label><span>{ar ? 'تاريخ الإصدار' : 'Issue date'}</span><input required type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} /></label>
        <label><span>{ar ? 'وقت الإصدار' : 'Issue time'}</span><input required type="time" value={issueTime} onChange={(event) => setIssueTime(event.target.value)} /></label>
        <label><span>{ar ? 'اسم البائع' : 'Seller name'}</span><input required maxLength={200} value={sellerName} onChange={(event) => setSellerName(event.target.value)} /></label>
        <label><span>{ar ? 'الرقم الضريبي للبائع' : 'Seller VAT number'}</span><input value={vatNumber} readOnly /></label>
        <label><span>{ar ? 'الشارع' : 'Street'}</span><input required maxLength={250} value={sellerAddress} onChange={(event) => setSellerAddress(event.target.value)} /></label>
        <label><span>{ar ? 'رقم المبنى (4 أرقام)' : 'Building number (4 digits)'}</span><input required inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={sellerBuilding} onChange={(event) => setSellerBuilding(event.target.value)} /></label>
        <label><span>{ar ? 'الحي' : 'District'}</span><input required maxLength={120} value={sellerDistrict} onChange={(event) => setSellerDistrict(event.target.value)} /></label>
        <label><span>{ar ? 'الرقم الإضافي (4 أرقام)' : 'Additional number (4 digits)'}</span><input required inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={sellerAdditional} onChange={(event) => setSellerAdditional(event.target.value)} /></label>
        <label><span>{ar ? 'مدينة البائع' : 'Seller city'}</span><input required maxLength={120} value={sellerCity} onChange={(event) => setSellerCity(event.target.value)} /></label>
        <label><span>{ar ? 'الرمز البريدي (5 أرقام)' : 'Postal code (5 digits)'}</span><input required inputMode="numeric" pattern="[0-9]{5}" maxLength={5} value={sellerPostalCode} onChange={(event) => setSellerPostalCode(event.target.value)} /></label>
        {category === 'STANDARD' && <>
          <label><span>{ar ? 'اسم المشتري' : 'Buyer name'}</span><input required maxLength={200} value={buyerName} onChange={(event) => setBuyerName(event.target.value)} /></label>
          <label><span>{ar ? 'الرقم الضريبي للمشتري' : 'Buyer VAT number'}</span><input maxLength={15} value={buyerVatNumber} onChange={(event) => setBuyerVatNumber(event.target.value)} /></label>
          <label><span>{ar ? 'الشارع' : 'Street'}</span><input required maxLength={250} value={buyerAddress} onChange={(event) => setBuyerAddress(event.target.value)} /></label>
          <label><span>{ar ? 'رقم المبنى (4 أرقام)' : 'Building number (4 digits)'}</span><input required inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={buyerBuilding} onChange={(event) => setBuyerBuilding(event.target.value)} /></label>
          <label><span>{ar ? 'الحي' : 'District'}</span><input required maxLength={120} value={buyerDistrict} onChange={(event) => setBuyerDistrict(event.target.value)} /></label>
          <label><span>{ar ? 'مدينة المشتري' : 'Buyer city'}</span><input required maxLength={120} value={buyerCity} onChange={(event) => setBuyerCity(event.target.value)} /></label>
          <label><span>{ar ? 'الرمز البريدي (5 أرقام)' : 'Postal code (5 digits)'}</span><input required inputMode="numeric" pattern="[0-9]{5}" maxLength={5} value={buyerPostalCode} onChange={(event) => setBuyerPostalCode(event.target.value)} /></label>
        </>}
        {documentType !== 'INVOICE' && <>
          <label><span>{ar ? 'مرجع الفاتورة الأصلية' : 'Original invoice reference'}</span><input required maxLength={100} value={billingReference} onChange={(event) => setBillingReference(event.target.value)} /></label>
          <label><span>{ar ? 'سبب الإشعار' : 'Note reason'}</span><input required maxLength={500} value={noteReason} onChange={(event) => setNoteReason(event.target.value)} /></label>
        </>}

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
        <div className="vat-form-actions"><button className="vat-button primary" disabled={!canCreate || busy || !vatNumber}>{busy ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : (ar ? 'حفظ مسودة الفاتورة' : 'Save invoice draft')}</button></div>
      </form>

      <div className="vat-einvoice-list" aria-live="polite">
        {loading && <div className="vat-empty-row">{ar ? 'جارٍ تحميل المسودات…' : 'Loading drafts…'}</div>}
        {!loading && invoices.map((invoice) => <div className="vat-einvoice-item" key={invoice.id}>
          <div><strong>{invoice.invoice_number}</strong><small>{invoice.issue_date} · {invoice.invoice_category === 'STANDARD' ? (ar ? 'قياسية' : 'Standard') : (ar ? 'مبسطة' : 'Simplified')} · {invoice.lines.length} {ar ? 'بنود' : 'lines'}</small></div>
          <div className="vat-einvoice-total">{formatAmount(invoice.payable_amount)} {invoice.currency}</div>
          <span className="vat-status">{ar ? 'مسودة' : 'Draft'}</span>
        </div>)}
        {!loading && !invoices.length && <div className="vat-empty-row">{ar ? 'لا توجد مسودات فواتير بعد.' : 'No invoice drafts yet.'}</div>}
      </div>
      <p className="vat-einvoice-help">{ar ? 'لا تحوّل المسودة إلى فاتورة صادرة قبل استكمال توليد XML والتوقيع والتحقق النظامي.' : 'Do not issue a draft until XML generation, signing and compliance validation are implemented.'}</p>
    </section>
  );
}

function formatAmount(value: string) {
  return Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function messageFor(code: string, ar: boolean) {
  const labels: Record<string, [string, string]> = {
    UNAUTHORIZED: ['يلزم تسجيل الدخول.', 'Please sign in.'],
    ORGANIZATION_ACCESS_REQUIRED: ['ليس لديك صلاحية الوصول إلى هذه المؤسسة.', 'You do not have access to this organization.'],
    ORGANIZATION_ADMIN_REQUIRED: ['إنشاء المسودات متاح لمالك المؤسسة أو مديرها.', 'Only an organization owner or admin can create drafts.'],
    VAT_PROFILE_REQUIRED: ['احفظ ملف التسجيل الضريبي أولًا.', 'Save the VAT registration profile first.'],
    VAT_REGISTRATION_REQUIRED: ['يجب أن تكون المؤسسة مسجلة في ضريبة القيمة المضافة.', 'The organization must be VAT registered.'],
    SELLER_VAT_MISMATCH: ['يجب أن يطابق رقم البائع الرقم الضريبي المسجل للمؤسسة.', 'The seller VAT number must match the organization profile.'],
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
    NOTE_INVOICE_REFERENCE_REQUIRED: ['أدخل مرجع الفاتورة الأصلية للإشعار.', 'Enter the original invoice reference for this note.'],
    NOTE_REASON_REQUIRED: ['أدخل سبب الإشعار.', 'Enter a reason for the note.'],
  };
  if (code.startsWith('LINE_DISCOUNT_EXCEEDS_AMOUNT:')) return ar ? 'لا يمكن أن يتجاوز الخصم إجمالي قيمة البند.' : 'A line discount cannot exceed the line amount.';
  return labels[code]?.[ar ? 0 : 1] ?? (ar ? 'تعذر حفظ المسودة. تحقق من البيانات ثم أعد المحاولة.' : 'Could not save the draft. Check the details and try again.');
}
