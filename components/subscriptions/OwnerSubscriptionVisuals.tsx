import type { ReactNode } from "react";
import type { SubscriptionStatus } from "@/lib/subscriptions/model";
export type ConsoleIconName =
  | "building"
  | "users"
  | "requests"
  | "layers"
  | "card"
  | "clock"
  | "trial"
  | "search"
  | "settings"
  | "info";
export function ConsoleIcon({ name }: { name: ConsoleIconName }) {
  const shapes: Record<ConsoleIconName, ReactNode> = {
    building: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 7h2m4 0h2M8 11h2m4 0h2M10 21v-6h4v6" />
      </>
    ),
    users: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 21v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5" />
      </>
    ),
    requests: (
      <>
        <path d="M13 3H5v18h14V9Z M13 3v6h6M8 12h4m-4 4h3" />
        <circle cx="18" cy="18" r="4" />
        <path d="M18 16v2l1 1" />
      </>
    ),
    layers: (
      <>
        <path d="m12 3 10 5-10 5L2 8Zm-9 10 9 5 9-5M3 18l9 5 9-5" />
      </>
    ),
    card: (
      <>
        <rect x="2" y="5" width="20" height="14" rx="3" />
        <path d="M2 10h20M6 15h4" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 6v6l4 3" />
      </>
    ),
    trial: (
      <>
        <path d="M9 3h6M10 3v7L4 20a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1l-6-10V3M7 16h10" />
      </>
    ),
    search: (
      <>
        <circle cx="10" cy="10" r="7" />
        <path d="m15 15 6 6" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="m9 3-1 3-3 1-2 4 2 2v3l3 2 1 3h6l1-3 3-2v-3l2-2-2-4-3-1-1-3Z" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7h.01" />
      </>
    ),
  };
  return (
    <svg
      className="owner-console-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {shapes[name]}
    </svg>
  );
}
export type OwnerActionIconName =
  | "add" | "save" | "edit" | "refresh" | "cancel" | "previous" | "next"
  | "approve" | "reject" | "history" | "settings" | "view" | "pause" | "info";
export function OwnerActionIcon({name}:{name:OwnerActionIconName}) {
  const paths:Record<OwnerActionIconName,ReactNode> = {
    add:<path d="M12 5v14M5 12h14"/>,
    save:<><path d="M4 4h13l3 3v13H4Z"/><path d="M7 4v6h10V4M8 20v-7h8v7"/></>,
    edit:<><path d="m4 20 4-.8L20 7l-3-3L5 16Z"/><path d="m14 7 3 3"/></>,
    refresh:<><path d="M20 6v5h-5M4 18v-5h5"/><path d="M5.5 10a7 7 0 0 1 12-3l2.5 4M4 13l2.5 4a7 7 0 0 0 12-3"/></>,
    cancel:<path d="M5 5l14 14M19 5 5 19"/>,
    previous:<path d="m15 5-7 7 7 7"/>,
    next:<path d="m9 5 7 7-7 7"/>,
    approve:<path d="m4 12 5 5L20 6"/>,
    reject:<><circle cx="12" cy="12" r="9"/><path d="m8 8 8 8m0-8-8 8"/></>,
    history:<><path d="M3 12a9 9 0 1 0 3-7M3 4v5h5"/><path d="M12 7v5l4 2"/></>,
    settings:<><circle cx="12" cy="12" r="3"/><path d="M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z"/></>,
    view:<><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></>,
    pause:<><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 8v8m6-8v8"/></>,
    info:<><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
  };
  return <svg className="owner-elegant-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
export function shortSubscriptionLabel(
  status: SubscriptionStatus,
  ar: boolean,
) {
  const labels: Record<SubscriptionStatus, [string, string]> = {
    legacy: ["وصول محفوظ", "Access preserved"],
    unconfigured: ["بحاجة لإعداد", "Needs setup"],
    trialing: ["تجربة نشطة", "Active trial"],
    active: ["نشط", "Active"],
    expired: ["منتهي", "Expired"],
    suspended: ["معلق", "Suspended"],
    cancelled: ["ملغى", "Cancelled"],
    past_due: ["متأخر", "Past due"],
  };
  return labels[status]?.[ar ? 0 : 1] ?? status;
}
export function OwnerStatusBadge({
  status,
  children,
  title,
}: {
  status: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className="owner-status-badge" data-status={status} title={title}>
      {children}
    </span>
  );
}
/** Selecting a card on a narrow screen brings the corresponding details into view. */
export function showOwnerDetail(id:string){
 if(typeof window==='undefined')return;
 requestAnimationFrame(()=>{const target=document.getElementById(id);const width=target?.closest('.owner-subscription-console')?.clientWidth??window.innerWidth;if(!target||width>950)return;target.focus({preventScroll:true});target.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});});
}
