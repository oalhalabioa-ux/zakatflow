type Scope='PERSONAL'|'ORGANIZATION';
type Asset={id?:string;organization_id?:string|null;ownership_scope?:string|null;asset_type?:string;currency?:string};

export function transactionWorkspaceKey(scope:Scope,organization:string,group:boolean){
 return scope==='PERSONAL'?'PERSONAL':`ORGANIZATION:${organization}:${group?'GROUP':'COMPANY'}`;
}
export function transactionAssetInWorkspace(asset:Asset|undefined,scope:Scope,organizationIds:ReadonlySet<string>){
 if(!asset)return false;
 return scope==='PERSONAL'?!asset.organization_id&&asset.ownership_scope!=='ORGANIZATION':!!asset.organization_id&&organizationIds.has(asset.organization_id);
}
export function transactionCashAccounts<T extends Asset>(assets:T[],selected:Asset|undefined,scope:Scope,organizationIds:ReadonlySet<string>):T[]{
 if(!transactionAssetInWorkspace(selected,scope,organizationIds))return [];
 return assets.filter(asset=>['CASH','BANK'].includes(asset.asset_type??'')&&
  transactionAssetInWorkspace(asset,scope,organizationIds)&&
  (asset.organization_id??null)===(selected?.organization_id??null)&&asset.currency===selected?.currency);
}
