'use client';

import { useState } from 'react';
import type { FeasibilityStudy } from '@/lib/feasibility/engine';
import { sharedStudyFields, sharedStudyFieldMaximum, type SharedStudyField } from '@/lib/feasibility/sharing-permissions';

const general = ['monthlyUnits', 'unitPrice', 'variableCost', 'monthlyFixedCost', 'workingCapital', 'discountRatePct'] as const;
const water = ['priceCarton', 'variableCarton', 'fixedMonth', 'bottlesHour', 'discountRate'] as const;

export default function SharedStudyEditor({ locale, organization, study, revision, onClose, onSaved }: {
  locale: string; organization: string; study: FeasibilityStudy; revision: number;
  onClose: () => void; onSaved: () => void;
}) {
  const ar = locale === 'ar';
  const [baseRevision] = useState(revision);
  const [patch, setPatch] = useState<Partial<Record<SharedStudyField | 'title' | 'notes', string | number>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const stale = revision !== baseRevision;
  const fields = study.water ? water.map(field => [field, study.water!.ops[field]] as const)
    : general.map(field => [field, study[field]] as const);

  async function save() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/feasibility/organization-shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'edit', project: study.id, organization, revision: baseRevision, patch }),
      });
      if (response.status === 409) {
        setError(ar ? 'تغيّرت النسخة المشتركة. أعد فتح محرّر التعديل قبل الحفظ.' : 'The shared copy changed. Reopen the editor before saving.');
      } else if (!response.ok) {
        setError(ar ? 'تعذر الحفظ. تحقق من صلاحية التعديل ومدتها.' : 'Could not save. Check the edit permission and expiration.');
      } else onSaved();
    } catch {
      setError(ar ? 'تعذر الاتصال لحفظ النسخة.' : 'Could not connect to save the copy.');
    } finally { setBusy(false); }
  }

  return <form className="fs-form-grid" onSubmit={event => { event.preventDefault(); void save(); }}>
    <label className="fs-field">{ar ? 'عنوان النسخة المشتركة' : 'Shared copy title'}
      <input required maxLength={300} value={patch.title ?? study.title}
        onChange={event => setPatch(current => ({ ...current, title: event.target.value }))}/>
    </label>
    <label className="fs-field">{ar ? 'الملاحظات' : 'Notes'}
      <textarea maxLength={5000} value={patch.notes ?? study.notes ?? ''}
        onChange={event => setPatch(current => ({ ...current, notes: event.target.value }))}/>
    </label>
    {fields.map(([field, value]) => <label key={field} className="fs-field">{sharedStudyFields[field][ar ? 0 : 1]}
      <input type="number" min={0} max={sharedStudyFieldMaximum(field)} step="any" required value={patch[field] ?? value}
        onChange={event => setPatch(current => ({ ...current, [field]: event.target.value === '' ? '' : Number(event.target.value) }))}/>
    </label>)}
    <div>
      <button type="submit" className="fs-btn" disabled={busy || stale || !Object.keys(patch).length}>
        {ar ? 'حفظ تعديل النسخة' : 'Save copy edits'}
      </button>{' '}
      <button type="button" className="fs-btn fs-btn--secondary" onClick={onClose} disabled={busy}>
        {ar ? 'إغلاق المحرّر' : 'Close editor'}
      </button>
    </div>
    {(error || stale) && <p role="alert">{error || (ar ? 'تغيّرت النسخة المشتركة. أعد فتح المحرّر.' : 'The shared copy changed. Reopen the editor.')}</p>}
  </form>;
}
