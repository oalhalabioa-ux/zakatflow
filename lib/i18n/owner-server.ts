import {headers} from 'next/headers';
import type {Locale} from '../routing';
export async function ownerLocale(): Promise<Locale> {
 return (await headers()).get('x-yaqeen-locale') === 'en' ? 'en' : 'ar';
}
