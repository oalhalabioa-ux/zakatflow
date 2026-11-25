"use client";
import { useEffect, useState } from "react";
import TopbarOrganizationControls from "../TopbarOrganizationControls";
import WorkspaceOrganizationPicker from "../WorkspaceOrganizationPicker";
import {
  rememberOrganization,
  rememberedOrganization,
  requestedOrganization,
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
    [error, setError] = useState<'LOAD'|'UNAVAILABLE'|null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/organizations", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw Error();
        const rows = (await r.json()) as WorkspaceOrganization[];
        if (live) {
          setItems(rows);
          const q=new URLSearchParams(location.search),explicit=q.get("organization")??q.get('organization_id');
          const requested = explicit ?? rememberedOrganization();
          const selected = requestedOrganization(rows, explicit, rememberedOrganization())?.id ?? "";
          setId(selected);
          setError(explicit!==null&&!selected?'UNAVAILABLE':null);
          if (selected && selected !== requested) rememberOrganization(selected, false);
        }
      })
      .catch(() => {
        if (live){setId('');setError('LOAD');}
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    const read = () => {
      const q=new URLSearchParams(location.search),explicit=q.get('organization')??q.get('organization_id');
      const next=requestedOrganization(items,explicit,rememberedOrganization());
      setId(next?.id??'');setError(explicit!==null&&!next?'UNAVAILABLE':null);
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
          {error==='UNAVAILABLE'?(ar?'المؤسسة المحددة غير متاحة. اختر مؤسسة مصرحًا بها من البنر.':'The requested organization is unavailable. Choose an authorized organization from the banner.'):(ar ? "تعذر تحميل قائمة المؤسسات." : "Unable to load organizations.")}
        </p>
      )}
      <TopbarOrganizationControls>
        <WorkspaceOrganizationPicker
          ar={ar}
          organizations={items}
          value={id}
          restore={false}
          onChange={next=>{setId(next);setError(null);}}
          label={ar ? "المؤسسة المختارة" : "Selected organization"}
        />
      </TopbarOrganizationControls>
    </>
  );
}
