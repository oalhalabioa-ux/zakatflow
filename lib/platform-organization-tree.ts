type OrganizationNode={id:string;name:string;organization_kind?:string;parent_organization_id?:string|null;sort_order?:number|null};
// Parents precede their children, independent of Arabic alphabetical order.
// Membership-filtered children with inaccessible parents remain selectable roots.
export function platformOrganizationTree<T extends OrganizationNode>(organizations:T[]) {
 const ids=new Set(organizations.map(o=>o.id)),visited=new Set<string>();
 const compare=(a:T,b:T)=>(a.organization_kind==='HOLDING'?0:1)-(b.organization_kind==='HOLDING'?0:1)||Number(a.sort_order??100)-Number(b.sort_order??100)||a.name.localeCompare(b.name,'ar');
 const result:Array<{organization:T;depth:number}>=[];
 function visit(o:T,depth:number){if(visited.has(o.id))return;visited.add(o.id);result.push({organization:o,depth});organizations.filter(x=>x.parent_organization_id===o.id).sort(compare).forEach(x=>visit(x,depth+1));}
 organizations.filter(o=>!o.parent_organization_id||!ids.has(o.parent_organization_id)).sort(compare).forEach(o=>visit(o,0));
 organizations.filter(o=>!visited.has(o.id)).sort(compare).forEach(o=>visit(o,0));
 return result;
}
