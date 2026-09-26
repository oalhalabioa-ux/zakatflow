'use client';

import { FormEvent, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export type VatContact = {
  id: string;
  organization_id: string;
  contact_type: 'CUSTOMER' | 'SUPPLIER' | 'BOTH';
  name: string;
  vat_number: string | null;
  email: string | null;
  phone: string | null;
  street: string | null;
  building_number: string | null;
  district: string | null;
  additional_number: string | null;
  city: string | null;
  postal_code: string | null;
  country_code: string;
};

type Draft = Omit<VatContact, 'id' | 'organization_id' | 'contact_type'>;
const emptyDraft: Draft = {
  name: '', vat_number: '', email: '', phone: '', street: '', building_number: '',
  district: '', additional_number: '', city: '', postal_code: '', country_code: 'SA',
};

export function VatContactPicker({
  organizationId, role, ar, label, value, required = false, requireSaudiAddress = false, onChange,
}: {
  organizationId: string;
  role: 'CUSTOMER' | 'SUPPLIER';
  ar: boolean;
  label: string;
  value: string;
  required?: boolean;
  requireSaudiAddress?: boolean;
  onChange: (contact: VatContact | null) => void;
}) {
  const [contacts, setContacts] = useState<VatContact[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!organizationId) return;
    let active = true;
    fetch(`/api/vat/contacts?organization_id=${encodeURIComponent(organizationId)}&role=${role}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error || `HTTP_${response.status}`);
        return body;
      })
      .then((body) => {
        if (!active) return;
        setContacts(body.contacts ?? []);
        setCanManage(Boolean(body.can_manage));
      })
      .catch(() => { if (active) setError(ar ? 'تعذر تحميل قائمة الجهات.' : 'Could not load contacts.'); });
    return () => { active = false; };
  }, [organizationId, role, ar]);

  async function saveContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // This picker is rendered inside invoice forms. Keep the contact form's
    // submit from triggering the surrounding invoice/document form as well.
    event.stopPropagation();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/vat/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...draft,
          building_number: draft.building_number?.trim() || null,
          additional_number: draft.additional_number?.trim() || null,
          postal_code: draft.postal_code?.trim() || null,
          vat_number: draft.vat_number?.trim() || null,
          email: draft.email?.trim() || null,
          phone: draft.phone?.trim() || null,
          street: draft.street?.trim() || null,
          district: draft.district?.trim() || null,
          city: draft.city?.trim() || null,
          organization_id: organizationId,
          contact_type: role,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        if (body.error === 'VAT_CONTACT_EXISTS') throw new Error(ar ? 'هذا الاسم مسجل مسبقًا؛ اختره من القائمة.' : 'This name already exists. Select it from the list.');
        throw new Error(body?.issues?.[0]?.message || body?.error || `HTTP_${response.status}`);
      }
      setContacts((current) => [...current, body].sort((a, b) => a.name.localeCompare(b.name)));
      onChange(body as VatContact);
      setDraft(emptyDraft);
      setDialogOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : (ar ? 'تعذر حفظ الجهة.' : 'Could not save contact.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="vat-contact-picker">
      <div className="vat-contact-picker-head">
        <label htmlFor={`vat-contact-${role}-${organizationId}`}><span>{label}</span></label>
        {canManage && <button type="button" className="vat-contact-add" onClick={() => { setError(''); setDialogOpen(true); }}>
          <span aria-hidden="true">+</span>{ar ? `إضافة ${role === 'CUSTOMER' ? 'عميل' : 'مورد'}` : `Add ${role === 'CUSTOMER' ? 'customer' : 'supplier'}`}
        </button>}
      </div>
      <select
        id={`vat-contact-${role}-${organizationId}`}
        required={required}
        value={value}
        onChange={(event) => onChange(contacts.find((contact) => contact.id === event.target.value) ?? null)}
      >
        <option value="">{ar ? 'اختر جهة محفوظة أو أضف جهة جديدة' : 'Choose a saved contact or add a new one'}</option>
        {contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}{contact.vat_number ? ` · ${contact.vat_number}` : ''}</option>)}
      </select>
      {requireSaudiAddress && value && <small className="vat-contact-picker-hint">{ar ? 'ستُستخدم بيانات العنوان المحفوظة لملء الفاتورة، ويمكن تعديلها لهذه الفاتورة فقط.' : 'Saved address details fill the invoice and can be changed for this invoice only.'}</small>}
      {error && !dialogOpen && <small className="vat-contact-error" role="alert">{error}</small>}

      {dialogOpen && typeof document !== 'undefined' && createPortal(<div className="vat-contact-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialogOpen(false); }}>
        <section className="vat-contact-dialog" role="dialog" aria-modal="true" aria-labelledby={`vat-contact-dialog-title-${role}`}>
          <div className="vat-contact-dialog-head">
            <div><span className="vat-eyebrow">{ar ? 'جهات المؤسسة' : 'ORGANIZATION CONTACTS'}</span><h3 id={`vat-contact-dialog-title-${role}`}>{ar ? `إضافة ${role === 'CUSTOMER' ? 'عميل' : 'مورد'}` : `Add ${role === 'CUSTOMER' ? 'customer' : 'supplier'}`}</h3></div>
            <button type="button" className="vat-icon-button" aria-label={ar ? 'إغلاق' : 'Close'} onClick={() => setDialogOpen(false)}>×</button>
          </div>
          <form onSubmit={saveContact} className="vat-contact-form">
            <label><span>{ar ? 'الاسم المسجل' : 'Registered name'}</span><input required autoFocus maxLength={200} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
            <label><span>{ar ? 'الرقم الضريبي (إن وجد)' : 'VAT number (if available)'}</span><input maxLength={30} value={draft.vat_number ?? ''} onChange={(event) => setDraft({ ...draft, vat_number: event.target.value })} /></label>
            <label><span>{ar ? 'البريد الإلكتروني' : 'Email'}</span><input type="email" maxLength={254} value={draft.email ?? ''} onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></label>
            <label><span>{ar ? 'رقم الهاتف' : 'Phone'}</span><input maxLength={40} value={draft.phone ?? ''} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} /></label>
            <label className="vat-contact-form-wide"><span>{ar ? 'الشارع' : 'Street'}</span><input required={requireSaudiAddress} maxLength={250} value={draft.street ?? ''} onChange={(event) => setDraft({ ...draft, street: event.target.value })} /></label>
            <label><span>{ar ? 'رقم المبنى (4 أرقام)' : 'Building number (4 digits)'}</span><input required={requireSaudiAddress} inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={draft.building_number ?? ''} onChange={(event) => setDraft({ ...draft, building_number: event.target.value })} /></label>
            <label><span>{ar ? 'الحي' : 'District'}</span><input required={requireSaudiAddress} maxLength={120} value={draft.district ?? ''} onChange={(event) => setDraft({ ...draft, district: event.target.value })} /></label>
            <label><span>{ar ? 'الرقم الإضافي (4 أرقام)' : 'Additional number (4 digits)'}</span><input required={requireSaudiAddress} inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={draft.additional_number ?? ''} onChange={(event) => setDraft({ ...draft, additional_number: event.target.value })} /></label>
            <label><span>{ar ? 'المدينة' : 'City'}</span><input required={requireSaudiAddress} maxLength={120} value={draft.city ?? ''} onChange={(event) => setDraft({ ...draft, city: event.target.value })} /></label>
            <label><span>{ar ? 'الرمز البريدي (5 أرقام)' : 'Postal code (5 digits)'}</span><input required={requireSaudiAddress} inputMode="numeric" pattern="[0-9]{5}" maxLength={5} value={draft.postal_code ?? ''} onChange={(event) => setDraft({ ...draft, postal_code: event.target.value })} /></label>
            <p className="vat-contact-dialog-note">{ar ? 'تُحفظ الجهة للمؤسسة المحددة وتظهر لاحقًا في سجل المستندات والفواتير الإلكترونية.' : 'This contact is saved for the selected organization and will be available in the document register and e-invoices.'}</p>
            {error && <small className="vat-contact-error vat-contact-form-wide" role="alert">{error}</small>}
            <div className="vat-form-actions vat-contact-form-wide">
              <button type="button" className="vat-button secondary" onClick={() => setDialogOpen(false)}>{ar ? 'إلغاء' : 'Cancel'}</button>
              <button className="vat-button primary" disabled={busy}>{busy ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : (ar ? 'حفظ واختيار' : 'Save and select')}</button>
            </div>
          </form>
        </section>
      </div>, document.body)}
    </div>
  );
}
