import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=new URL('../../',import.meta.url);
export async function verifyFiles(){
 const manifest=JSON.parse(await readFile(new URL('supabase/migration-history.json',root),'utf8'));
 const files=(await readdir(new URL('supabase/migrations/',root))).filter(x=>x.endsWith('.sql')).sort();
 assert.deepEqual(files,manifest.entries.map(x=>x.path.split('/').at(-1)).sort(),'Unreviewed or missing canonical migration');
 for(const e of manifest.entries){const data=await readFile(new URL(e.path,root));
  assert.match(e.version,/^\d{14}$/);assert.match(e.name,/^[a-z0-9_]+$/);
  assert.equal(createHash('sha256').update(data).digest('hex'),e.file_sha256,e.path+' changed after reconciliation');
  if(!e.bootstrap_omission)assert.equal(createHash('md5').update(data).digest('hex'),e.installed_md5,e.path+' differs from installed SQL');
 }
 assert.equal(manifest.entries.filter(x=>x.bootstrap_omission).length,1);
 return manifest;
}
if(process.argv[1]===new URL(import.meta.url).pathname){const manifest=await verifyFiles();console.log('PASS canonical history: '+manifest.entries.length+' files; installed SQL digests match, one documented data-only omission');}
