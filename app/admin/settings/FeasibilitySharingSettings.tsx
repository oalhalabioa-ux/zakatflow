'use client';

import { useState } from 'react';
import type { z } from 'zod';
import { sharingModeSchema } from '@/lib/feasibility/sharing-permissions';

type Mode = z.infer<typeof sharingModeSchema>;

export default function FeasibilitySharingSettings({ locale, initialMode }: { locale: string; initialMode: Mode }) {
  const ar = locale === 'ar';
  const [saved, setSaved] = useState(initialMode);
  const [mode, setMode] = useState(initialMode);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'saved' | 'error'>();

  async function save() {
    setBusy(true);
    setStatus(undefined);
    try {
      const response = await fetch('/api/admin/settings/feasibility-sharing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const stored = sharingModeSchema.parse((await response.json()).mode);
      if (!response.ok) throw new Error();
      setMode(stored);
      setSaved(stored);
      setStatus('saved');
    } catch {
      setStatus('error');
    } finally {
      setBusy(false);
    }
  }

  return <article>
    <h3>{ar ? 'مشاركة دراسات الجدوى بين المؤسسات' : 'Feasibility sharing between organizations'}</h3>
    <p>{ar ? 'يُطبّق الإعداد على المشاركات الحالية والجديدة. عند اختيار القراءة فقط يتوقف تعديل النسخ المشتركة.'
      : 'This setting applies to existing and new shares. Read only pauses edits to shared copies.'}</p>
    <form className="owner-plan-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <label>{ar ? 'الصلاحيات المتاحة للمالك' : 'Permissions available to owners'}
        <select value={mode} disabled={busy} onChange={event => { setMode(sharingModeSchema.parse(event.target.value)); setStatus(undefined); }}>
          <option value="disabled">{ar ? 'إيقاف المشاركة' : 'Sharing off'}</option>
          <option value="read">{ar ? 'السماح بالقراءة فقط' : 'Allow read only'}</option>
          <option value="edit">{ar ? 'السماح بالقراءة أو القراءة والتعديل' : 'Allow read or read and edit'}</option>
        </select>
      </label>
      <button type="submit" disabled={busy || mode === saved}>
        {ar ? 'حفظ إعداد المشاركة' : 'Save sharing setting'}
      </button>
    </form>
    {status === 'saved' && <p role="status">{ar ? 'تم حفظ إعداد المشاركة.' : 'Sharing setting saved.'}</p>}
    {status === 'error' && <p role="alert">{ar ? 'تعذر حفظ إعداد المشاركة.' : 'Could not save the sharing setting.'}</p>}
  </article>;
}
