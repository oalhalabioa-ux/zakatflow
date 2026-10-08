'use client';
import { InvoiceIcon } from './invoice-action-label';
import { useState } from 'react';
import { VatContactPicker, type VatContact } from './vat-contact-picker';

export function VatContactsManager({ organizationId, ar, role }: { organizationId: string; ar: boolean; role?: 'CUSTOMER' | 'SUPPLIER' }) {
  const [customer, setCustomer] = useState<VatContact | null>(null);
  const [supplier, setSupplier] = useState<VatContact | null>(null);
  return <details className="vat-contacts-manager vat-contacts-menu">
    <summary><InvoiceIcon name="users" />{role==='CUSTOMER'?(ar?'إدارة العملاء':'Manage customers'):role==='SUPPLIER'?(ar?'إدارة الموردين':'Manage suppliers'):(ar?'إدارة بيانات العملاء والموردين':'Manage contacts')}</summary><div className="vat-contacts-dropdown">
    <p className="vat-field-hint">{ar ? 'اختر الجهة ثم اضغط «تعديل البيانات». التعديل يخص بيانات الجهة، ولا يغير مبالغ الفواتير السابقة.' : 'Select a contact, then choose Edit details. Editing master data does not change previous invoice amounts.'}</p>
    <div className="vat-contacts-manager-grid">
      {role!=='SUPPLIER' && <div><VatContactPicker organizationId={organizationId} role="CUSTOMER" ar={ar} label={ar?'العملاء':'Customers'} value={customer?.id || ''} onChange={setCustomer} />{customer && <small>{customer.phone || '—'} · {customer.email || '—'}</small>}</div>}
      {role!=='CUSTOMER' && <div><VatContactPicker organizationId={organizationId} role="SUPPLIER" ar={ar} label={ar?'الموردون':'Suppliers'} value={supplier?.id || ''} onChange={setSupplier} />{supplier && <small>{supplier.phone || '—'} · {supplier.email || '—'}</small>}</div>}
    </div>
    </div>
  </details>;
}
