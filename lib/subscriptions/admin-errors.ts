/** User-facing messages never expose validator JSON, SQL details, or UUID patterns. */
export function adminSubscriptionError(code: string, ar: boolean) {
  const messages: Record<string, [string, string]> = {
    INVALID_INPUT: [
      "تحقق من الحقول المطلوبة واختر باقة صالحة قبل الحفظ.",
      "Check required fields and select a valid plan before saving.",
    ],
    PLAN_REQUIRED: [
      "اختر باقة مفعلة وحدد تاريخ انتهاء الاشتراك.",
      "Select an active plan and a subscription end date.",
    ],
    PLAN_QUOTE_CONFLICT: [
      "تغيرت الباقة بعد إرسال الطلب. اطلب من العميل إرسال طلب جديد بالسعر الحالي.",
      "The plan changed after submission. Ask the customer to submit a new request at the current price.",
    ],
    SUBSCRIPTION_CONFLICT: [
      "تغير الاشتراك. حدّث بيانات المؤسسة ثم أعد المحاولة.",
      "The subscription changed. Refresh the organization and retry.",
    ],
    REQUEST_CONFLICT: [
      "تغير الطلب أو تمت معالجته. حدّث القائمة قبل إعادة المحاولة.",
      "The request changed or was already processed. Refresh before retrying.",
    ],
    PLAN_CONFLICT: [
      "تغيرت الباقة. حدّث القائمة قبل حفظ تعديل جديد.",
      "The plan changed. Refresh before saving again.",
    ],
    SUBSCRIPTION_USER_LIMIT: [
      "حد المستخدمين أقل من الأعضاء النشطين. راجع الباقة والمقاعد.",
      "The seat limit is below the active member count. Review the plan and seats.",
    ],
    PLATFORM_OWNER_REQUIRED: [
      "هذا الإجراء متاح لمالك المنصة فقط.",
      "Only the platform owner can perform this action.",
    ],
    UNAUTHORIZED: [
      "انتهت الجلسة. سجّل الدخول ثم أعد المحاولة.",
      "Your session ended. Sign in and retry.",
    ],
  };
  return (
    messages[code]?.[ar ? 0 : 1] ??
    (ar
      ? "تعذر إتمام الإجراء. راجع البيانات والصلاحيات ثم أعد المحاولة."
      : "Unable to complete the action. Check details and permissions, then retry.")
  );
}
