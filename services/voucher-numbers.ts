/** Attach only numbers visible to the current user under voucher_numbers RLS. */
export async function withVoucherNumbers<T>(supabase:any,payload:T):Promise<T>{
 const ids=new Set<string>();const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 function collect(v:any):void{if(typeof v==='string'&&uuid.test(v))ids.add(v);else if(Array.isArray(v))v.forEach(collect);else if(v&&typeof v==='object')Object.values(v).forEach(collect)}
 collect(payload);if(ids.size>50000)throw Error('REPORT_TOO_LARGE');
 const list=[...ids],lookup=new Map<string,Map<string,string>>();
 for(let i=0;i<list.length;i+=150){const {data,error}=await supabase.from('voucher_numbers').select('source_table,source_id,document_number').in('source_id',list.slice(i,i+150));if(error)throw error;for(const row of data??[]){const m=lookup.get(row.source_id)??new Map<string,string>();m.set(row.source_table,row.document_number);lookup.set(row.source_id,m)}}
 function unique(id:any){const m=lookup.get(id);if(!m)return undefined;const values=[...new Set(m.values())];return values.length===1?values[0]:undefined}
 function decorate(v:any):any{if(Array.isArray(v))return v.map(decorate);if(!v||typeof v!=='object')return v;const out:any={};for(const [k,x] of Object.entries(v))out[k]=decorate(x);const found=lookup.get(v.id);if(found){out.document_sequences=Object.fromEntries(found);const n=unique(v.id);if(n)out.document_sequence=n}const links:Record<string,string>={};for(const [k,x] of Object.entries(v))if(k.endsWith('_id')){const n=unique(x);if(n)links[k]=n}if(Object.keys(links).length)out.document_links=links;if(v.voucherSourceTable&&v.voucherSourceId&&!v.voucherOfficial){const n=lookup.get(v.voucherSourceId)?.get(v.voucherSourceTable);if(n){out.voucherNumber=n;out.document_sequence=n}}return out}
 return decorate(payload);
}
