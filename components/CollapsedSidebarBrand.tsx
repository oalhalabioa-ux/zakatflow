import type {AppearanceTheme} from '../lib/appearance';
/** Original supplied artwork. The viewport omits transparent margins without altering pixels. */
export default function CollapsedSidebarBrand({theme}:{theme:AppearanceTheme}){
 const variant=theme==='yaqeen-business'?'03_white_gold':theme==='classic'?'01_ivory_gold':'02_navy_gold';
 return <svg className="collapsed-sidebar-brand" viewBox="273 253 478 517" width="40" height="44" aria-hidden="true" focusable="false"><image href={`/brand/sidebar/${variant}.png`} width="1024" height="1024"/></svg>;
}
