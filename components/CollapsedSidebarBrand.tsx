'use client';
import {useId} from 'react';
import type {AppearanceTheme} from '../lib/appearance';
import BrandToneFilter from './BrandToneFilter';
/** Original supplied artwork; viewport excludes only the transparent margins. */
export default function CollapsedSidebarBrand({theme}:{theme:AppearanceTheme}){
 const id=useId();
 const color=theme==='elegant'?'#087653':theme==='modern'?'#4355C7':null;
 const variant=theme==='yaqeen-business'?'03_white_gold':theme==='classic'?'01_ivory_gold':'02_navy_gold';
 return <svg className="collapsed-sidebar-brand" viewBox="273 253 478 517" width="40" height="44" aria-hidden="true" focusable="false">{color&&<defs><BrandToneFilter id={id} color={color}/></defs>}<image href={`/brand/sidebar/${variant}.png`} width="1024" height="1024" filter={color?`url(#${id})`:undefined}/></svg>;
}
