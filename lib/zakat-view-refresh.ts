import {revalidatePath} from 'next/cache';
export function invalidateZakatViews(){
 for(const page of ['dashboard','assets','assessments','payments'])revalidatePath(`/[locale]/${page}`,'page');
}
