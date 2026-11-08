export type SettingsIconName='organization'|'structure'|'finance'|'regulatory'|'users'|'system'|'journey'|'calendar'|'chart'|'posting'|'bank'|'opening'|'appearance'|'notifications'|'security'|'info'|'billing';
const paths:Record<SettingsIconName,string>={
 organization:'M4 21V3h16v18M8 7h2m4 0h2M8 11h2m4 0h2M9 21v-6h6v6M2 21h20',
 structure:'M9 3h6v5H9zM3 16h6v5H3zM15 16h6v5h-6zM12 8v4M6 16v-4h12v4',
 finance:'M4 5c0-4 16-4 16 0s-16 4-16 0Zm0 0v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0',
 regulatory:'M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6',
 users:'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21v-3a7 7 0 0 1 14 0v3M20 8v8M16 12h8',
 system:'m9 3-1 3-3 1-2 4 2 2v3l3 2 1 3h6l1-3 3-2v-3l2-2-2-4-3-1-1-3ZM9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0',
 journey:'M5 18c0-5 4-6 7-6s7-3 7-8M14 4h5v5M3 20h4v-4H3zM10 14h4v-4h-4z',
 calendar:'M4 5h16v16H4zM8 2v6M16 2v6M4 10h16',
 chart:'m12 2 10 5-10 5L2 7Zm-10 10 10 5 10-5M2 17l10 5 10-5',
 posting:'M3 7h18m-5-5 5 5-5 5M21 17H3m5-5-5 5 5 5',
 bank:'m2 8 10-6 10 6ZM4 11v7m5-7v7m6-7v7m5-7v7M2 22h20M2 19h20',
 opening:'M4 3h16v18H4zM8 8h8M8 12h8M8 16h5',
 appearance:'M2 3h20v14H2zM8 22h8M12 17v5',
 notifications:'M5 17h14l-2-4V9a5 5 0 0 0-10 0v4ZM10 21h4',
 security:'m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6ZM8 12l3 3 5-6',
 info:'M12 11v6M12 7v1M2 12a10 10 0 1 0 20 0 10 10 0 0 0-20 0',
 billing:'M2 5h20v14H2zM2 10h20M6 15h4',
};
export default function SettingsIcon({name}:{name:SettingsIconName}){
 return <svg className="settings-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}
