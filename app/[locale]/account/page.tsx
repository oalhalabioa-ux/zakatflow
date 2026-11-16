"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import "@/components/settings/settings.css";
type Profile = {
  name: string | null;
  phone: string | null;
  base_currency: string;
  locale: string;
  calendar_type: string;
  nisab_standard: string;
  timezone: string;
};
type Preferences = { allocation_method: string };
export default function AccountPage() {
  const params = useParams(),
    locale = String(params.locale || "ar"),
    ar = locale === "ar",
    router = useRouter();
  const [currencies, setCurrencies] = useState<string[]>([]),
    [email, setEmail] = useState(""),
    [profile, setProfile] = useState<Profile | null>(null),
    [preferences, setPreferences] = useState<Preferences | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  async function load() {
    setLoading(true);
    setError("");
    try {
      const s = supabaseBrowser(),
        [a, r] = await Promise.all([
          s.auth.getUser(),
          fetch("/api/settings", { cache: "no-store" }),
        ]);
      if (!a.data.user || r.status === 401) {
        router.replace(`/${locale}/login`);
        return;
      }
      if (a.error || !r.ok) throw Error();
      const data = await r.json();
      setEmail(a.data.user.email ?? "");
      setProfile(data.profile);
      setPreferences({ allocation_method: data.settings.allocation_method });
      const c = await fetch("/api/currencies", { cache: "no-store" });
      if (c.ok)
        setCurrencies((await c.json()).map((x: { code: string }) => x.code));
    } catch {
      setError(
        ar
          ? "تعذر تحميل الحساب. أعد المحاولة."
          : "Unable to load your account. Please retry.",
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [locale]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || !profile || !preferences) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: {
            ...profile,
            name: profile.name?.trim(),
            phone: profile.phone?.trim(),
          },
          settings: preferences,
        }),
      });
      if (!r.ok) throw Error();
      const data = await r.json();
      setProfile(data.profile);
      setPreferences({ allocation_method: data.settings.allocation_method });
      setMessage(
        ar ? "تم حفظ تفضيلات حسابك." : "Your account preferences were saved.",
      );
      if (profile.locale !== locale) router.push(`/${profile.locale}/account`);
    } catch {
      setError(
        ar
          ? "تعذر حفظ التغييرات. حاول مرة أخرى."
          : "Unable to save changes. Please retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    setError("");
    try {
      const { error } = await supabaseBrowser().auth.signOut();
      if (error) throw error;
      router.replace(`/${locale}/login`);
      router.refresh();
    } catch {
      setError(
        ar
          ? "تعذر تسجيل الخروج. حاول مرة أخرى."
          : "Unable to sign out. Please retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="account-workspace" dir={ar ? "rtl" : "ltr"}>
      <header className="settings-heading">
        <h1>{ar ? "حسابي" : "My account"}</h1>
        <p>
          {ar
            ? "بياناتك الشخصية وتفضيلاتك في يقين الأعمال."
            : "Your personal details and preferences in Yaqeen Business."}
        </p>
      </header>
      {loading ? (
        <p role="status">
          {ar ? "جارٍ تحميل الحساب…" : "Loading your account…"}
        </p>
      ) : profile && preferences ? (
        <>
          <section className="settings-card account-summary">
            <span className="account-initial" aria-hidden="true">
              {profile.name?.trim().charAt(0) || "YB"}
            </span>
            <div>
              <h2>{profile.name || email}</h2>
              <span dir="ltr">{email}</span>
              <p className="settings-hint">
                {ar
                  ? "تفضيلات الحساب تخصك؛ بيانات المؤسسات واشتراكاتها تُدار من الإعدادات."
                  : "Account preferences are personal; organization details and subscriptions are managed in Settings."}
              </p>
            </div>
          </section>
          <section className="settings-card">
            <h2>
              {ar
                ? "البيانات والتفضيلات الشخصية"
                : "Personal details & preferences"}
            </h2>
            <form className="settings-form" onSubmit={save}>
              <label>
                {ar ? "الاسم" : "Name"}
                <input
                  autoComplete="name"
                  required
                  maxLength={120}
                  value={profile.name ?? ""}
                  disabled={busy}
                  onChange={(e) =>
                    setProfile({ ...profile, name: e.target.value })
                  }
                />
              </label>
              <label>
                {ar ? "الجوال" : "Phone"}
                <input
                  type="tel"
                  autoComplete="tel"
                  maxLength={30}
                  value={profile.phone ?? ""}
                  disabled={busy}
                  onChange={(e) =>
                    setProfile({ ...profile, phone: e.target.value })
                  }
                />
              </label>
              <label>
                {ar ? "البريد الإلكتروني" : "Email"}
                <input type="email" value={email} readOnly dir="ltr" />
                <small>
                  {ar
                    ? "مرتبط بطريقة تسجيل الدخول الحالية."
                    : "Linked to your current sign-in method."}
                </small>
              </label>
              <label>
                {ar ? "لغة الواجهة" : "Interface language"}
                <select
                  aria-label={ar?'لغة الواجهة':'Interface language'}
                  value={profile.locale}
                  disabled={busy}
                  onChange={(e) =>
                    setProfile({ ...profile, locale: e.target.value })
                  }
                >
                  <option value="ar">العربية</option>
                  <option value="en">English</option>
                </select>
              </label>
              <label>
                {ar
                  ? "العملة الأساسية لحسابك الشخصي"
                  : "Personal base currency"}
                <select
                  aria-label={ar?'العملة الأساسية لحسابك الشخصي':'Personal base currency'}
                  value={profile.base_currency}
                  disabled={busy}
                  onChange={(e) =>
                    setProfile({ ...profile, base_currency: e.target.value })
                  }
                >
                  {[...new Set([profile.base_currency, ...currencies])].map(
                    (c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                {ar ? "التقويم" : "Calendar"}
                <select
                  aria-label={ar?'التقويم':'Calendar'}
                  value={profile.calendar_type}
                  disabled={busy}
                  onChange={(e) =>
                    setProfile({ ...profile, calendar_type: e.target.value })
                  }
                >
                  <option value="GREGORIAN">
                    {ar ? "ميلادي" : "Gregorian"}
                  </option>
                  <option value="HIJRI">{ar ? "هجري" : "Hijri"}</option>
                </select>
              </label>
              <label>
                {ar ? "المنطقة الزمنية" : "Time zone"}
                <select
                  aria-label={ar?'المنطقة الزمنية':'Time zone'}
                  value={profile.timezone || "UTC"}
                  disabled={busy}
                  onChange={(e) =>
                    setProfile({ ...profile, timezone: e.target.value })
                  }
                >
                  {[
                    ...new Set([
                      profile.timezone || "UTC",
                      "UTC",
                      "Asia/Riyadh",
                      "Asia/Dubai",
                      "Asia/Beirut",
                      "Asia/Damascus",
                    ]),
                  ].map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {ar ? "معيار نصاب الزكاة" : "Zakat nisab standard"}
                <select
                  aria-label={ar?'معيار نصاب الزكاة':'Zakat nisab standard'}
                  value={profile.nisab_standard}
                  disabled={busy}
                  onChange={(e) =>
                    setProfile({ ...profile, nisab_standard: e.target.value })
                  }
                >
                  <option value="SILVER">{ar ? "الفضة" : "Silver"}</option>
                  <option value="GOLD">{ar ? "الذهب" : "Gold"}</option>
                </select>
              </label>
              <label>
                {ar ? "طريقة تخصيص العمليات" : "Allocation method"}
                <select
                  aria-label={ar?'طريقة تخصيص العمليات':'Allocation method'}
                  value={preferences.allocation_method}
                  disabled={busy}
                  onChange={(e) =>
                    setPreferences({ allocation_method: e.target.value })
                  }
                >
                  {[
                    ["FIFO", ar ? "الأقدم أولاً" : "First in, first out"],
                    ["MANUAL", ar ? "يدوي" : "Manual"],
                    ["PROPORTIONAL", ar ? "نسبي" : "Proportional"],
                    ["RULE_BASED", ar ? "بحسب القواعد" : "Rule based"],
                  ].map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <div className="account-actions">
                <button
                  className="btn"
                  disabled={busy || !profile.name?.trim()}
                >
                  {busy
                    ? ar
                      ? "جارٍ الحفظ…"
                      : "Saving…"
                    : ar
                      ? "حفظ التغييرات"
                      : "Save changes"}
                </button>

              </div>
            </form>
          </section>
          <section className="settings-card">
            <h2>{ar ? "خصوصية الحساب" : "Account privacy"}</h2>
            <p>
              {ar
                ? "تُطبق صلاحيات عضويتك على كل مؤسسة بصورة مستقلة. تغيير تفضيلاتك الشخصية لا يغير باقات المؤسسات أو صلاحيات أعضائها."
                : "Your membership permissions apply independently to each organization. Personal preferences do not change organization plans or member permissions."}
            </p>
          </section>
        </>
      ) : (
        <button className="btn" onClick={() => void load()}>
          {ar ? "إعادة المحاولة" : "Retry"}
        </button>
      )}
      <button className="btn" type="button" disabled={busy} onClick={logout}>
        {ar ? "تسجيل الخروج" : "Sign out"}
      </button>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </main>
  );
}
