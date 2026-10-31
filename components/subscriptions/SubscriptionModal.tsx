"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
export default function SubscriptionModal({
  title,
  onClose,
  children,
  busy = false,
  className = "",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  busy?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    id = useId(),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`subscription-modal subscription-panel ${className}`}
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close.current();
      }}
    >
      <header className="console-heading">
        <h2 id={id}>{title}</h2>
        <button
          type="button"
          aria-label="Close / إغلاق"
          disabled={busy}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
