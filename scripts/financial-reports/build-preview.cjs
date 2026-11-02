const fs=require('fs'),path=require('path'),os=require('os'),{build}=require('esbuild');
(async()=>{
 const out=process.argv[2]||'docs/financial-reports/evidence/preview.html';
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yaqeen-financial-preview-'));
 const entry=path.resolve('components/financial-reports/FinancialReportsPilot.tsx');
 const result=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Pilot from ${JSON.stringify(entry)};createRoot(document.getElementById('root')).render(<Pilot/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:dir,minify:true,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
 let css=fs.readFileSync('app/yaqeen-brand.css','utf8').split('.yq-site')[0];
 css=css.replace(/url\('([^']+)'\)/g,(_,p)=>`url(data:font/woff2;base64,${fs.readFileSync('public'+p).toString('base64')})`);
 css+='*{box-sizing:border-box}body{margin:0}'+result.outputFiles.find(f=>f.path.endsWith('.css')).text;
 const js=result.outputFiles.find(f=>f.path.endsWith('.js')).text.replace(/<\/script/gi,'<\\/script');
 fs.mkdirSync(path.dirname(out),{recursive:true});
 fs.writeFileSync(out,`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>يقين الأعمال — معاينة لوحة التقارير</title><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`);
 console.log(out);fs.rmSync(dir,{recursive:true,force:true});
})();
