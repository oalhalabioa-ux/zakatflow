"use client";
import { useOwnerRegisterQuery } from "./useOwnerRegisterQuery";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { money, type Plan } from "@/lib/subscriptions/catalog";
import {
  displaySubscriptionDate,
  subscriptionLabel,
  type OrganizationSubscription,
} from "@/lib/subscriptions/model";
import { adminSubscriptionError } from "@/lib/subscriptions/admin-errors";
import SubscriptionModal from "./SubscriptionModal";
import {
  ConsoleIcon,
  OwnerActionIcon,
  OwnerStatusBadge,
  shortSubscriptionLabel,
  showOwnerDetail,
} from "./OwnerSubscriptionVisuals";
type Row = {
  id: string;
  name: string;
  owner_email: string;
  active_users: number;
  entitlement: OrganizationSubscription;
};
type Member = {
  user_id: string;
  name: string;
  email: string;
  role: string;
  status: string;
};
type Audit = {
  event_type: string;
  created_at: string;
  actor_user_id: string;
  details: { reason?: string };
};
type Register = {
  rows: Row[];
  metrics: Record<string, number>;
  settings: { trial_days: number; revision: number };
  plans?: Plan[];
};
function defaultAction(row: Row) {
  return row.entitlement.status === "suspended"
    ? "resume"
    : row.entitlement.trial_started_at &&
        ["trialing", "expired"].includes(row.entitlement.status)
      ? "extend"
      : "activate";
}
export default function TrialAdmin({
  locale,
  plans,
  onChanged,
}: {
  locale: string;
  plans: Plan[];
  onChanged?: () => Promise<void>;
}) {
  const ar = locale === "ar";
  const { search, status, offset, setSearch, setStatus, setOffset } =
    useOwnerRegisterQuery("org");
  const [register, setRegister] = useState<Register | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<Row | null>(null),
    [members, setMembers] = useState<Member[]>([]),
    [audit, setAudit] = useState<Audit[] | null>(null),
    [detailTab, setDetailTab] = useState("subscription"),
    [message, setMessage] = useState(""),
    [action, setAction] = useState("activate"),
    [editing, setEditing] = useState(false),
    [defaultsOpen, setDefaultsOpen] = useState(false),
    [inlineActivation, setInlineActivation] = useState(false);
  const generation = useRef(0),
    auditGeneration = useRef(0),
    selection = useRef<Row | null>(null);
  const selectOrganization = useCallback((row: Row | null) => {
    selection.current = row;
    auditGeneration.current++;
    setSelected(row);
    setEditing(false);
    setInlineActivation(false);
    setAudit(null);
    setDetailTab("subscription");
    if (row) setAction(defaultAction(row));
  }, []);
  const load = useCallback(async () => {
    const version = ++generation.current;
    try {
      const r = await fetch(
        "/api/admin/trials?" +
          new URLSearchParams({ search, status, offset: String(offset) }),
        { cache: "no-store" },
      );
      const b: Register & { error?: string } = await r.json();
      if (!r.ok) throw Error(b.error);
      if (version !== generation.current) return;
      setRegister(b);
      const next =
        b.rows.find((row) => row.id === selection.current?.id) ??
        b.rows[0] ??
        null;
      if (next?.id !== selection.current?.id) selectOrganization(next);
      else {
        selection.current = next;
        setSelected(next);
      }
      setError("");
    } catch (e) {
      if (version === generation.current)
        setError(
          adminSubscriptionError(
            e instanceof Error ? e.message : "REQUEST_FAILED",
            ar,
          ),
        );
    }
  }, [search, status, offset, ar, selectOrganization]);
  const firstRegisterLoad = useRef(true);
  useEffect(() => {
    const delay = firstRegisterLoad.current ? 0 : 200;
    firstRegisterLoad.current = false;
    const t = setTimeout(() => void load(), delay);
    return () => {
      clearTimeout(t);
      generation.current++;
    };
  }, [load]);
  useEffect(() => {
    setMembers([]);
    if (!selected) return;
    const c = new AbortController();
    fetch("/api/admin/subscriptions/panel?organization_id=" + selected.id, {
      cache: "no-store",
      signal: c.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((b) => setMembers(b.members))
      .catch((e) => {
        if (e.name !== "AbortError")
          setError(
            ar
              ? "تعذر تحميل أعضاء المؤسسة."
              : "Unable to load organization members.",
          );
      });
    return () => c.abort();
  }, [selected?.id, ar]);
  async function history(id: string) {
    const version = ++auditGeneration.current;
    setDetailTab("history");
    setAudit(null);
    try {
      const r = await fetch("/api/admin/trials?audit=" + id, {
        cache: "no-store",
      });
      const b = await r.json();
      if (!r.ok) throw Error(b.error);
      if (version === auditGeneration.current) setAudit(b);
    } catch (e) {
      if (version === auditGeneration.current)
        setError(
          adminSubscriptionError(
            e instanceof Error ? e.message : "REQUEST_FAILED",
            ar,
          ),
        );
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>, defaults = false) {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget),
      requestedAction = defaults ? "defaults" : String(f.get("action"));
    const body: Record<string, unknown> = {
      action: requestedAction,
      reason: f.get("reason"),
      revision: defaults
        ? register?.settings.revision
        : (selected?.entitlement.revision ?? 0),
    };
    if (!defaults) body.organization_id = selected?.id;
    if (["defaults", "extend"].includes(requestedAction))
      body.days = Number(f.get("days"));
    if (requestedAction === "activate") {
      const id = String(f.get("plan_id") ?? ""),
        until = String(f.get("until") ?? "");
      if (!id || !until) {
        setError(adminSubscriptionError("PLAN_REQUIRED", ar));
        return;
      }
      body.plan_id = id;
      body.until = new Date(until).toISOString();
      body.max_users = Number(f.get("max_users"));
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch("/api/admin/trials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const b = await r.json();
      if (!r.ok) throw Error(b.error);
      setEditing(false);
      setInlineActivation(false);
      setDefaultsOpen(false);
      setMessage(
        ar
          ? "تم حفظ التغيير وتسجيله في سجل التدقيق."
          : "Change saved and audited.",
      );
      await load();
      await onChanged?.();
    } catch (e) {
      setError(
        adminSubscriptionError(
          e instanceof Error ? e.message : "REQUEST_FAILED",
          ar,
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  const currentPlans = register?.plans ?? plans;
  const plan = selected?.entitlement.plan_snapshot;
  const owner = members.find((m) => m.role === "OWNER");
  const memberLabel = (m: Member) =>
    ({
      OWNER: ar ? "مالك" : "Owner",
      ADMIN: ar ? "مسؤول" : "Admin",
      MEMBER: ar ? "عضو" : "Member",
      VIEWER: ar ? "مشاهد" : "Viewer",
    })[m.role] ?? m.role;
  const memberRows = (items: Member[]) =>
    items.map((m) => (
      <article className="owner-member" key={m.user_id}>
        <span className="owner-avatar" aria-hidden>
          {(m.name || m.email || "—").slice(0, 1)}
        </span>
        <div>
          <strong>{m.name || m.email}</strong>
          <bdi dir="ltr" title={m.email}>
            {m.email}
          </bdi>
        </div>
        <span className="owner-member-role">{memberLabel(m)}</span>
      </article>
    ));
  const historyRows =
    audit === null ? (
      <p role="status">{ar ? "جارٍ تحميل السجل…" : "Loading history…"}</p>
    ) : audit.length ? (
      audit.map((a, i) => (
        <article className="owner-audit" key={a.created_at + i}>
          <strong>{a.details.reason || a.event_type}</strong>
          <small>{displaySubscriptionDate(a.created_at, locale)}</small>
          <small dir="ltr">{a.actor_user_id}</small>
        </article>
      ))
    ) : (
      <p>{ar ? "لا توجد تغييرات مسجلة." : "No recorded changes."}</p>
    );
  const subscriptionEditor = selected ? (
    <>
      {error && (
        <p className="owner-feedback" role="alert">
          {error}
        </p>
      )}{" "}
      <form
        className="request-form owner-subscription-editor"
        onSubmit={submit}
      >
        <fieldset disabled={busy}>
          <label className="form-wide">
            {ar ? "المؤسسة" : "Organization"}
            <input value={selected.name} readOnly />
          </label>
          {inlineActivation ? (
            <input type="hidden" name="action" value="activate" />
          ) : (
            <label>
              {ar ? "الإجراء" : "Action"}
              <select
                name="action"
                aria-label={ar ? "الإجراء" : "Action"}
                value={action}
                onChange={(e) => setAction(e.target.value)}
                required
              >
                {selected.entitlement.trial_started_at &&
                  ["trialing", "expired"].includes(
                    selected.entitlement.status,
                  ) && (
                    <option value="extend">
                      {ar ? "تمديد التجربة" : "Extend trial"}
                    </option>
                  )}
                <option value="activate">
                  {ar ? "تفعيل اشتراك يدوي" : "Activate manually"}
                </option>
                {selected.entitlement.id &&
                  selected.entitlement.status !== "suspended" && (
                    <option value="suspend">
                      {ar ? "تعليق الاشتراك" : "Suspend"}
                    </option>
                  )}
                {selected.entitlement.status === "suspended" && (
                  <option value="resume">
                    {ar ? "رفع التعليق" : "Resume subscription"}
                  </option>
                )}
              </select>
            </label>
          )}
          {action === "extend" && (
            <label>
              {ar ? "أيام التمديد" : "Extension days"}
              <input
                name="days"
                type="number"
                min="1"
                max="365"
                defaultValue={7}
              />
            </label>
          )}
          {action === "activate" && (
            <>
              <label>
                {ar ? "الخطة للتفعيل المدفوع" : "Plan for paid activation"}
                <select
                  name="plan_id"
                  defaultValue=""
                  required
                  onChange={(e) => {
                    const plan = currentPlans.find(
                      (p) => p.id === e.target.value,
                    );
                    const field = e.currentTarget.form?.elements.namedItem(
                      "max_users",
                    ) as HTMLInputElement | null;
                    if (field) {
                      field.value = String(
                        plan?.max_users ?? Math.max(selected.active_users, 5),
                      );
                      field.max = String(plan?.max_users ?? 100000);
                    }
                  }}
                >
                  <option value="">
                    {ar ? "اختر خطة مفعلة" : "Choose active plan"}
                  </option>
                  {currentPlans
                    .filter((p) => p.is_active && p.code !== "trial_30d")
                    .map((p) => (
                      <option value={p.id} key={p.id}>
                        {ar ? p.name_ar : (p.name_en ?? p.name_ar)} ·{" "}
                        {p.billing_interval === "yearly"
                          ? ar
                            ? "سنوي"
                            : "Yearly"
                          : ar
                            ? "شهري"
                            : "Monthly"}{" "}
                        · {money(p.price_amount, p.currency, locale)}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                {ar ? "انتهاء الاشتراك المدفوع" : "Paid subscription end"}
                <input name="until" type="datetime-local" required />
              </label>
              <label>
                {ar ? "عدد المستخدمين للتفعيل المدفوع" : "Paid user limit"}
                <input
                  name="max_users"
                  type="number"
                  min={Math.max(1, selected.active_users)}
                  max={100000}
                  defaultValue={Math.max(selected.active_users, 5)}
                />
              </label>
            </>
          )}
          <label>
            {ar ? "السبب الإداري" : "Administrative reason"}
            <textarea name="reason" minLength={5} maxLength={1000} required />
          </label>
          <button className="primary" disabled={busy}>
            <OwnerActionIcon name="save"/> {ar ? "تنفيذ وحفظ في السجل" : "Apply and audit"}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setInlineActivation(false);
            }}
          >
            <OwnerActionIcon name="cancel"/> {ar ? "إلغاء" : "Cancel"}
          </button>
        </fieldset>
      </form>
      <p className="owner-detail-note">
        {ar
          ? "تُحفظ تواريخ الانتهاء بتوقيت UTC؛ يعرض الحقل توقيت جهازك. بيانات المؤسسة وأدوار أعضائها محفوظة."
          : "End dates are stored in UTC; the field uses your device timezone. Organization data and member roles are preserved."}
      </p>
    </>
  ) : null;
  return (
    <section className="institution-workspace">
      {error && (
        <p className="owner-feedback" role="alert">
          {error}
          <button onClick={() => void load()}>
            <OwnerActionIcon name="refresh"/> {ar ? "تحديث البيانات" : "Refresh"}
          </button>
        </p>
      )}
      {message && (
        <p className="owner-feedback success" role="status">
          {message}
        </p>
      )}
      <div className="console-split institution-split">
        <section className="console-card institution-register">
          <form
            className="owner-console-filters"
            onSubmit={(e) => e.preventDefault()}
          >
            <label className="owner-search">
              <span className="sr-only">
                {ar
                  ? "البحث عن المؤسسة أو المسؤول"
                  : "Search organization or owner"}
              </span>
              <ConsoleIcon name="search" />
              <input
                placeholder={
                  ar
                    ? "ابحث عن المؤسسة أو المسؤول"
                    : "Search organization or owner"
                }
                value={search}
                disabled={busy}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setOffset(0);
                }}
              />
            </label>
            <label>
              <span className="sr-only">{ar ? "الحالة" : "Status"}</span>
              <select
                value={status}
                disabled={busy}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setOffset(0);
                }}
              >
                <option value="">{ar ? "كل الحالات" : "All statuses"}</option>
                {(
                  [
                    "trialing",
                    "active",
                    "expired",
                    "suspended",
                    "cancelled",
                    "legacy",
                    "unconfigured",
                  ] as const
                ).map((s) => (
                  <option key={s} value={s}>
                    {shortSubscriptionLabel(s, ar)}
                  </option>
                ))}
              </select>
            </label>
          </form>
          <div className="subscription-table-wrap">
            <table className="owner-institution-table">
              <thead>
                <tr>
                  {(ar
                    ? [
                        "المؤسسة",
                        "المسؤول الرئيسي",
                        "الباقة",
                        "الحالة",
                        "الأعضاء",
                        "الإدارة",
                      ]
                    : [
                        "Organization",
                        "Primary contact",
                        "Plan",
                        "Status",
                        "Members",
                        "Manage",
                      ]
                  ).map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {register?.rows.map((row) => (
                  <tr
                    key={row.id}
                    aria-selected={selected?.id === row.id}
                    onClick={() => {
                      if (!busy) {
                        selectOrganization(row);
                        showOwnerDetail("owner-institution-details");
                      }
                    }}
                  >
                    <td data-label={ar ? "المؤسسة" : "Organization"}>
                      <strong>{row.name}</strong>
                    </td>
                    <td data-label={ar ? "المسؤول الرئيسي" : "Primary contact"}>
                      <bdi
                        className="owner-contact"
                        dir="ltr"
                        title={row.owner_email}
                      >
                        {row.owner_email || "—"}
                      </bdi>
                    </td>
                    <td data-label={ar ? "الباقة" : "Plan"}>
                      {row.entitlement.plan_snapshot?.[
                        ar ? "name_ar" : "name_en"
                      ] ??
                        currentPlans.find(
                          (p) => p.id === row.entitlement.plan_id,
                        )?.[ar ? "name_ar" : "name_en"] ??
                        (ar ? "غير مفعلة" : "Not activated")}
                    </td>
                    <td data-label={ar ? "الحالة" : "Status"}>
                      <OwnerStatusBadge
                        status={row.entitlement.status}
                        title={subscriptionLabel(row.entitlement.status, ar)}
                      >
                        {shortSubscriptionLabel(row.entitlement.status, ar)}
                      </OwnerStatusBadge>
                    </td>
                    <td data-label={ar ? "الأعضاء" : "Members"}>
                      <bdi dir="ltr">
                        {row.active_users} / {row.entitlement.max_users ?? "—"}
                      </bdi>
                    </td>
                    <td data-label={ar ? "الإدارة" : "Manage"}>
                      <button
                        className="owner-row-action"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          selectOrganization(row);
                          showOwnerDetail("owner-institution-details");
                        }}
                      >
                        <OwnerActionIcon name="settings"/> {ar ? "إدارة" : "Manage"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!register ? (
            <p role="status">
              {ar ? "جارٍ تحميل المؤسسات…" : "Loading organizations…"}
            </p>
          ) : !register.rows.length ? (
            <p className="owner-empty">
              {ar ? "لا توجد مؤسسات مطابقة." : "No matching organizations."}
            </p>
          ) : null}
          <footer className="owner-table-footer">
            <small>
              <ConsoleIcon name="info" />
              {ar
                ? "الاشتراك مرتبط بالمؤسسة؛ عضوية المستخدم مستقلة في كل مؤسسة."
                : "Subscriptions apply per organization; memberships remain independent."}
            </small>
            <div className="owner-pagination-controls">
              <button
                disabled={!offset || busy}
                onClick={() => setOffset((x) => Math.max(0, x - 50))}
              >
                <OwnerActionIcon name="previous"/> {ar ? "السابق" : "Previous"}
              </button>
              <button
                disabled={!register || register.rows.length < 50 || busy}
                onClick={() => setOffset((x) => x + 50)}
              >
                <OwnerActionIcon name="next"/> {ar ? "التالي" : "Next"}
              </button>
            </div>
          </footer>
          <div className="owner-defaults-link">
            <button
              onClick={() => {
                setError("");
                setDefaultsOpen(true);
              }}
            >
              <OwnerActionIcon name="settings"/> {ar
                ? "إعداد التجربة للعملاء الجدد"
                : "Trial default for new organizations"}
            </button>
            <span>
              {register?.settings.trial_days ?? "—"} {ar ? "يوماً" : "days"}
            </span>
          </div>
          <section
            className="owner-add-subscription"
            aria-labelledby="owner-add-subscription-title"
          >
            <header>
              <h3 id="owner-add-subscription-title">
                {ar ? "إضافة / تفعيل اشتراك" : "Add / activate subscription"}
              </h3>
              <button
                className="primary"
                disabled={busy || !selected}
                aria-expanded={inlineActivation}
                aria-controls="owner-inline-subscription"
                onClick={() => {
                  setAction("activate");
                  setEditing(false);
                  setError("");
                  setInlineActivation((value) => !value);
                }}
              >
                <OwnerActionIcon name="add"/> {ar ? "إضافة اشتراك" : "Add subscription"}
              </button>
            </header>
            <p>
              {ar
                ? "اختر المؤسسة من السجل ثم حدد الباقة والمدة والمقاعد. لا يُنفذ أي تغيير حتى الحفظ، والتفعيل اليدوي لا يسجل دفعة مالية."
                : "Select an organization from the register, then choose its plan, end date and seats. Nothing changes until save; manual activation does not record payment."}
            </p>
            {inlineActivation && (
              <div id="owner-inline-subscription">{subscriptionEditor}</div>
            )}
          </section>
        </section>
        {selected ? (
          <aside
            className="console-card institution-detail"
            id="owner-institution-details"
            tabIndex={-1}
            aria-label={ar ? "تفاصيل المؤسسة" : "Organization details"}
          >
            <header className="owner-detail-header">
              <div>
                <h2>{selected.name}</h2>
                <p>
                  {ar ? "المسؤول: " : "Contact: "}
                  {owner?.name || selected.owner_email}
                </p>
              </div>
              <OwnerStatusBadge
                status={selected.entitlement.status}
                title={subscriptionLabel(selected.entitlement.status, ar)}
              >
                {shortSubscriptionLabel(selected.entitlement.status, ar)}
              </OwnerStatusBadge>
            </header>
            <nav className="owner-detail-tabs">
              {[
                ["subscription", ar ? "الاشتراك" : "Subscription"],
                ["members", ar ? "الأعضاء" : "Members"],
                ["history", ar ? "السجل" : "History"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  aria-pressed={detailTab === id}
                  onClick={() => {
                    setDetailTab(id);
                    if (id === "history") void history(selected.id);
                  }}
                >
                  <ConsoleIcon
                    name={
                      id === "subscription"
                        ? "card"
                        : id === "members"
                          ? "users"
                          : "clock"
                    }
                  />
                  <span>{label}</span>
                </button>
              ))}
            </nav>
            {detailTab === "history" ? (
              historyRows
            ) : detailTab === "members" ? (
              <section className="owner-members-list">
                {memberRows(members)}
                {members.length === 100 && (
                  <small>
                    {ar
                      ? "تُعرض أول 100 عضوية."
                      : "First 100 memberships shown."}
                  </small>
                )}
              </section>
            ) : (
              <>
                <dl className="owner-detail-facts">
                  <div>
                    <dt>{ar ? "الباقة الحالية" : "Current plan"}</dt>
                    <dd>
                      {plan?.[ar ? "name_ar" : "name_en"] ??
                        (selected.entitlement.status === "trialing"
                          ? ar
                            ? "تجربة مجانية"
                            : "Free trial"
                          : ar
                            ? "لم تُفعّل باقة"
                            : "No plan activated")}
                    </dd>
                  </div>
                  <div>
                    <dt>{ar ? "السعر المعتمد" : "Agreed price"}</dt>
                    <dd>
                      {plan
                        ? money(plan.price_amount, plan.currency, locale) +
                          " / " +
                          (plan.billing_interval === "yearly"
                            ? ar
                              ? "سنة"
                              : "year"
                            : ar
                              ? "شهر"
                              : "month")
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>{ar ? "الأعضاء" : "Members"}</dt>
                    <dd>
                      <bdi dir="ltr">
                        {selected.active_users} /{" "}
                        {selected.entitlement.max_users ?? "—"}
                      </bdi>
                    </dd>
                  </div>
                  <div>
                    <dt>{ar ? "نهاية الفترة" : "Period end"}</dt>
                    <dd>
                      {displaySubscriptionDate(
                        selected.entitlement.status === "active"
                          ? selected.entitlement.current_period_end
                          : selected.entitlement.trial_ends_at,
                        locale,
                      )}
                    </dd>
                  </div>
                </dl>
                <section className="owner-member-preview">
                  <h3>
                    {ar ? "أعضاء المؤسسة" : "Organization members"}{" "}
                    <bdi>({selected.active_users})</bdi>
                  </h3>
                  {memberRows(
                    members.filter((m) => m.status === "ACTIVE").slice(0, 3),
                  )}
                  {selected.active_users > 3 && (
                    <button
                      className="owner-text-button"
                      onClick={() => setDetailTab("members")}
                    >
                      <OwnerActionIcon name="view"/> {ar ? "عرض جميع الأعضاء" : "View all members"}
                    </button>
                  )}
                </section>
                <footer className="owner-detail-actions">
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => {
                      setAction(defaultAction(selected));
                      setError("");
                      setInlineActivation(false);
                      setEditing(true);
                    }}
                  >
                    <OwnerActionIcon name="edit"/> {ar
                      ? "تعديل / تجديد الاشتراك"
                      : "Modify / renew subscription"}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => void history(selected.id)}
                  >
                    <OwnerActionIcon name="history"/> {ar ? "سجل التغييرات" : "Change history"}
                  </button>
                  {selected.entitlement.id && (
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={() => {
                        setAction(
                          selected.entitlement.status === "suspended"
                            ? "resume"
                            : "suspend",
                        );
                        setError("");
                        setInlineActivation(false);
                        setEditing(true);
                      }}
                    >
                      <OwnerActionIcon name="pause"/> {selected.entitlement.status === "suspended"
                        ? ar
                          ? "رفع التعليق"
                          : "Resume"
                        : ar
                          ? "تعليق الاشتراك"
                          : "Suspend subscription"}
                    </button>
                  )}
                </footer>
                <p className="owner-detail-note">
                  {ar
                    ? "كل تعديل يتطلب سبباً وصلاحية مالك المنصة. التفعيل اليدوي لا يسجل دفعة مالية."
                    : "Every change requires an owner-authorized reason. Manual activation does not record payment."}
                </p>
              </>
            )}
          </aside>
        ) : (
          <aside className="console-card owner-empty">
            <ConsoleIcon name="building" />
            <h2>{ar ? "اشتراك المؤسسة" : "Organization subscription"}</h2>
            <p>
              {ar
                ? "اختر مؤسسة لعرض الاشتراك والأعضاء وسجل التغييرات."
                : "Select an organization to view subscription, members and history."}
            </p>
          </aside>
        )}
      </div>
      {editing && selected && (
        <SubscriptionModal
          title={
            (ar ? "إدارة الاشتراك — " : "Manage subscription — ") +
            selected.name
          }
          busy={busy}
          onClose={() => setEditing(false)}
        >
          {subscriptionEditor}
        </SubscriptionModal>
      )}
      {defaultsOpen && register && (
        <SubscriptionModal
          title={
            ar
              ? "إعداد التجربة للعملاء الجدد"
              : "Trial default for new organizations"
          }
          busy={busy}
          onClose={() => setDefaultsOpen(false)}
        >
          <p>
            {ar
              ? "تغيير المدة لا يغير التجارب الحالية."
              : "Changing this duration does not change existing trials."}
          </p>
          {error && <p role="alert">{error}</p>}
          <form className="request-form" onSubmit={(e) => void submit(e, true)}>
            <label>
              {ar ? "المدة بالأيام" : "Duration in days"}
              <input
                name="days"
                type="number"
                min={1}
                max={365}
                defaultValue={register.settings.trial_days}
                required
              />
            </label>
            <label>
              {ar ? "سبب التعديل" : "Reason"}
              <textarea name="reason" minLength={5} maxLength={1000} required />
            </label>
            <button className="primary" disabled={busy}>
              <OwnerActionIcon name="save"/> {ar ? "حفظ المدة الافتراضية" : "Save default"}
            </button>
          </form>
        </SubscriptionModal>
      )}
    </section>
  );
}
