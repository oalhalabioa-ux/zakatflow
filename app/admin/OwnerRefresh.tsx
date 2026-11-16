"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
export default function OwnerRefresh({ locale }: { locale: string }) {
  const router = useRouter(),
    [pending, startTransition] = useTransition();
  return (
    <button
      className="owner-action"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
      aria-busy={pending}
    >
      {pending
        ? locale === "ar"
          ? "جارٍ التحديث…"
          : "Refreshing…"
        : locale === "ar"
          ? "تحديث البيانات"
          : "Refresh data"}
    </button>
  );
}
