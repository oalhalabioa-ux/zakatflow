"use client";

import { use, useState } from "react";

const states = ["DRAFT", "IN_PROGRESS", "ACCOUNTANT_REVIEW", "SHARIA_REVIEW", "APPROVED", "PAID", "CLOSED"] as const;
type WorkflowStatus = (typeof states)[number];

const statusLabels = {
  ar: {
    DRAFT: "مسودة",
    IN_PROGRESS: "قيد العمل",
    ACCOUNTANT_REVIEW: "المراجعة المحاسبية",
    SHARIA_REVIEW: "المراجعة الشرعية",
    APPROVED: "معتمد",
    PAID: "مسدد",
    CLOSED: "مغلق",
  },
  en: {
    DRAFT: "Draft",
    IN_PROGRESS: "In progress",
    ACCOUNTANT_REVIEW: "Accounting review",
    SHARIA_REVIEW: "Sharia review",
    APPROVED: "Approved",
    PAID: "Paid",
    CLOSED: "Closed",
  },
};

export default function Workflow({ params }: { params: Promise<{ locale: string }> }) {
  const ar = use(params).locale === "ar";
  const labels = statusLabels[ar ? "ar" : "en"];
  const [status, setStatus] = useState<WorkflowStatus>("ACCOUNTANT_REVIEW");
  const next = status === "ACCOUNTANT_REVIEW" ? "SHARIA_REVIEW"
    : status === "SHARIA_REVIEW" ? "APPROVED"
    : status === "APPROVED" ? "PAID"
    : status === "PAID" ? "CLOSED"
    : null;
  const notice: Partial<Record<WorkflowStatus, string>> = {
    ACCOUNTANT_REVIEW: ar ? "بانتظار المراجعة المحاسبية." : "Awaiting accounting review.",
    SHARIA_REVIEW: ar ? "بانتظار المراجعة الشرعية." : "Awaiting Sharia review.",
    APPROVED: ar ? "تم الاعتماد ويمكن تسجيل الدفع." : "Approved. Payment can now be recorded.",
    PAID: ar ? "تم الدفع وبانتظار إغلاق الملف." : "Payment recorded. Awaiting closure.",
  };

  return (
    <main className="container review-workflow" dir={ar ? "rtl" : "ltr"}>
      <div className="page-head">
        <div>
          <span className="pill">{ar ? "سير العمل" : "Workflow"}</span>
          <h1>{ar ? "دورة المراجعة والاعتماد" : "Review and approval workflow"}</h1>
          <p className="muted">{ar ? "تتبع الملف من الإدخال حتى الدفع مع سجل انتقالات واضح." : "Follow the file from entry to payment with a clear history of status changes."}</p>
        </div>
      </div>
      <div className="card">
        <div className="stepper">
          {states.map(step => (
            <div key={step} className={step === status ? "step active" : "step"} aria-current={step === status ? "step" : undefined}>
              {labels[step]}
            </div>
          ))}
        </div>
        <div className="split">
          <div>
            <h2>{ar ? "احتساب" : "Assessment"} <bdi>#ZF-2026-0018</bdi></h2>
            <p className="muted">
              {ar ? "الجهة: عائلة النور" : "Entity: Al Noor Family"} · <bdi>32,112.50 SAR</bdi> · {ar ? "نصاب الفضة" : "Silver Nisab"} · <bdi>2.5%</bdi>
            </p>
            <div className="success">
              {notice[status] ?? `${ar ? "الحالة الحالية" : "Current status"}: ${labels[status]}`}
            </div>
          </div>
          <div className="card">
            <div className="muted">{ar ? "الحالة الحالية" : "Current status"}</div>
            <div className="metric" style={{ fontSize: 20 }}>{labels[status]}</div>
            {next && (
              <button className="btn" onClick={() => setStatus(next)}>
                {ar ? "انتقال إلى" : "Move to"} {labels[next]}
              </button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
