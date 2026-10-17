'use client';
import {useId} from 'react';
/** Alpha artwork; the display filter adapts dark lettering without a background plate. */
export default function YaqeenBrand({compact=false,dark=false}:{compact?:boolean;dark?:boolean}){const id=useId();return <span className={`yaqeen-brand-art ${compact?'is-compact':''} ${dark?'on-dark':''}`} role="img" aria-label="يقين الأعمال | YAQEEN BUSINESS"><svg width="0" height="0" aria-hidden="true"><defs><filter id={id} colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values="0 0 -0.6 0 1 0 0 -1 0 1 0 0 -1.85 0 1 0 0 0 1 0"/></filter></defs></svg><img style={dark?{filter:`url(#${id})`}:undefined} src="/brand/yaqeen-logo-transparent.webp" width="1628" height="966" alt=""/></span>}
