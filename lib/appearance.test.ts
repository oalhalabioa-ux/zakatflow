import {expect,it} from 'vitest';
import {appearanceThemes,resolveAppearance} from './appearance';
it('keeps every stored legacy choice and adds Yaqeen without renaming keys',()=>{expect(appearanceThemes).toEqual(['classic','modern','elegant','yaqeen-business']);for(const value of appearanceThemes)expect(resolveAppearance(value)).toBe(value)});
it('defaults only absent or unsupported preferences to Yaqeen',()=>{expect(resolveAppearance(null)).toBe('yaqeen-business');expect(resolveAppearance('unknown')).toBe('yaqeen-business')});
