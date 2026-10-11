import {describe,it,expect} from 'vitest';
import {assessmentActions} from '../lib/assessment-actions';

describe('assessment action protection',()=>{
  const preview={id:'p',hawl_cycle_id:'c',assessment_kind:'RECALCULATION',status:'CALCULATED'};
  const closed={id:'c',status:'CLOSED',assessment_id:'f',final_assessment_id:'f',final_zakat_due:45000};
  it('allows an unused historical preview in a closed cycle',()=>{
    expect(assessmentActions(preview,closed,false)).toMatchObject({can_delete:true,can_edit:false});
  });
  it('protects final, funded, missing-cycle and closed-current records',()=>{
    expect(assessmentActions({...preview,id:'f'},closed,false).can_delete).toBe(false);
    expect(assessmentActions(preview,closed,true).can_delete).toBe(false);
    expect(assessmentActions(preview,null,false).can_delete).toBe(false);
    expect(assessmentActions(preview,{...closed,assessment_id:'p'},false).can_delete).toBe(false);
    expect(assessmentActions({...preview,status:'CONFIRMED'},closed,false).can_delete).toBe(false);
  });
  it('only edits the current open snapshot and never shows cancelled records as removable',()=>{
    const open={id:'c',status:'ACTIVE',assessment_id:'p'};
    expect(assessmentActions(preview,open,false).can_edit).toBe(true);
    expect(assessmentActions({...preview,superseded_by:'n'},open,false).can_edit).toBe(false);
    expect(assessmentActions({...preview,status:'CANCELLED'},open,false).can_delete).toBe(false);
  });
});
