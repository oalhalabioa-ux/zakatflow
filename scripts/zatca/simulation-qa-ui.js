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
  };
  function controls() {
    byId('prepare').disabled = busy || current?.state !== 'NOT_PREPARED';
    byId('submit').disabled = busy || current?.state !== 'READY_FOR_OTP';
    byId('refresh').disabled = busy;
    byId('otpSection').hidden = current?.state !== 'READY_FOR_OTP';
  }
  function render(value) {
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
      else current = { ...current, state: 'ERROR' };
      byId('status').textContent = error instanceof Error ? error.message : 'تعذر إكمال العملية. حدّث الحالة.';
      byId('status').dataset.state = 'ERROR';
    } finally { busy = false; controls(); }
  }
  byId('prepare').addEventListener('click', () => void call({ action: 'prepare' }));
  byId('refresh').addEventListener('click', () => void call());
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
