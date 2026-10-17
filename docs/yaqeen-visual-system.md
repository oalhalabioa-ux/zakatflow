# Yaqeen Business — official visual system

Approved by the user on 2026-10-17. The source of truth is `app/yaqeen-tokens.css`, scoped to `.theme-yaqeen-business`. Every Yaqeen module must consume these tokens instead of introducing local blue, yellow or green shades. Classic, Modern and Elegant remain independent.

| Token | Color | Role |
|---|---|---|
| Primary Navy | #0F2D4A | Sidebar, headings, financial amounts |
| Secondary Navy | #24496A | Supporting text and secondary chart series |
| Royal Gold | #BD8B3C | Primary actions and active controls |
| Deep Green | #176346 | Positive results and completed payments only |
| Light Gold | #EAD7B4 | Quiet icon and pending-state surfaces |
| Light Green | #E6F2EA | Positive-state surfaces only |
| Page Background | #F8F9FB | Page canvas |
| Cards | #FFFFFF | Cards, inputs and dialogs |
| Borders | #E4EAF0 | Dividers and chart grid |

Visual balance is an approximate composition target: 70% light surfaces, 20% navy, 7% gold, 3% green/status colors. Financial figures stay navy, including gains; positive meaning may appear in the corresponding icon or state badge. Green is never used as a generic allocation category, for an unpaid invoice or solely because a budget value exists.

Chart series and allocations consume CSS token references from `lib/yaqeen-dashboard-presentation.ts`. Income/inflows are navy and spending/outflows are gold. Budget favorability requires a known direction (higher for revenue, lower for spending); unavailable or unknown values stay neutral. Existing application dark red (#B42318) is reserved for negative/error states; it is not a brand accent.

Keep dashboards responsive with 6 KPI columns on wide screens, 3 on medium screens and 2 on mobile, retaining readable card content.
