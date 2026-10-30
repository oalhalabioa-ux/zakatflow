export const authCopy = {
 ar: {
  title:'إعادة تعيين كلمة المرور', intro:'اختر كلمة مرور جديدة لحسابك.', checking:'جارٍ التحقق من رابط الاستعادة…', openLink:'افتح هذه الصفحة من رابط الاستعادة في بريدك.',
  invalidLink:'رابط الاستعادة غير صالح أو انتهت صلاحيته. اطلب رابطاً جديداً.', verifyFailed:'تعذر التحقق من رابط الاستعادة. حاول مرة أخرى.',
  password:'كلمة المرور الجديدة', confirm:'تأكيد كلمة المرور', update:'تحديث كلمة المرور', updating:'جارٍ التحديث…',
  shortPassword:'يجب أن تتكون كلمة المرور من 8 أحرف على الأقل.', mismatch:'كلمتا المرور غير متطابقتين.', updateFailed:'تعذر تحديث كلمة المرور. اطلب رابط استعادة جديداً.', updated:'تم تحديث كلمة المرور. يمكنك تسجيل الدخول الآن.', back:'العودة إلى تسجيل الدخول',
  invalidCredentials:'البريد أو كلمة المرور غير صحيحة. إذا لم تعيّن كلمة مرور من قبل، استخدم «نسيت كلمة المرور».', confirmEmail:'أكد بريدك الإلكتروني أولاً.', rateLimit:'طلبات كثيرة مؤخراً. انتظر قليلاً ثم أعد المحاولة.', requestFailed:'تعذر إكمال العملية. تحقق من الاتصال ثم حاول مرة أخرى.',
  authError:'تعذر إكمال الدخول. ابدأ محاولة جديدة من هذه الصفحة.', recoveryOrigin:'هذا الرابط صدر من عنوان دخول سابق. اطلب رابط استعادة جديداً من هذه الصفحة.', inviteSeats:'اكتمل عدد المستخدمين المسموح به للمؤسسة. تواصل مع مسؤولها لتوفير مقعد ثم أعد فتح الدعوة.',inviteReadonly:'اشتراك المؤسسة لا يسمح بإضافة مستخدمين حالياً. تواصل مع مسؤول المؤسسة.',inviteError:'تعذر قبول الدعوة. راجع البريد وصلاحية الرابط.',
 },
 en: {
  title:'Reset password', intro:'Choose a new password for your account.', checking:'Checking recovery link…', openLink:'Open this page from the recovery link in your email.',
  invalidLink:'The recovery link is invalid or expired. Request a new link.', verifyFailed:'Unable to verify the recovery link. Please try again.',
  password:'New password', confirm:'Confirm password', update:'Update password', updating:'Updating…',
  shortPassword:'Password must be at least 8 characters.', mismatch:'Passwords do not match.', updateFailed:'Unable to update your password. Request a new recovery link.', updated:'Password updated. You can now sign in.', back:'Back to sign in',
  invalidCredentials:'Email or password is incorrect. If you have never set a password, use “Forgot password?”.', confirmEmail:'Confirm your email address first.', rateLimit:'Too many requests. Please wait and try again.', requestFailed:'Unable to complete the request. Check your connection and try again.',
  authError:'Unable to complete sign-in. Start a new attempt from this page.', recoveryOrigin:'This link was issued for a previous sign-in address. Request a new recovery link here.', inviteSeats:'The organization has no available user seats. Ask its administrator to free a seat, then reopen your invitation.',inviteReadonly:'The organization subscription currently does not allow adding users. Contact its administrator.',inviteError:'Unable to accept the invitation. Check the email and link validity.',
 },
} as const;
export function friendlyAuthError(message: string, locale: string) {
 const copy=authCopy[locale==='en'?'en':'ar'], text=message.toLowerCase();
 if(text.includes('invalid login credentials'))return copy.invalidCredentials;
 if(text.includes('email not confirmed'))return copy.confirmEmail;
 if(text.includes('rate limit')||text.includes('too many'))return copy.rateLimit;
 return copy.requestFailed;
}
