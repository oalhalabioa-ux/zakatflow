"use client";
import { useEffect, useState } from "react";
import TopbarOrganizationControls from "@/components/TopbarOrganizationControls";
import {
  rememberOrganization,
  rememberedOrganization,
  preferredOrganization,
  type WorkspaceOrganization,
} from "@/lib/workspace-organization";
export default function BillingOrganizationPicker({
  locale,
}: {
  locale: string;
}) {
  const ar = locale === "ar",
    [items, setItems] = useState<WorkspaceOrganization[]>([]),
    [id, setId] = useState(""),
    [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    fetch("/api/organizations", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw Error();
        const rows = (await r.json()) as WorkspaceOrganization[];
        if (live) {
          setItems(rows);
          const explicit = new URLSearchParams(location.search).get("organization");
          if(explicit&&!rows.some(o=>o.id===explicit)){setError(true);return;}
          const requested = explicit ?? rememberedOrganization();
          setId(preferredOrganization(rows, requested)?.id ?? "");
        }
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    const read = () => {
      const next =
        new URLSearchParams(location.search).get("organization") ??
        rememberedOrganization();
      if (items.some((o) => o.id === next)) setId(next!);
    };
    window.addEventListener("zf-organization-selection", read);
    window.addEventListener("popstate", read);
    return () => {
      window.removeEventListener("zf-organization-selection", read);
      window.removeEventListener("popstate", read);
    };
  }, [items]);
  return (
    <>
      {error && (
        <p role="alert">
          {ar ? "تعذر تحميل قائمة المؤسسات." : "Unable to load organizations."}
        </p>
      )}
      <TopbarOrganizationControls>
        <label className="settings-org-picker">
          {ar ? "المؤسسة" : "Organization"}
          <select
            aria-label={ar ? "المؤسسة المختارة" : "Selected organization"}
            value={id}
            onChange={(e) => {
              setId(e.target.value);
              rememberOrganization(e.target.value, false);
            }}
          >
            {items.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      </TopbarOrganizationControls>
    </>
  );
}
