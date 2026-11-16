import TeamAccessWorkspace from '@/components/settings/TeamAccessWorkspace';
export default async function Users({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<{organization?:string}>}){
 const [{locale},{organization}]=await Promise.all([params,searchParams]);
 return <TeamAccessWorkspace locale={locale} preferredOrg={organization}/>;
}
