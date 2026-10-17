/** Named references to the official, theme-scoped CSS palette. No page-local colors. */
export const yaqeenChartColors={navy:'var(--yq-primary-navy)',secondary:'var(--yq-secondary-navy)',gold:'var(--yq-royal-gold)',lightGold:'var(--yq-light-gold)',border:'var(--yq-border)',surface:'var(--yq-card)'} as const;
export const yaqeenAllocationColors=[yaqeenChartColors.navy,yaqeenChartColors.gold,yaqeenChartColors.secondary,yaqeenChartColors.lightGold,yaqeenChartColors.border] as const;
export type YaqeenTone='neutral'|'positive'|'warning'|'negative';
export function invoiceTone(status?:string):YaqeenTone{switch(status){case 'SETTLED':case 'PAID':return 'positive';case 'PARTIAL':case 'PARTIALLY_SETTLED':return 'warning';case 'OVERDUE':return 'negative';default:return 'neutral';}}
export function budgetTone(actual:number,budget:number,direction?:'higher'|'lower'):YaqeenTone{if(!direction||!Number.isFinite(actual)||!Number.isFinite(budget)||budget<=0)return 'neutral';return (direction==='higher'?actual>=budget:actual<=budget)?'positive':'negative';}
