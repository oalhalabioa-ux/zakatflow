insert into zakat_methods(code,name_ar,name_en,description_ar,description_en,calendar_type,zakat_rate,version) values
('INDEPENDENT_LOTS','حول مستقل لكل دفعة','Independent Lots','كل دفعة مؤهلة لها حول مستقل وفق القواعد المعتمدة.','Each qualifying lot has its own Hawl under the selected ruleset.','HIJRI',0.025,'1.0'),
('UNIFIED_HAWL','حول موحد','Unified Hawl','منهجية الحول الموحد، مع قواعد قابلة للمراجعة.','Unified Hawl methodology with configurable reviewable rules.','HIJRI',0.025,'1.0')
on conflict(code) do nothing;
