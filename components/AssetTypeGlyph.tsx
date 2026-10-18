import type {ReactNode} from 'react';
/** SVGs in Yaqeen; keep the existing symbols in the other three themes. */
export default function AssetTypeGlyph({code,fallback}:{code:string|null|undefined;fallback:ReactNode}){
 const type=(code||'OTHER').replace(/^(TYPE|CLASS):/,'');
 const bank=<><path d="m3 8 9-5 9 5H3ZM4 21h16M7 11v6M12 11v6M17 11v6"/></>;
 const building=<><path d="M4 21V7l8-4 8 4v14H4ZM9 21v-5h6v5M8 9h1m6 0h1M8 12h1m6 0h1"/></>;
 const box=<><path d="m3 7 9-4 9 4v10l-9 4-9-4V7Zm0 0 9 4 9-4M12 11v10M8 5l9 4"/></>;
 let shape:ReactNode;
 if(['CASH','BANK','DEPOSIT','REFUNDABLE_DEPOSIT'].includes(type))shape=bank;
 else if(['GOLD','SILVER','METALS'].includes(type))shape=<><path d="m6 8-3 11h18L18 8H6Zm0 0 6-5 6 5M8 8l-1 7h10l-1-7"/></>;
 else if(['LAND','INVESTMENT_LAND'].includes(type))shape=<><path d="m3 16 9-5 9 5-9 5-9-5ZM5 12V6m0 0 8-3v6l-8 3Z"/></>;
 else if(['BUILDING','REAL_ESTATE','PROPERTY','INVESTMENT_PROPERTY','DEVELOPMENT_PROPERTY'].includes(type))shape=building;
 else if(['STOCK','FUND','EQUITY_INVESTMENT','INVESTMENT'].includes(type))shape=<><path d="M3 21h18M5 17v-5m6 5V8m6 9V4M3 8l6-4 5 2 7-4"/></>;
 else if(['BOND','SUKUK','SUKUK_BOND','LICENSE'].includes(type))shape=<><path d="M5 3h14v18l-4-2-3 2-3-2-4 2V3ZM8 7h8M8 11h8M8 15h4"/></>;
 else if(type==='VEHICLE')shape=<><path d="m5 7 2-4h10l2 4 2 3v8H3v-8l2-3Zm0 0h14M3 12h18M6 15h2m8 0h2M5 18v3m14-3v3"/></>;
 else if(['SOFTWARE','IT_EQUIPMENT','INTANGIBLE','TRADEMARK','GOODWILL'].includes(type))shape=<><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M7 21h10m-5-4v4M9 8l-3 3 3 3m6-6 3 3-3 3"/></>;
 else if(['RECEIVABLE','LOAN_RECEIVABLE','OTHER_RECEIVABLE','ADVANCE','PREPAYMENT'].includes(type))shape=<><circle cx="8" cy="7" r="3"/><path d="M2 21v-3a6 6 0 0 1 12 0v3M16 8h6m-3-3 3 3-3 3M16 17h6"/></>;
 else if(['MACHINERY','PPE','WORK_IN_PROGRESS'].includes(type))shape=<><path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3H9Z"/><circle cx="12" cy="12" r="3"/></>;
 else if(['INVENTORY','RAW_MATERIAL','FINISHED_GOODS','TRADING_INVENTORY'].includes(type))shape=box;
 else shape=<><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h4"/></>;
 return <span className="asset-type-glyph" aria-hidden="true"><span className="asset-type-glyph-legacy">{fallback}</span><svg className="asset-type-glyph-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{shape}</svg></span>;
}
