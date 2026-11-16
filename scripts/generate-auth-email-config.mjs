// Produces a reviewable Management API payload on stdout. Does not call Supabase.
// Security notification enablement is intentionally excluded and needs separate approval.
import {readFile} from 'node:fs/promises';
const root=new URL('../supabase/templates/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('email-suite-manifest.json',root),'utf8'));
const patch={};
for(const item of manifest){
 const suffix=item.config+(item.kind==='security'?'_notification':'');
 patch['mailer_subjects_'+suffix]=(await readFile(new URL(item.name+'.subject.txt',root),'utf8')).trim();
 patch['mailer_templates_'+suffix+'_content']=await readFile(new URL(item.name+'.html',root),'utf8');
}
console.log(JSON.stringify(patch,null,2));
