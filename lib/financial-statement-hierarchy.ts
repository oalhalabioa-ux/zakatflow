export type HierarchyRow={id:string;parentId?:string};
/** Index once per data/locale change. Supports nested folds without losing inner state. */
export function statementHierarchy(rows:HierarchyRow[]){
 const byId=new Map(rows.map((r,index)=>[r.id,{row:r,index}]));
 if(byId.size!==rows.length)throw Error('DUPLICATE_STATEMENT_ROW');
 const ancestors=new Map<string,string[]>(),descendants=new Map<string,number[]>(),visiting=new Set<string>();
 function path(id:string):string[]{const cached=ancestors.get(id);if(cached)return cached;const entry=byId.get(id);if(!entry)throw Error('UNKNOWN_STATEMENT_PARENT');if(visiting.has(id))throw Error('CYCLIC_STATEMENT_HIERARCHY');visiting.add(id);const list=entry.row.parentId?[entry.row.parentId,...path(entry.row.parentId)]:[];ancestors.set(id,list);visiting.delete(id);return list}
 rows.forEach((row,index)=>{for(const parent of path(row.id)){const list=descendants.get(parent)??[];list.push(index);descendants.set(parent,list)}});
 return{ancestors,descendants,hidden:(id:string,collapsed:ReadonlySet<string>)=>(ancestors.get(id)??[]).some(parent=>collapsed.has(parent))};
}
