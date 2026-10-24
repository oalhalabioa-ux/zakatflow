/** Isolate the temporary navigation drawer without changing desktop preferences. */
export function activateSidebarDrawer(
  sidebar: HTMLElement,
  workspace: HTMLElement,
  trigger: HTMLElement | null,
  close: () => void,
) {
  const doc = sidebar.ownerDocument;
  const previousFocus = doc.activeElement as HTMLElement | null;
  const wasInert = workspace.inert;
  const bodyOverflow = doc.body.style.overflow;
  const rootOverflow = doc.documentElement.style.overflow;
  workspace.inert = true;
  doc.body.style.overflow = 'hidden';
  doc.documentElement.style.overflow = 'hidden';
  const controls = () => Array.from(sidebar.querySelectorAll<HTMLElement>(
    'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]',
  )).filter(el => el.getClientRects().length > 0 && !el.closest('[inert]'));
  (sidebar.querySelector<HTMLElement>('.corp-drawer-close') ?? sidebar).focus();
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab') return;
    const items = controls();
    const first = items[0];
    const last = items[items.length - 1];
    if (!first) { event.preventDefault(); sidebar.focus(); return; }
    if (event.shiftKey && (doc.activeElement === first || !items.includes(doc.activeElement as HTMLElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (doc.activeElement === last || !items.includes(doc.activeElement as HTMLElement))) {
      event.preventDefault(); first.focus();
    }
  };
  doc.addEventListener('keydown', onKeyDown);
  return () => {
    doc.removeEventListener('keydown', onKeyDown);
    workspace.inert = wasInert;
    doc.body.style.overflow = bodyOverflow;
    doc.documentElement.style.overflow = rootOverflow;
    // A viewport change hides the mobile trigger; do not focus a hidden control.
    const target = trigger?.getClientRects().length ? trigger : previousFocus;
    if (target?.isConnected && target.getClientRects().length) target.focus();
  };
}
