'use strict';

const refresh = document.getElementById('refresh');
const prepare = document.getElementById('prepare');
const submit = document.getElementById('submit');
const status = document.getElementById('status');
const details = document.getElementById('details');
let saved;
let busy = false;

const labels = {
  NOT_PREPARED: 'لم تُجهّز عينة الإبلاغ بعد.',
  READY: 'العينة موقّعة ومحفوظة وجاهزة للإرسال مرة واحدة.',
  REPORTED_WITHOUT_WARNINGS: 'قبلت المحاكاة الإبلاغ دون تحذيرات.',
  REPORTED_WITH_WARNINGS: 'قبلت المحاكاة الإبلاغ مع تحذيرات.',
  REJECTED: 'رفضت المحاكاة الإبلاغ عن العينة.',
  UNCONFIRMED: 'حُفظ الرد، وحالة الإبلاغ غير مؤكدة.',
  RECONCILIATION_REQUIRED: 'سُجّلت محاولة الإرسال. حدّث الحالة لمراجعة النتيجة.',
};

function controls() {
  refresh.disabled = busy;
  prepare.disabled = busy || saved?.state !== 'NOT_PREPARED';
  submit.disabled = busy || saved?.state !== 'READY' || !saved?.manifestDigest;
}

async function request(action) {
  if (busy) return;
  busy = true;
  controls();
  try {
    const response = await fetch('/api/simulation', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action === 'reportingSubmit' ? { action, manifestDigest: saved.manifestDigest } : { action }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.simplifiedReporting) throw new Error(payload.error || 'QA_REQUEST_FAILED');
    saved = payload.simplifiedReporting;
    status.textContent = labels[saved.state] || 'حالة غير معروفة.';
    details.textContent = [saved.http && 'HTTP ' + saved.http, saved.disposition, ...(saved.errorCodes || []),
      ...(saved.warningCodes || [])].filter(Boolean).join(' · ');
  } catch (error) {
    saved = undefined;
    status.textContent = 'تعذر إكمال الطلب. حدّث الحالة لمراجعة النتيجة.';
    details.textContent = /^QA_[A-Z_]+$/.test(error.message) ? error.message : 'QA_REQUEST_FAILED';
  } finally {
    busy = false;
    controls();
  }
}

refresh.addEventListener('click', () => void request('reportingStatus'));
prepare.addEventListener('click', () => void request('reportingPrepare'));
submit.addEventListener('click', () => void request('reportingSubmit'));
fetch('/source.json', { cache: 'no-store', redirect: 'error' }).then(response => response.json()).then(source => {
  if (/^[a-f0-9]{40}$/.test(source.sourceSha)) document.getElementById('version').textContent = source.sourceSha.slice(0, 8);
}).catch(() => {});
void request('reportingStatus');
