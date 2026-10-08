'use client';
import { useState } from 'react';
import { VatContactPicker, type VatContact } from './vat-contact-picker';

export function VatContactsManager({ organizationId, ar }: { organizationId: string; ar: boolean }) {
  const [customer, setCustomer] = useState<VatContact | null>(null);
  const [supplier, setSupplier] = useState<VatContact | null>(null);
  return <details className="vat-contacts-manager vat-panel">
    <summary>{ar ? 'إدارة بيانات العملاء والموردين' : 'Manage customer and supplier details'}</summary>
    <p className="vat-field-hint">{ar ? 'اختر الجهة ثم اضغط «تعديل البيانات». التعديل يخص بيانات الجهة، ولا يغير مبالغ الفواتير السابقة.' : 'Select a contact, then choose Edit details. Editing master data does not change previous invoice amounts.'}</p>
    <div className="vat-contacts-manager-grid">
      <div><VatContactPicker organizationId={organizationId} role="CUSTOMER" ar={ar} label={ar?'العملاء':'Customers'} value={customer?.id || ''} onChange={setCustomer} />{customer && <small>{customer.phone || '—'} · {customer.email || '—'}</small>}</div>
      <div><VatContactPicker organizationId={organizationId} role="SUPPLIER" ar={ar} label={ar?'الموردون':'Suppliers'} value={supplier?.id || ''} onChange={setSupplier} />{supplier && <small>{supplier.phone || '—'} · {supplier.email || '—'}</small>}</div>
    </div>
  </details>;
}
