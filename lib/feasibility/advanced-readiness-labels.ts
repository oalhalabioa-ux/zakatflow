export const advancedIssueNames:Record<string,[string,string]>={
 INVALID_ASSUMPTIONS:['تحقق من سلامة الأرقام والمعدلات.','Check the input values and rates.'],
 CAPACITY_INCOMPLETE:['أدخل الطاقة والاستغلال والإنتاج الصالح للبيع.','Enter capacity, utilization and saleable yield.'],
 BASIC_INPUT_MISSING:['أدخل التكاليف الاستثمارية والسعر والحجم.','Enter CAPEX, price and sales volume.'],
 USEFUL_LIVES_MISSING:['يجب تحديد العمر المفيد للفئات الرأسمالية ذات المبالغ.','Enter useful lives for funded CAPEX categories.'],
 DEBT_TERM_MISSING:['أدخل مدة سداد الدين.','Enter loan repayment term.'],
 DEBT_EXCEEDS_HORIZON:['مدة القرض أكبر من فترة الدراسة.','Debt term exceeds forecast horizon.'],
 DEBT_OVERFUNDED:['القروض أعلى من احتياجات النقد الأولية.','Loans exceed initial cash requirements.'],
 NONFINITE_PROJECTION:['الأرقام الناتجة غير صالحة؛ راجع الافتراضات.','Projection produces invalid values.'],
 FUNDING_GAP:['نقص تمويل نقدي؛ عائد المساهمين غير متاح.','Funding gap: equity returns are withheld.'],
 UNMODELED_SURPLUS:['هناك فائض تمويل غير نمذجته الدراسة.','Funding surplus is not modeled.'],
 LAND_VALUE_REQUIRED:['الأرض المنقولة يجب أن تكون ذات قيمة مقدرة موجبة.','Transferred land requires a positive appraised value.'],
 EQUITY_UNFUNDED:['لا توجد مساهمة اقتصادية موجبة لحقوق الملكية.','No positive equity contribution exists.'],
 NEGATIVE_WORKING_CAPITAL:['رأس المال العامل سالب بسبب ائتمان الموردين؛ يتطلب ذلك نموذج ائتمان منفصلًا.','Negative working capital requires a separate supplier-credit model.']
};
