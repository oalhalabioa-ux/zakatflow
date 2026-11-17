import type { StudyTab } from '@/lib/feasibility/engine';

const shapes = {
  briefcase: <><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M8 7V4h8v3M2 12h20"/></>,
  building: <><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 7v2M15 7v2M9 12v2M15 12v2M10 21v-4h4v4"/></>,
  chart: <><path d="M4 21V11h4v10M10 21V5h4v16M16 21V9h4v12M3 21h18"/></>,
  check: <><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></>,
  clipboard: <><rect x="4" y="4" width="16" height="18" rx="2"/><path d="M9 2h6v5H9zM8 12h8M8 16h8"/></>,
  coins: <><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v6c0 2 4 3 9 3s9-1 9-3V5M3 11v6c0 2 4 3 9 3s9-1 9-3v-6"/></>,
  droplet: <><path d="M12 3c3 4 7 9 7 13a7 7 0 0 1-14 0c0-4 4-9 7-13z"/></>,
  factory: <><path d="M3 21h18V10l-6 4V9l-6 4V5H3zM7 18h2M12 18h2M17 18h2"/></>,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/></>,
  filecheck: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6m-11 8 2 2 4-4"/></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  layers: <><path d="m12 2 9 5-9 5-9-5 9-5zM3 12l9 5 9-5M3 17l9 5 9-5"/></>,
  plus: <><path d="M12 5v14M5 12h14"/></>,
  scale: <><path d="M12 3v17M4 7h16M7 7l-4 8h8L7 7M17 7l-4 8h8l-4-8M8 21h8"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06-2.12 2.12-.06-.06a1.65 1.65 0 0 0-1.82-.33L14 19.4V22h-4v-2.6L8.2 18.6a1.65 1.65 0 0 0-1.82.33l-.06.06-2.12-2.12.06-.06A1.65 1.65 0 0 0 4.6 15L2 14v-4l2.6-1A1.65 1.65 0 0 0 4.3 7.2l-.06-.06L6.36 5l.06.06A1.65 1.65 0 0 0 8.2 5.4L10 4.6V2h4v2.6l1.8.8a1.65 1.65 0 0 0 1.82-.33l.06-.06L19.8 7.1l-.06.06A1.65 1.65 0 0 0 19.4 9L22 10v4z"/></>,
  share: <><circle cx="18" cy="5" r="3"/><circle cx="5" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8 11 7-5M8 13l7 5"/></>,
  shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></>,
  truck: <><path d="M3 6h12v12H3zM15 10h4l3 4v4h-7zM7 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4M18 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4"/></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
  wallet: <><rect x="2" y="5" width="20" height="15" rx="2"/><path d="M2 9h20M17 14h2"/></>,
} as const;

export type RoyalIconName = keyof typeof shapes;
export const studyTabIcons: Record<StudyTab, RoyalIconName> = {
  overview: 'grid',
  profile: 'file',
  investment: 'coins',
  partners: 'users',
  operations: 'factory',
  scenarios: 'chart',
  cashflow: 'wallet',
  advanced: 'settings',
  sector: 'layers',
  legal: 'scale',
  tasks: 'clipboard',
  risks: 'shield',
  suppliers: 'truck',
  decisions: 'filecheck',
  handoff: 'building',
  sharing: 'share',
  report: 'file',
};

export function RoyalIcon({ name }: { name: RoyalIconName }) {
  return <svg className="fs-royal-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none"
    stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">{shapes[name]}</svg>;
}
