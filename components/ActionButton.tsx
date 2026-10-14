'use client';
import type {ButtonHTMLAttributes,ReactNode} from 'react';
import {InvoiceIcon,type InvoiceIconName} from './invoice-action-label';
export type ActionIcon=InvoiceIconName|'details'|'close'|'save'|'history'|'reverse'|'plus'|'filter'|'download'|'operations'|'bank'|'certificate'|'investment'|'trend';
export function ActionIconGlyph({name}:{name:ActionIcon}){
 const paths:Partial<Record<ActionIcon,ReactNode>>={bank:<><path d="m3 8 9-5 9 5H3ZM4 21h16M5 18h14M7 10v6M12 10v6M17 10v6"/></>,certificate:<><path d="M5 3h14v14H5zM8 7h8M8 10h5"/><circle cx="12" cy="16" r="3"/><path d="m10 19-1 3 3-1 3 1-1-3"/></>,investment:<><path d="M4 21V8l8-5 8 5v13H4ZM9 21v-5h6v5M8 9h1M15 9h1M8 12h1M15 12h1"/></>,trend:<><path d="M3 20h18M4 16l6-6 4 3 6-8M15 5h5v5"/></>,details:<><path d="M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h5"/></>,close:<path d="m6 6 12 12M18 6 6 18"/>,save:<><path d="M4 3h13l3 3v15H4zM8 3v6h8V3M8 21v-8h8v8"/></>,history:<><path d="M3 11a9 9 0 1 1 3 8M3 4v7h7M12 7v5l3 2"/></>,reverse:<><path d="m7 4-4 4 4 4M3 8h11a7 7 0 0 1 0 14"/></>,plus:<path d="M12 4v16M4 12h16"/>,filter:<path d="M3 4h18l-7 8v8l-4-2v-6z"/>,download:<><path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/></>,operations:<><circle cx="12" cy="12" r="8"/><path d="m8 12 3 3 5-6M12 1v3M12 20v3M1 12h3M20 12h3"/></>};
 return paths[name]?<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>:<InvoiceIcon name={name as InvoiceIconName}/>;
}
export default function ActionButton({icon,label,showLabel=false,className='',children,...props}:ButtonHTMLAttributes<HTMLButtonElement>&{icon:ActionIcon;label:string;showLabel?:boolean}){
 return <span className="action-button-wrap"><button type="button" {...props} aria-label={label} title={label} className={`btn secondary action-button ${showLabel?'action-with-label':''} ${className}`}><ActionIconGlyph name={icon}/>{showLabel&&<span>{label}</span>}{children}</button><span className="action-hover-label" aria-hidden="true">{label}</span></span>;
}
