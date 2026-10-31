import { ownerLocale } from "@/lib/i18n/owner-server";
import { ownerTranslator, ownerHref } from "@/lib/i18n/owner";
import OwnerSidebar from "../OwnerSidebar";
import OwnerNavigation from "../OwnerNavigation";
import OwnerMetrics from "../OwnerMetrics";
import OwnerRefresh from "../OwnerRefresh";
import {
  adminCount,
  adminNumber,
  adminPercent,
  organizationDistribution,
} from "@/lib/admin/metrics";
import type { CSSProperties } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "../../../lib/supabase/server";
import "../owner.css";
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return {
    title: ownerTranslator(await ownerLocale())(
      "تحليلات المنصة | يقين الأعمال",
    ),
  };
}
export default async function OwnerAnalytics() {
  const locale = await ownerLocale();
  const ar = locale === "ar";
  const t = (a: string, e: string) => (ar ? a : e);
  const db = await supabaseServer();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user)
    redirect(`/${locale}/login?next=%2Fadmin%2Fanalytics%3Flang%3D${locale}`);
  const { data: owner, error: roleError } = await db
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .eq("role", "platform_owner")
    .maybeSingle();
  if (roleError || !owner)
    return (
      <main className="owner-denied" dir={ar ? "rtl" : "ltr"}>
        <h1>{t("الوصول غير مسموح", "Access denied")}</h1>
        <Link href={ownerHref("/admin", locale)}>
          {t("العودة إلى لوحة المالك", "Back to owner dashboard")}
        </Link>
      </main>
    );
  const [users, panel, register, requests, plans] = await Promise.all([
    db.rpc("owner_user_count"),
    db.rpc("owner_subscription_panel", { p_organization_id: null }),
    db.rpc("owner_trial_register", { p_search: "", p_status: "", p_offset: 0 }),
    db.rpc("owner_activation_requests", {
      p_search: "",
      p_status: "",
      p_offset: 0,
    }),
    db.rpc("owner_subscription_summary"),
  ]);
  const distribution = organizationDistribution(
    panel.error ? null : panel.data,
  );
  const summary = plans.error
    ? null
    : Array.isArray(plans.data)
      ? plans.data[0]
      : plans.data;
  const total = distribution?.total ?? null,
    active = distribution?.active ?? null;
  const share = adminPercent(active, total);
  const pending = requests.error
    ? null
    : adminCount(requests.data?.pending_count);
  const ending = register.error
    ? null
    : adminCount(register.data?.metrics?.ending_7);
  const unavailable = t("تعذر قراءة المؤشر", "Metric unavailable");
  const number = (value: number | null) =>
    value === null ? "—" : adminNumber(value, locale);
  const segments = distribution
    ? [
        {
          label: t("اشتراك فعّال", "Active subscription"),
          value: distribution.active,
          color: "var(--owner-success-ink)",
        },
        {
          label: t("تجربة نشطة", "Active trial"),
          value: distribution.trialing,
          color: "var(--owner-primary)",
        },
        {
          label: t("منتهٍ", "Expired"),
          value: distribution.expired,
          color: "var(--owner-accent)",
        },
        {
          label: t(
            "وصول محفوظ / حالات أخرى",
            "Preserved access / other states",
          ),
          value: distribution.other,
          color: "var(--owner-muted)",
        },
      ]
    : [];
  const snapshot = register.error ? null : register.data?.server_now;
  const timestamp =
    typeof snapshot === "string" && !Number.isNaN(Date.parse(snapshot))
      ? new Intl.DateTimeFormat(ar ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "UTC",
        }).format(new Date(snapshot))
      : null;
  return (
    <main className="owner-shell" dir={ar ? "rtl" : "ltr"}>
      <OwnerSidebar locale={locale} />
      <section className="owner-content">
        <OwnerNavigation locale={locale} />
        <header className="owner-top">
          <div>
            <h1>{t("تحليلات المنصة", "Platform analytics")}</h1>
            <p>
              {t(
                "نظرة تشغيلية على المؤسسات والاشتراكات وطلبات التفعيل.",
                "An operational view of organizations, subscriptions and activation requests.",
              )}
            </p>
          </div>
          <div className="owner-top-actions">
            <OwnerRefresh locale={locale} />
          </div>
        </header>
        <OwnerMetrics
          locale={locale}
          items={[
            {
              label: t("إجمالي المؤسسات", "Total organizations"),
              value: total,
              icon: "building",
              note:
                total === null
                  ? unavailable
                  : t("جميع المؤسسات المسجلة", "All registered organizations"),
            },
            {
              label: t("إجمالي المستخدمين", "Total users"),
              value: users.error ? null : adminCount(users.data),
              icon: "users",
              note: t(
                "الحسابات المسجلة في المنصة",
                "Registered platform accounts",
              ),
            },
            {
              label: t("اشتراكات فعّالة", "Active subscriptions"),
              value: active,
              icon: "card",
              tone: "success",
              note: t(
                "حسب حالة الاشتراك الحالية",
                "Based on current subscription status",
              ),
            },
            {
              label: t("تجارب نشطة", "Active trials"),
              value: distribution?.trialing ?? null,
              icon: "trial",
              note: t("التجارب السارية حالياً", "Trials currently in progress"),
            },
          ]}
        />
        <div className="owner-analytics-grid">
          <article className="owner-analysis-card">
            <h2>
              {t("توزيع حالات المؤسسات", "Organization status distribution")}
            </h2>
            <p>
              {t(
                "الحالة الفعلية الحالية، وليست عدد سجلات الاشتراكات التاريخية.",
                "Current effective status, rather than historical subscription records.",
              )}
            </p>
            {distribution && distribution.total > 0 ? (
              <div className="owner-distribution">
                <div className="owner-donut">
                  <svg
                    viewBox="0 0 120 120"
                    role="img"
                    aria-label={t(
                      "توزيع حالات المؤسسات، التفاصيل في القائمة المجاورة",
                      "Organization status distribution; values in the adjacent legend",
                    )}
                  >
                    <circle
                      cx="60"
                      cy="60"
                      r="47"
                      fill="none"
                      stroke="var(--owner-soft)"
                      strokeWidth="12"
                    />
                    {segments.map((segment, index) => {
                      const size = (segment.value / distribution.total) * 100;
                      const offset =
                        (segments
                          .slice(0, index)
                          .reduce((sum, item) => sum + item.value, 0) /
                          distribution.total) *
                        100;
                      return size > 0 ? (
                        <circle
                          key={segment.label}
                          cx="60"
                          cy="60"
                          r="47"
                          pathLength="100"
                          fill="none"
                          stroke={segment.color}
                          strokeWidth="12"
                          strokeDasharray={`${size} ${100 - size}`}
                          strokeDashoffset={-offset}
                        />
                      ) : null;
                    })}
                  </svg>
                  <div className="owner-donut-value">
                    <strong>
                      <bdi>{number(total)}</bdi>
                    </strong>
                    <span>{t("مؤسسة", "organizations")}</span>
                  </div>
                </div>
                <ul className="owner-distribution-key">
                  {segments.map((segment) => (
                    <li
                      key={segment.label}
                      style={
                        { "--segment-color": segment.color } as CSSProperties
                      }
                    >
                      <i aria-hidden="true" />
                      <span>{segment.label}</span>
                      <bdi>
                        <strong>{number(segment.value)}</strong>
                        <small>
                          {number(adminPercent(segment.value, total))}%
                        </small>
                      </bdi>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="owner-data-empty">
                {distribution
                  ? t(
                      "لا توجد مؤسسات لعرض توزيعها بعد.",
                      "No organizations to display yet.",
                    )
                  : t(
                      "تعذر تحميل توزيع الحالات. أعد تحديث البيانات.",
                      "Unable to load the distribution. Refresh to retry.",
                    )}
              </div>
            )}
          </article>
          <article className="owner-analysis-card">
            <h2>{t("تحتاج إلى متابعة", "Needs attention")}</h2>
            <p>
              {t(
                "مؤشرات عامة مع انتقال مباشر إلى السجلات المعنية.",
                "Platform-wide counts with direct links to the relevant records.",
              )}
            </p>
            <div className="owner-task-list">
              <Link
                href={ownerHref("/admin/subscriptions?tab=requests", locale)}
              >
                <span>
                  {t("طلبات تفعيل مفتوحة", "Open activation requests")}
                </span>
                <strong>
                  <bdi>{number(pending)}</bdi>
                </strong>
              </Link>
              <Link
                href={ownerHref(
                  "/admin/subscriptions?tab=institutions&org_status=trialing",
                  locale,
                )}
              >
                <span>
                  {t("تجارب تنتهي خلال 7 أيام", "Trials ending within 7 days")}
                </span>
                <strong>
                  <bdi>{number(ending)}</bdi>
                </strong>
              </Link>
              <Link
                href={ownerHref(
                  "/admin/subscriptions?tab=institutions&org_status=expired",
                  locale,
                )}
              >
                <span>
                  {t(
                    "مؤسسات باشتراك منتهٍ",
                    "Organizations with expired access",
                  )}
                </span>
                <strong>
                  <bdi>{number(distribution?.expired ?? null)}</bdi>
                </strong>
              </Link>
            </div>
          </article>
          <article className="owner-analysis-card">
            <h2>{t("حصة الاشتراكات الفعّالة", "Active subscription share")}</h2>
            <p>
              {t(
                "المؤسسات ذات الاشتراك الفعّال من إجمالي المؤسسات المسجلة.",
                "Organizations with an active subscription out of all registered organizations.",
              )}
            </p>
            <strong className="owner-analysis-value">
              <bdi>{share === null ? "—" : number(share) + "%"}</bdi>
            </strong>
            {share !== null && (
              <div
                className="owner-progress"
                role="progressbar"
                aria-label={t(
                  "حصة الاشتراكات الفعالة",
                  "Active subscription share",
                )}
                aria-valuenow={share}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <span style={{ width: share + "%" }} />
              </div>
            )}
            <p>
              {number(active)} / {number(total)} {t("مؤسسة", "organizations")}
            </p>
          </article>
          <article className="owner-analysis-card">
            <h2>{t("جاهزية دليل الباقات", "Plan catalog availability")}</h2>
            <p>
              {t(
                "الباقات المفعّلة من إجمالي الدليل الإداري، بما فيه باقة التجربة والباقات الخاصة.",
                "Enabled plans out of the administrative catalog, including trial and private plans.",
              )}
            </p>
            <strong className="owner-analysis-value">
              <bdi>
                {number(adminCount(summary?.active_plans))} /{" "}
                {number(adminCount(summary?.plans))}
              </bdi>
            </strong>
            <Link
              className="owner-action"
              href={ownerHref("/admin/subscriptions?tab=plans", locale)}
            >
              {t("إدارة الباقات والمميزات", "Manage plans and features")}
            </Link>
          </article>
        </div>
        <div className="owner-analytics-footnote">
          <span>
            {t(
              "تعرض هذه الصفحة بيانات البيئة المتصلة. لا تُقدّر إيرادات أو اتجاهات نمو دون مصدر دفع وسجل زمني موثوق.",
              "This page shows data from the connected environment. Revenue and growth are not estimated without verified payment and historical records.",
            )}
          </span>
          {timestamp && (
            <time dateTime={snapshot}>
              <bdi>{timestamp} UTC</bdi>
            </time>
          )}
        </div>
      </section>
    </main>
  );
}
