import {redirect} from 'next/navigation';
import {legacyAssessmentHref} from '@/lib/legacy-workspace-navigation';

/** The legacy account-wide consolidation must not appear as a selected company's result. */
export default async function Enterprise({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const[{locale},query]=await Promise.all([params,searchParams]);
 redirect(legacyAssessmentHref(locale,query));
}
