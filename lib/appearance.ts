/** Appearance only. Never changes workspace, organization or permissions. */
export const appearanceThemes=['classic','modern','elegant','yaqeen-business'] as const;
export type AppearanceTheme=typeof appearanceThemes[number];
export const defaultAppearance:AppearanceTheme='yaqeen-business';
export function resolveAppearance(value:string|null):AppearanceTheme{return appearanceThemes.includes(value as AppearanceTheme)?value as AppearanceTheme:defaultAppearance;}
