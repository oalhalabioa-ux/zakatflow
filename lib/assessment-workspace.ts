import type {WorkspaceScope} from './topbar-navigation';
import type {ManualZakatModel} from './manual-zakat-assessment';
export function assessmentWorkspaceSource(scope:WorkspaceScope,source:'REGISTER'|'MANUAL'){return scope==='ORGANIZATION'?'MANUAL':source;}
export function assessmentWorkspaceModel(scope:WorkspaceScope,corporateModel:'SIMPLE'|'SAUDI'):ManualZakatModel{return scope==='ORGANIZATION'?corporateModel:'PERSONAL';}

/** Cycle tools operate on the personal asset register only. */
export function showPersonalAssessmentCycleTools(page:string,scope:WorkspaceScope,source:string|null){return page==='assessments'&&scope==='PERSONAL'&&source!=='manual';}
