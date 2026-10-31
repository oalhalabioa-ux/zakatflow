import "./owner.css";
export default function OwnerLoading() {
  return (
    <section
      className="owner-loading"
      aria-busy="true"
      aria-live="polite"
      role="status"
    >
      <p>جارٍ تحميل لوحة الإدارة… / Loading administration…</p>
      <div className="owner-loading-grid" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} />
        ))}
      </div>
    </section>
  );
}
