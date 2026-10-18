import type {ReactNode} from 'react';
/** Model 1: outlined, multicolor pictograms. Theme-gated in CSS. */
export default function YaqeenKpiGlyph({kind,fallback}:{kind:string;fallback?:ReactNode}){
 let shape:ReactNode;
 if(['trend','growth'].includes(kind))shape=<><rect x="3" y="21" width="6" height="8" rx="1" fill="var(--yk-pale)"/><rect x="13" y="16" width="6" height="13" rx="1" fill="var(--yk-pale)"/><rect x="23" y="10" width="6" height="19" rx="1" fill="var(--yk-blue)" fillOpacity=".25"/><path d="M3 15C12 14 20 9 27 3"/><path d="m21 3 8-1-2 8Z" stroke="var(--yk-gold)" fill="var(--yk-light-gold)"/></>;
 else if(['pool','allocation'].includes(kind))shape=<><path d="M14 3a13 13 0 1 0 14 14H14Z" fill="var(--yk-pale)"/><path d="M19 2v11h11A13 13 0 0 0 19 2Z" stroke="var(--yk-gold)" fill="var(--yk-light-gold)"/><path d="m19 18 8 8a13 13 0 0 0 3-8Z" fill="var(--yk-blue)" fillOpacity=".45"/></>;
 else if(['receipt','paid','due','payment'].includes(kind))shape=<><circle cx="20" cy="8" r="6" fill="var(--yk-light-gold)" stroke="var(--yk-gold)"/><path d="m18 8 2 2 3-4" stroke="var(--yk-gold)"/><path d="M2 20h5l5-4h6c4 0 4 5 0 5h-5m5 0 8-4c4-2 6 2 3 4l-9 7H8l-6-3" fill="var(--yk-pale)"/><path d="M2 19v9"/></>;
 else if(['history','clock','open'].includes(kind))shape=<><circle cx="16" cy="17" r="12" fill="var(--yk-pale)"/><path d="M16 8v9l6 4"/><path d="M10 2h12" stroke="var(--yk-gold)"/><path d="M16 2v3" stroke="var(--yk-gold)"/></>;
 else if(['bank','investment','assets','fixed'].includes(kind))shape=<><path d="m3 10 13-8 13 8Z" fill="var(--yk-pale)"/><circle cx="16" cy="7" r="1.5" stroke="var(--yk-gold)" fill="var(--yk-light-gold)"/><path d="M6 13h4v12H6Zm8 0h4v12h-4Zm8 0h4v12h-4Z" fill="var(--yk-pale)"/><path d="M3 26h26v4H3Z"/></>;
 else if(kind==='metals')shape=<><path d="m3 27 3-10h10l3 10Zm12 0 3-10h9l3 10Z" fill="var(--yk-pale)"/><path d="m10 16 3-10h9l3 10Z" fill="var(--yk-light-gold)" stroke="var(--yk-gold)"/></>;
 else shape=<><rect x="6" y="2" width="20" height="25" rx="2" fill="var(--yk-pale)"/><path d="M11 8h10M11 13h10M11 18h5"/><circle cx="23" cy="24" r="5" fill="var(--yk-light-gold)" stroke="var(--yk-gold)"/><path d="m21 29-1 3 3-1 3 1-1-3" stroke="var(--yk-gold)"/></>;
 return <span className="yaqeen-kpi-glyph" aria-hidden="true">{fallback&&<span className="yaqeen-kpi-legacy">{fallback}</span>}<svg className="yaqeen-kpi-art" viewBox="0 0 34 34" fill="none" stroke="var(--yk-ink)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" focusable="false">{shape}</svg></span>;
}
