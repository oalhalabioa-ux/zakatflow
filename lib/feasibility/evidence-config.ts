export const feasibilityEvidenceEnabled=()=>process.env.FEASIBILITY_EVIDENCE_QA==='true'&&
 process.env.NEXT_PUBLIC_FEASIBILITY_STUDIES==='true'&&process.env.NEXT_PUBLIC_FEASIBILITY_CLOUD_QA==='true';
