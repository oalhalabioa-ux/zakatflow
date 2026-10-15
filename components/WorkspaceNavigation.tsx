'use client';
import {createContext,useContext,useTransition,type ReactNode} from 'react';
import {useRouter} from 'next/navigation';
type Navigation={pending:boolean;navigate:(href:string,optimistic?:()=>void)=>void};
const Context=createContext<Navigation>({pending:false,navigate:()=>{}});
export function WorkspaceNavigationProvider({children}:{children:ReactNode}){
 const router=useRouter(),[pending,startTransition]=useTransition();
 function navigate(href:string,optimistic?:()=>void){startTransition(()=>{optimistic?.();router.push(href,{scroll:false})})}
 return <Context.Provider value={{pending,navigate}}>{children}</Context.Provider>;
}
export const useWorkspaceNavigation=()=>useContext(Context);
export function WorkspaceNavigationStatus({ar}:{ar:boolean}){const {pending}=useWorkspaceNavigation();return pending?<div className="corp-navigation-progress" role="status" aria-live="polite"><span aria-hidden="true"/>{ar?'جارٍ تحديث النطاق…':'Updating scope…'}</div>:null;}

export function WorkspaceContent({children}:{children:ReactNode}){const {pending}=useWorkspaceNavigation();return <main className="corp-content" aria-busy={pending} inert={pending}>{children}</main>;}
