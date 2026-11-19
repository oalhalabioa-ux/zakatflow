'use strict';
(() => {
  const byId = id => document.getElementById(id);
  let current = null, busy = false;
  const messages = {
    NOT_PREPARED: 'راجع بيانات الوحدة ثم اضغط «تأكيد البيانات وتجهيز الطلب». لا تولّد رمز زاتكا بعد.',
    READY_FOR_OTP: 'تم حفظ طلب الشهادة المشفّر والتحقق من مفتاح التوقيع. يمكنك الآن إنشاء رمز واحد من منصة المحاكاة وإدخاله أدناه.',
    RESPONSE_QUARANTINED: 'استُلمت استجابة الشهادة وحُفظت مشفّرة. لم يُفعّل إصدار الفواتير؛ يلزم استكمال التحقق واختبارات الامتثال.',
    RECONCILIATION_REQUIRED: 'هناك محاولة محفوظة تحتاج مراجعة نتيجتها. لا تولّد رمزًا جديدًا ولا تُعد الإرسال. تحديث الحالة يقرأ النتيجة فقط.',
  };
  const errors = {
    QA_CONFIGURATION_INVALID: 'إعدادات وحدة المحاكاة غير مكتملة. لا تولّد رمزًا بعد.',
    QA_IDENTITY_REQUIRED: 'تعذر التحقق من جاهزية بيئة الاختبار. لا تولّد رمزًا بعد، وأبلغ مسؤول الاختبار.',
    QA_PRIVATE_STORAGE_UNAVAILABLE: 'تعذر الوصول إلى التخزين المشفّر. لا تولّد رمزًا بعد، وأبلغ مسؤول الاختبار.',
    QA_STORAGE_FENCE_UNVERIFIED: 'لم يكتمل التحقق من منع تكرار الإرسال. لا تولّد رمزًا بعد، وأبلغ مسؤول الاختبار.',
    QA_SIGNING_KEY_UNAVAILABLE: 'تعذر استخدام مفتاح التوقيع. لا تولّد رمزًا بعد، وأبلغ مسؤول الاختبار.',
    QA_ORIGINAL_CHANGED: 'بيانات الطلب المحفوظ تختلف عن البيانات الحالية. يلزم مراجعتها قبل المتابعة.',
    QA_RECONCILIATION_REQUIRED: messages.RECONCILIATION_REQUIRED,
    SAME_ORIGIN_REQUIRED: 'افتح الصفحة من رابط الاختبار الأصلي ثم حدّث الحالة.',
    QA_HOST_REQUIRED: 'افتح الصفحة من رابط زاتكا للاختبار فقط.',
    QA_INPUT_INVALID: 'أدخل رمزًا مكوّنًا من 6 أرقام إنجليزية.',
    QA_STANDARD_CONTEXT_UNAVAILABLE: 'تعذر تأكيد بيانات فحوص المحاكاة. لا تُعد الإرسال؛ حدّث الحالة للمراجعة.',
    QA_STANDARD_ORIGINAL_CHANGED: 'تختلف العينة عن الأصل المحفوظ. يلزم مراجعتها دون إعادة الإرسال.',
    QA_STANDARD_RECONCILIATION_REQUIRED: 'هناك فحص محفوظ يحتاج قراءة نتيجته. حدّث الحالة فقط ولا تُعد الإرسال.',
    QA_STANDARD_PREVIOUS_REQUIRED: 'يجب نجاح الفحص السابق أولًا.',
  };
  function controls() {
    byId('prepare').disabled = busy || current?.state !== 'NOT_PREPARED';
    byId('submit').disabled = busy || current?.state !== 'READY_FOR_OTP';
    byId('refresh').disabled = busy;
    byId('otpSection').hidden = current?.state !== 'READY_FOR_OTP';
    const standard = current?.standardCompliance;
    byId('standardSection').hidden = current?.state !== 'RESPONSE_QUARANTINED' || !standard;
    byId('standardPrepare').disabled = busy || standard?.state !== 'NOT_PREPARED';
    for (let i = 0; i < 3; i++) byId('standardSubmit' + i).disabled = busy || !standard?.manifestDigest
      || standard.results?.[i]?.state !== 'NOT_SENT' || standard.results.slice(0, i).some(r => r.state !== 'PASSED');
    const simplified = current?.simplifiedExperiment;
    byId('simplifiedSection').hidden = current?.state !== 'RESPONSE_QUARANTINED' || !simplified;
    byId('simplifiedPrepare').disabled = busy || standard?.passed !== true || simplified?.state !== 'NOT_PREPARED';
    for (let i = 0; i < 3; i++) byId('simplifiedSubmit' + i).disabled = busy || standard?.passed !== true || !simplified?.manifestDigest
      || simplified.results?.[i]?.state !== 'NOT_SENT' || simplified.results.slice(0, i).some(r => r.state !== 'PASSED');
  }
  function render(value) {
    if (!value.state && (value.standardCompliance || value.simplifiedExperiment)) value = { ...current, ...value };
    current = value;
    const company = value.company;
    if (company) {
      for (const key of ['legalName','vatNumber','branchName','branchLocation','industry','unitName','email']) byId(key).textContent = company[key];
      byId('company').hidden = false;
    }
    byId('status').textContent = messages[value.state] || 'تعذر تحديد حالة الطلب. أبلغ مسؤول الاختبار.';
    byId('status').dataset.state = value.state;
    if (value.state === 'RESPONSE_QUARANTINED' && value.identityMatched === false)
      byId('status').textContent += ' لم يُثبت تطابق هوية الشهادة مع الطلب، وتحتاج النتيجة إلى مراجعة.';
    byId('version').textContent = 'نسخة الاختبار: ' + String(value.sourceSha || '').slice(0, 8);
    const labels = { PASSED: 'نجح فحص الامتثال دون أخطاء أو تحذيرات.', FAILED: 'لم ينجح الفحص. يلزم مراجعة النتيجة المحفوظة.',
      RECONCILIATION_REQUIRED: 'نتيجة غير مؤكدة؛ لا تُعد الإرسال.', NOT_SENT: 'لم يُرسل بعد.' };
    for (let i = 0; i < 3; i++) {
      const result = value.standardCompliance?.results?.[i];
      byId('standardResult' + i).textContent = result ? (labels[result.state] || 'تعذر تأكيد النتيجة.')
        + (result.errorCodes?.length ? ' ' + result.errorCodes.join('، ') : '')
        + (result.warningCodes?.length ? ' ' + result.warningCodes.join('، ') : '') : '';
    }
    for (let i = 0; i < 3; i++) {
      const result = value.simplifiedExperiment?.results?.[i];
      byId('simplifiedResult' + i).textContent = result ? (labels[result.state] || 'تعذر تأكيد النتيجة.')
        + (result.errorCodes?.length ? ' ' + result.errorCodes.join('، ') : '')
        + (result.warningCodes?.length ? ' ' + result.warningCodes.join('، ') : '') : '';
    }
    controls();
  }
  async function call(body) {
    if (busy) return;
    busy = true; controls();
    try {
      const response = await fetch('/api/simulation', body ? { method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin', cache: 'no-store' });
      const value = await response.json();
      if (!response.ok) {
        if (body?.action === 'submit') current = { ...current, state: 'RECONCILIATION_REQUIRED' };
        throw new Error(errors[value.error] || 'لم تكتمل العملية. حدّث الحالة وأرسل الرسالة لمسؤول الاختبار.');
      }
      render(value);
    } catch (error) {
      if (body?.action === 'submit') current = { ...current, state: 'RECONCILIATION_REQUIRED' };
      else if (body?.action?.startsWith('standard')) current = { ...current, standardCompliance: { state: 'BLOCKED' } };
      else if (body?.action?.startsWith('simplified')) current = { ...current, simplifiedExperiment: { state: 'BLOCKED' } };
      else current = { ...current, state: 'ERROR' };
      byId('status').textContent = error instanceof Error ? error.message : 'تعذر إكمال العملية. حدّث الحالة.';
      byId('status').dataset.state = 'ERROR';
    } finally { busy = false; controls(); }
  }
  byId('prepare').addEventListener('click', () => void call({ action: 'prepare' }));
  byId('refresh').addEventListener('click', () => void call());
  byId('standardPrepare').addEventListener('click', () => void call({ action: 'standardPrepare' }));
  byId('simplifiedPrepare').addEventListener('click', () => {
    if (busy || byId('simplifiedPrepare').disabled) return;
    void call({ action: 'simplifiedPrepare' });
  });
  for (let i = 0; i < 3; i++) byId('simplifiedSubmit' + i).addEventListener('click', () => {
    if (busy || byId('simplifiedSubmit' + i).disabled) return;
    void call({ action: 'simplifiedSubmit', index: i, manifestDigest: current.simplifiedExperiment.manifestDigest });
  });
  for (let i = 0; i < 3; i++) byId('standardSubmit' + i).addEventListener('click', () => {
    if (busy || byId('standardSubmit' + i).disabled) return;
    void call({ action: 'standardSubmit', index: i, manifestDigest: current.standardCompliance.manifestDigest });
  });
  byId('otpForm').addEventListener('submit', event => {
    event.preventDefault();
    if (busy || current?.state !== 'READY_FOR_OTP') return;
    const otp = byId('otp').value;
    byId('otp').value = '';
    void call({ action: 'submit', otp, csrSha256: current.csrSha256 });
  });
  window.addEventListener('pagehide', () => { byId('otp').value = ''; });
  void call();
})();
