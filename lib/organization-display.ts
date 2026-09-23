const normalizeArabicName=(value:string)=>value.normalize('NFKC').replace(/[\u064B-\u065F\u0670\u0640]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/[‐‑‒–—]/g,'-').replace(/\s+/g,' ').trim().toLowerCase();

const organizationTranslations:Record<string,string>={
 'شركة ليفانت القابضة':'Levant Holding',
 'ليفانت القابضة':'Levant Holding',
 'شركة ليفانت':'Levant Company',
 'ليفانت':'Levant',
 'شركة ليفانت القابضة - الادارة':'Levant Holding — Administration',
 'ليفانت القابضة - الادارة':'Levant Holding — Administration'
};

const costCenterTranslations:Record<string,string>={
 'الادارة':'Administration',
 'الادارة العامة':'Head Office',
 'الادارة الرئيسية':'Head Office',
 'المركز الرئيسي':'Head Office',
 'التشغيل':'Operations',
 'العمليات':'Operations',
 'الفرع':'Branch',
 'الفروع':'Branches',
 'مشاريع تشغيلية':'Operating Projects',
 'مشروعات تشغيلية':'Operating Projects',
 'الاستثمار':'Investment',
 'الاستثمارات':'Investments',
 'الخزينة ورأس المال العامل':'Treasury & Working Capital',
 'التمويل':'Financing'
};

const phrases:Array<[string,string]>=[
 ['للتطوير العقاري','for Real Estate Development'],
 ['لرأس المال العامل','for Working Capital'],
 ['رأس المال العامل','Working Capital'],
 ['مشاريع تشغيلية','Operating Projects'],
 ['مشروعات تشغيلية','Operating Projects'],
 ['الإدارة العامة','Head Office'],
 ['الادارة العامة','Head Office'],
 ['الإدارة الرئيسية','Head Office'],
 ['الادارة الرئيسية','Head Office'],
 ['القابضة','Holding'],
 ['المحدودة','Limited'],
 ['للتجارة','for Trading'],
 ['للاستثمار','for Investment'],
 ['الإدارة','Administration'],
 ['الادارة','Administration'],
 ['التشغيل','Operations'],
 ['العمليات','Operations'],
 ['المركز الرئيسي','Head Office'],
 ['الفرع','Branch'],
 ['الفروع','Branches'],
 ['الاستثمارات','Investments'],
 ['الاستثمار','Investment'],
 ['التطوير العقاري','Real Estate Development'],
 ['العقارية','Real Estate'],
 ['التجارية','Trading'],
 ['للخدمات','for Services'],
 ['للمقاولات','for Contracting'],
 ['السعودية','Saudi'],
 ['العربية','Arab'],
 ['الشرق الأوسط','Middle East'],
 ['المتحدة','United'],
 ['الصناعية','Industrial'],
 ['الخزينة','Treasury'],
 ['والخدمات','& Services'],
 ['والتجارة','& Trading'],
 ['مجموعة','Group'],
 ['شركة','Company']
];

const latinLetters:Record<string,string>={
 'ا':'a','أ':'a','إ':'i','آ':'aa','ب':'b','ت':'t','ث':'th','ج':'j','ح':'h','خ':'kh','د':'d','ذ':'dh','ر':'r','ز':'z','س':'s','ش':'sh','ص':'s','ض':'d','ط':'t','ظ':'z','ع':'','غ':'gh','ف':'f','ق':'q','ك':'k','ل':'l','م':'m','ن':'n','ه':'h','ة':'a','و':'w','ي':'y','ى':'a','ء':'','ؤ':'u','ئ':'i'
};

const transliterateArabic=(value:string)=>[...value].map(character=>latinLetters[character]??character).join('').replace(/\s+/g,' ').trim();

/** Human-readable English labels without changing the Arabic names stored in the database. */
export function organizationDisplayName(name:string,ar:boolean){
 if(ar||!name)return name;
 const normalized=normalizeArabicName(name);
 const exact=organizationTranslations[normalized];
 if(exact)return exact;
 let translated=name.trim();
 for(const [arabic,english] of phrases)translated=translated.replaceAll(arabic,english);
 return transliterateArabic(translated);
}

export function costCenterDisplayName(name:string,ar:boolean){
 if(ar||!name)return name;
 const normalized=normalizeArabicName(name);
 const exact=costCenterTranslations[normalized];
 if(exact)return exact;
 let translated=name.trim();
 for(const [arabic,english] of phrases)translated=translated.replaceAll(arabic,english);
 return transliterateArabic(translated);
}
