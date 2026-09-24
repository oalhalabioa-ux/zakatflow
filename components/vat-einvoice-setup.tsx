'use client';

import { FormEvent, useEffect, useState } from 'react';

type Connection = {
  id: string;
  environment: 'SIMULATION' | 'PRODUCTION';
  status: string;
  branch_name: string;
  common_name: string;
  last_error_code: string | null;
};

export function VatEInvoiceSetup({
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
  const [connections, setConnections] = useState<Connection[]>([]);
  const [environment, setEnvironment] = useState<'SIMULATION' | 'PRODUCTION'>('SIMULATION');
  const [commonName, setCommonName] = useState('ZakatFlow Invoice Unit');
  const [legalName, setLegalName] = useState(organizationName);
  const [branchName, setBranchName] = useState(organizationName);
  const [branchLocation, setBranchLocation] = useState('');
  const [industry, setIndustry] = useState('');
  const [invoiceType, setInvoiceType] = useState('1100');
  const [busy, setBusy] = useState(false);
  const [otp, setOtp] = useState('');
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [canConfigure, setCanConfigure] = useState(registered);
  const [setupBlock, setSetupBlock] = useState<'VAT' | 'ADMIN' | null>(registered ? null : 'VAT');
  const simulationUnitExists = connections.some((item) => item.environment === 'SIMULATION' && !['NOT_CONFIGURED', 'ERROR'].includes(item.status));

  useEffect(() => {
    if (!organizationId) return;
    let active = true;
    fetch(`/api/vat/e-invoicing?organization_id=${encodeURIComponent(organizationId)}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error || `HTTP_${response.status}`);
        return body;
      })
      .then((body) => {
        if (!active) return;
        setConnections(body.connections ?? []);
        setCanConfigure(Boolean(body.available && body.is_admin));
        setSetupBlock(!body.available ? 'VAT' : !body.is_admin ? 'ADMIN' : null);
      })
      .catch((error) => { if (active) setMessage({ error: true, text: messageFor(error.message, ar) }); });
    return () => { active = false; };
  }, [organizationId, registered, ar]);

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch('/api/vat/e-invoicing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organization_id: organizationId,
          environment,
          taxpayer_vat_number: vatNumber.trim(),
          common_name: commonName,
          legal_name: legalName,
          branch_name: branchName,
          branch_location: branchLocation,
          industry,
          invoice_type: invoiceType,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || `HTTP_${response.status}`);
      setConnections((current) => [...current.filter((item) => item.environment !== body.environment), body]);
      setMessage({ error: false, text: ar ? 'تم تجهيز الوحدة ومفتاح التوقيع. أنشئ رمز OTP من بوابة فاتورة وأدخله هنا لإرسال CSR وطلب شهادة المحاكاة.' : 'The invoice unit and signing key are ready. Generate an OTP in Fatoora and enter it here to submit the CSR and request the simulation CSID.' });
    } catch (error) {
      setMessage({ error: true, text: messageFor(error instanceof Error ? error.message : 'UNKNOWN_ERROR', ar) });
    } finally {
      setBusy(false);
    }
  }

  async function requestComplianceCertificate(connectionId: string) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch('/api/vat/e-invoicing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'onboard_simulation', organization_id: organizationId, connection_id: connectionId, otp }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || `HTTP_${response.status}`);
      setConnections((current) => current.map((item) => item.id === connectionId ? { ...item, status: body.status, last_error_code: null } : item));
      setOtp('');
      setMessage({ error: false, text: ar ? 'استلم النظام شهادة المحاكاة وحفظ بياناتها السرية بأمان. اكتمل طلب CSID؛ تبقى اختبارات الامتثال.' : 'The simulation CSID was received and its credentials were stored securely. CSID onboarding succeeded; compliance tests remain.' });
    } catch (error) {
      setMessage({ error: true, text: messageFor(error instanceof Error ? error.message : 'UNKNOWN_ERROR', ar) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="vat-panel">
      <div className="vat-panel-head">
        <div>
          <span className="vat-eyebrow">{ar ? 'اختياري لكل مؤسسة' : 'OPTIONAL PER ORGANIZATION'}</span>
          <h2>{ar ? 'الربط مع الفوترة الإلكترونية — زاتكا' : 'ZATCA e-invoicing connection'}</h2>
          <p>{ar ? 'ابدأ ببيئة المحاكاة. تبقى مفاتيح التوقيع داخل AWS KMS ولا تُعرض أو تُحفظ في قاعدة البيانات.' : 'Start in simulation. Signing keys stay inside AWS KMS and are never exposed or stored in the database.'}</p>
        </div>
      </div>

      {setupBlock && <div className="vat-inline-warning">{setupBlock === 'VAT'
        ? (ar ? 'أكمل تسجيل المؤسسة في ضريبة القيمة المضافة أولًا لإعداد الربط.' : 'Complete the organization VAT registration profile before setting up the connection.')
        : (ar ? 'إعداد الربط متاح لمالك المؤسسة أو مديرها فقط.' : 'Only an organization owner or admin can set up this connection.')}</div>}
      {message && <div className={`vat-notice ${message.error ? 'error' : 'success'}`} role={message.error ? 'alert' : 'status'}>{message.text}</div>}

      <form className="vat-form-grid" onSubmit={prepare}>
        <label><span>{ar ? 'بيئة الربط' : 'Connection environment'}</span><select value={environment} onChange={(event) => setEnvironment(event.target.value as typeof environment)}><option value="SIMULATION">{ar ? 'محاكاة زاتكا' : 'ZATCA simulation'}</option><option value="PRODUCTION" disabled>{ar ? 'الإنتاج — بعد اجتياز المحاكاة' : 'Production — after simulation approval'}</option></select></label>
        <label><span>{ar ? 'الرقم الضريبي (15 رقمًا)' : 'VAT registration number (15 digits)'}</span><input value={vatNumber} readOnly /></label>
        <label><span>{ar ? 'اسم وحدة الفوترة' : 'Invoice unit name'}</span><input required maxLength={120} value={commonName} onChange={(event) => setCommonName(event.target.value)} /></label>
        <label><span>{ar ? 'الاسم النظامي للمؤسسة' : 'Registered organization name'}</span><input required maxLength={200} value={legalName} onChange={(event) => setLegalName(event.target.value)} /></label>
        <label><span>{ar ? 'الفرع / الوحدة التنظيمية' : 'Branch / organization unit'}</span><input required maxLength={120} value={branchName} onChange={(event) => setBranchName(event.target.value)} /></label>
        <label><span>{ar ? 'العنوان الوطني المختصر أو موقع الوحدة' : 'National short address or unit location'}</span><input required maxLength={200} value={branchLocation} onChange={(event) => setBranchLocation(event.target.value)} /></label>
        <label><span>{ar ? 'النشاط أو القطاع' : 'Industry or sector'}</span><input required maxLength={120} value={industry} onChange={(event) => setIndustry(event.target.value)} /></label>
        <label><span>{ar ? 'أنواع الفواتير التي ستصدرها الوحدة' : 'Invoice types this unit will issue'}</span><select value={invoiceType} onChange={(event) => setInvoiceType(event.target.value)}><option value="1000">{ar ? 'ضريبية قياسية (B2B)' : 'Standard tax invoices (B2B)'}</option><option value="0100">{ar ? 'مبسطة (B2C)' : 'Simplified invoices (B2C)'}</option><option value="1100">{ar ? 'قياسية ومبسطة' : 'Standard and simplified'}</option></select></label>
        <div className="vat-form-actions"><button className="vat-button primary" disabled={!canConfigure || busy || !vatNumber || simulationUnitExists}>{busy ? (ar ? 'جارٍ إعداد مفتاح التوقيع…' : 'Preparing signing key…') : simulationUnitExists ? (ar ? 'وحدة المحاكاة مهيأة' : 'Simulation unit prepared') : (ar ? 'إعداد وحدة الفوترة' : 'Prepare invoice unit')}</button></div>
      </form>

      {connections.length > 0 && <div className="vat-einvoice-list" aria-live="polite">
        {connections.map((connection) => <div className="vat-einvoice-item" key={connection.id}>
          <div><strong>{connection.branch_name || connection.common_name}</strong><small>{connection.environment === 'SIMULATION' ? (ar ? 'بيئة المحاكاة' : 'Simulation') : (ar ? 'الإنتاج' : 'Production')}</small>
            {connection.status === 'KEY_READY' && <div className="vat-otp-row"><label><span>{ar ? 'رمز OTP من بوابة فاتورة' : 'OTP from Fatoora portal'}</span><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label><button type="button" className="vat-button primary" disabled={busy || otp.length !== 6} onClick={() => void requestComplianceCertificate(connection.id)}>{busy ? (ar ? 'جارٍ الربط…' : 'Connecting…') : (ar ? 'طلب شهادة المحاكاة' : 'Request simulation CSID')}</button></div>}
            {connection.status === 'COMPLIANCE_PENDING' && <small className="vat-einvoice-pending">{ar ? 'تم استلام CSID للمحاكاة. يلزم اجتياز اختبارات الامتثال قبل طلب الإنتاج.' : 'Simulation CSID received. Compliance tests must pass before production onboarding.'}</small>}
            {connection.last_error_code === 'FATOORA_COMPLIANCE_REQUEST_FAILED' && <small className="vat-einvoice-error">{ar ? 'آخر محاولة لم تنجح. أنشئ OTP جديدًا ثم أعد المحاولة.' : 'The last attempt failed. Generate a fresh OTP and retry.'}</small>}
          </div>
          <span className={`vat-status ${connection.status === 'KEY_READY' || connection.status === 'COMPLIANCE_PENDING' ? 'registered' : ''}`}>{statusLabel(connection.status, ar)}</span>
        </div>)}
      </div>}
      <p className="vat-einvoice-help">{ar ? 'رمز OTP صالح لمدة ساعة ويُستخدم لإرسال CSR واستلام شهادة المحاكاة. لا تحفظ الشاشة الرمز. هذه المرحلة لا تصدر شهادة إنتاج ولا ترسل فواتير.' : 'The OTP is valid for one hour and is used to submit the CSR and receive a simulation CSID. The OTP is not saved. This step does not issue a production certificate or send invoices.'}</p>
    </section>
  );
}

function messageFor(code: string, ar: boolean) {
  const labels: Record<string, [string, string]> = {
    UNAUTHORIZED: ['يلزم تسجيل الدخول.', 'Please sign in.'],
    ORGANIZATION_ACCESS_REQUIRED: ['ليس لديك صلاحية الوصول إلى هذه المؤسسة.', 'You do not have access to this organization.'],
    ORGANIZATION_ADMIN_REQUIRED: ['إعداد الربط متاح لمالك المؤسسة أو مديرها.', 'Only organization owners and admins can configure this connection.'],
    AWS_KMS_NOT_CONFIGURED: ['لم تُضبط صلاحيات AWS KMS وSecrets Manager لهذا النشر بعد.', 'AWS KMS and Secrets Manager permissions have not been configured for this deployment yet.'],
    VAT_PROFILE_REQUIRED: ['احفظ ملف التسجيل الضريبي أولًا.', 'Save the VAT registration profile first.'],
    VAT_REGISTRATION_REQUIRED: ['يجب أن تكون المؤسسة مسجلة في ضريبة القيمة المضافة.', 'The organization must be VAT registered.'],
    VAT_NUMBER_MISMATCH: ['يجب أن يطابق الرقم الرقم المحفوظ في ملف التسجيل.', 'The VAT number must match the saved registration profile.'],
    INVALID_EINVOICE_SETUP: ['تحقق من البيانات المطلوبة ورقم التسجيل الضريبي.', 'Check the required details and VAT registration number.'],
    EINVOICE_SETUP_ALREADY_EXISTS: ['توجد وحدة فوترة لهذا النوع من البيئات بالفعل.', 'An invoice unit already exists for this environment.'],
    INVALID_EINVOICE_OTP: ['أدخل رمز OTP المكوّن من 6 أرقام.', 'Enter the six-digit OTP.'],
    FATOORA_COMPLIANCE_REQUEST_FAILED: ['رفضت بوابة زاتكا طلب المحاكاة أو تعذر إكماله. تحقق من OTP وبيانات الوحدة ثم أعد إصدار رمز جديد.', 'FATOORA rejected the simulation request or could not complete it. Check the OTP and unit details, then generate a fresh OTP.'],
    COMPLIANCE_ALREADY_REQUESTED: ['تم إرسال طلب الشهادة لهذه الوحدة بالفعل.', 'A certificate request has already been sent for this unit.'],
    PRODUCTION_ONBOARDING_LOCKED: ['يجب اجتياز اختبارات المحاكاة أولًا قبل إعداد الإنتاج.', 'Pass the simulation compliance tests before production setup.'],
  };
  return labels[code]?.[ar ? 0 : 1] ?? (ar ? 'تعذر إعداد الاتصال. تحقق من صلاحيات AWS KMS.' : 'The connection could not be prepared. Check AWS KMS permissions.');
}

function statusLabel(status: string, ar: boolean) {
  const labels: Record<string, [string, string]> = {
    NOT_CONFIGURED: ['غير مهيأ', 'Not configured'],
    KEY_READY: ['مفتاح التوقيع جاهز', 'Signing key ready'],
    COMPLIANCE_PENDING: ['شهادة المحاكاة مستلمة', 'Simulation CSID received'],
    COMPLIANCE_PASSED: ['اجتاز اختبارات الامتثال', 'Compliance passed'],
    PRODUCTION_PENDING: ['طلب الإنتاج قيد الإجراء', 'Production request pending'],
    CONNECTED: ['متصل', 'Connected'],
    ERROR: ['تعذر الإكمال', 'Error'],
  };
  return labels[status]?.[ar ? 0 : 1] ?? status;
}
