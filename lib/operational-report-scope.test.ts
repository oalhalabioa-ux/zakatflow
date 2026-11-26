import {expect,it} from 'vitest';
import {operationalReportQuery,readOperationalReportScope} from './operational-report-scope';
const org='20000000-0000-4000-8000-000000000001';
it('strips all organization fields from personal downloads and print links',()=>{
 expect(operationalReportQuery({scope:'PERSONAL',organization:org,group:true,entity:'stale'},true)?.toString()).toBe('scope=PERSONAL');
});
it('round-trips company/group print links and API requests to the same exact scope',()=>{
 const selection={scope:'ORGANIZATION' as const,organization:org,group:true,entity:''};
 const print=operationalReportQuery(selection,true)!,api=operationalReportQuery(selection)!;
 expect(print.get('organization')).toBe(org);expect(print.get('level')).toBe('GROUP');
 expect(readOperationalReportScope(print)).toEqual(readOperationalReportScope(api));
 expect(operationalReportQuery({...selection,organization:''})).toBeNull();
});
it('rejects mixed personal-company, duplicate, conflicting and malformed scope inputs',()=>{
 for(const query of ['scope=PERSONAL&organization_id='+org,'scope=ORGANIZATION','scope=INVALID','scope=PERSONAL&scope=ORGANIZATION','scope=ORGANIZATION&organization_id='+org+'&organization=20000000-0000-4000-8000-000000000002','scope=ORGANIZATION&organization_id='+org+'&group=0&level=GROUP'])expect(()=>readOperationalReportScope(new URLSearchParams(query))).toThrow();
});
