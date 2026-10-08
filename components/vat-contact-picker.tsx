'use client';

import { FormEvent, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type VatContact = {
  id: string;
  updated_at: string;
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

type Draft = Omit<VatContact, 'id' | 'organization_id' | 'contact_type' | 'updated_at'>;
const emptyDraft: Draft = {
  name: '', vat_number: '', email: '', phone: '', street: '', building_number: '',
  district: '', additional_number: '', city: '', postal_code: '', country_code: 'SA',
};

export function VatContactPicker({
  organizationId, role, ar, label, value, required = false, requireSaudiAddress = false, compactAdd = false, onChange,
}: {
  organizationId: string;
  role: 'CUSTOMER' | 'SUPPLIER';
  ar: boolean;
  label: string;
  value: string;
  required?: boolean;
  requireSaudiAddress?: boolean;
  compactAdd?: boolean;
  onChange: (contact: VatContact | null) => void;
}) {
  const pickerId = useId();
  const previousFocus = useRef<HTMLElement | null>(null);
  const busyRef = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  const [editingContact, setEditingContact] = useState<VatContact | null>(null);
  const [contacts, setContacts] = useState<VatContact[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { busyRef.current = busy; }, [busy]);

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

  useEffect(() => {
    const changed = (event: Event) => {
      const contact = (event as CustomEvent<VatContact>).detail;
      if (!contact || contact.organization_id !== organizationId) return;
      setContacts(current => [...current.filter(item => item.id !== contact.id), ...(['BOTH',role].includes(contact.contact_type) ? [contact] : [])].sort((a,b)=>a.name.localeCompare(b.name)));
    };
    window.addEventListener('vat-contact-changed', changed);
    return () => window.removeEventListener('vat-contact-changed', changed);
  }, [organizationId, role]);

  useEffect(() => {
    if (!dialogOpen) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) { event.preventDefault(); setDialogOpen(false); }
      if (event.key !== 'Tab') return;
      const elements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled])') || []);
      const first=elements[0], last=elements[elements.length-1];
      if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}
    };
    document.addEventListener('keydown',keydown);
    return () => { document.removeEventListener('keydown',keydown); previousFocus.current?.focus(); };
  }, [dialogOpen]);

  async function saveContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // This picker is rendered inside invoice forms. Keep the contact form's
    // submit from triggering the surrounding invoice/document form as well.
    event.stopPropagation();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/vat/contacts', {
        method: editingContact ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...draft,
          ...(editingContact ? { contact_id: editingContact.id, expected_updated_at: editingContact.updated_at } : {}),
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
          contact_type: editingContact?.contact_type || role,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        if (body.error === 'VAT_CONTACT_EDIT_CONFLICT') throw new Error(ar ? 'عُدلت هذه الجهة من جلسة أخرى. أغلق النافذة وأعد تحميل الصفحة قبل التعديل.' : 'This contact changed in another session. Close and reload before editing.');
        if (body.error === 'VAT_CONTACT_UPDATE_FAILED') throw new Error(ar ? 'تعذر حفظ التعديل؛ أعد المحاولة.' : 'Could not save changes. Please retry.');
        if (body.error === 'VAT_CONTACT_EXISTS') throw new Error(ar ? 'هذا الاسم مسجل مسبقًا؛ اختره من القائمة.' : 'This name already exists. Select it from the list.');
        throw new Error(body?.issues?.[0]?.message || body?.error || `HTTP_${response.status}`);
      }
      setContacts((current) => [...current.filter(contact => contact.id !== body.id), body].sort((a, b) => a.name.localeCompare(b.name)));
      window.dispatchEvent(new CustomEvent('vat-contact-changed', { detail:body }));
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
      <div className={`vat-contact-picker-head ${compactAdd ? 'is-compact' : ''}`}>
        <label htmlFor={`vat-contact-${role}-${organizationId}-${pickerId}`}><span>{label}</span></label>
        {canManage && <button type="button" className={`vat-contact-add ${compactAdd ? 'vat-contact-add-icon' : ''}`} aria-label={ar ? (role === 'CUSTOMER' ? 'إضافة عميل' : 'إضافة مورد') : (role === 'CUSTOMER' ? 'Add customer' : 'Add supplier')} title={ar ? (role === 'CUSTOMER' ? 'إضافة عميل' : 'إضافة مورد') : (role === 'CUSTOMER' ? 'Add customer' : 'Add supplier')} onClick={() => { setEditingContact(null); setDraft(emptyDraft); setError(''); setDialogOpen(true); }}>
          <span aria-hidden="true">+</span>{!compactAdd && (ar ? 'إضافة' : 'Add')}
        </button>}
        {canManage && value && <button type="button" className="vat-contact-add" onClick={() => {
          const contact = contacts.find(item => item.id === value); if (!contact) return;
          setEditingContact(contact); setDraft({ name:contact.name, vat_number:contact.vat_number, email:contact.email, phone:contact.phone, street:contact.street, building_number:contact.building_number, district:contact.district, additional_number:contact.additional_number, city:contact.city, postal_code:contact.postal_code, country_code:contact.country_code }); setError(''); setDialogOpen(true);
        }}>{ar ? 'تعديل البيانات' : 'Edit details'}</button>}
      </div>
      <select
        id={`vat-contact-${role}-${organizationId}-${pickerId}`}
        required={required}
        value={value}
        onChange={(event) => onChange(contacts.find((contact) => contact.id === event.target.value) ?? null)}
      >
        <option value="">{ar ? 'اختر جهة' : 'Select contact'}</option>
        {contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}{contact.vat_number ? ` · ${contact.vat_number}` : ''}</option>)}
      </select>
      {requireSaudiAddress && value && <small className="vat-contact-picker-hint">{ar ? 'تُستخدم بيانات العنوان المحفوظة تلقائيًا في الفاتورة.' : 'Saved address details are added to the invoice automatically.'}</small>}
      {error && !dialogOpen && <small className="vat-contact-error" role="alert">{error}</small>}

      {dialogOpen && typeof document !== 'undefined' && createPortal(<div className="vat-contact-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) setDialogOpen(false); }}>
        <section ref={dialogRef} className="vat-contact-dialog" role="dialog" aria-modal="true" aria-labelledby={`vat-contact-dialog-title-${role}`}>
          <div className="vat-contact-dialog-head">
            <div><span className="vat-eyebrow">{ar ? 'جهات المؤسسة' : 'ORGANIZATION CONTACTS'}</span><h3 id={`vat-contact-dialog-title-${role}`}>{ar ? `${editingContact ? 'تعديل بيانات' : 'إضافة'} ${role === 'CUSTOMER' ? 'عميل' : 'مورد'}` : `${editingContact ? 'Edit' : 'Add'} ${role === 'CUSTOMER' ? 'customer' : 'supplier'}`}</h3></div>
            <button type="button" className="vat-icon-button" aria-label={ar ? 'إغلاق' : 'Close'} disabled={busy} onClick={() => setDialogOpen(false)}>×</button>
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
            <p className="vat-contact-dialog-note">{ar ? 'تُحفظ بيانات الجهة للمؤسسة المحددة. الفواتير المحفوظة سابقًا تحتفظ ببياناتها؛ راجع بيانات المسودة عند تعديلها.' : 'Contact details are saved for this organization. Existing invoices keep their snapshots; review draft details when editing.'}</p>
            {error && <small className="vat-contact-error vat-contact-form-wide" role="alert">{error}</small>}
            <div className="vat-form-actions vat-contact-form-wide">
              <button type="button" className="vat-button secondary" disabled={busy} onClick={() => setDialogOpen(false)}>{ar ? 'إلغاء' : 'Cancel'}</button>
              <button className="vat-button primary" disabled={busy}>{busy ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : (ar ? 'حفظ واختيار' : 'Save and select')}</button>
            </div>
          </form>
        </section>
      </div>, document.body)}
    </div>
  );
}
