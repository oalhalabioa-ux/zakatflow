import type { Plan } from "./catalog";
export type ActivationRequest = {
  id: string;
  request_number: number;
  organization_id: string;
  organization_name?: string;
  requester_name: string;
  requester_email: string;
  phone: string;
  notes: string;
  quote: Pick<
    Plan,
    | "id"
    | "name_ar"
    | "name_en"
    | "price_amount"
    | "currency"
    | "billing_interval"
    | "max_users"
  >;
  status:
    | "pending"
    | "reviewing"
    | "needs_info"
    | "approved"
    | "rejected"
    | "cancelled";
  revision: number;
  reason: string | null;
  created_at: string;
  approved_until: string | null;
};
export function requestLabel(status: ActivationRequest["status"], ar: boolean) {
  const names = {
    pending: ["بانتظار المراجعة", "Pending"],
    reviewing: ["قيد المراجعة", "In review"],
    needs_info: ["يحتاج معلومات", "Information requested"],
    approved: ["تم التفعيل", "Activated"],
    rejected: ["مرفوض", "Rejected"],
    cancelled: ["ملغى", "Cancelled"],
  };
  return names[status]?.[ar ? 0 : 1] ?? status;
}
export const openRequest = (r: ActivationRequest) =>
  ["pending", "reviewing", "needs_info"].includes(r.status);
