import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ExcelJS from 'exceljs';

export async function verifyInvoiceReporting({app, ownerContext, otherContext, bankName}) {
  const end = '2026-02-08';
  const start = '2026-02-01';
  const settlement = '2026-02-06';
  const endpoint = app+'/api/financial-reporting/personal';
  async function report(context, from=start, to=end) {
    const response = await context.request.get(endpoint,{params:{from,to}});
    assert.equal(response.status(),200,await response.text());
    const data = await response.json();
    assert.equal(data.scope,'PERSONAL');
    assert.equal(data.from,from);
    assert.equal(data.to,to);
    return data;
  }
  const full = await report(ownerContext);
  const position = full.positions.find(row=>row.currency==='SAR');
  assert.equal(position.cash,'4000.00');
  assert.equal(position.receivables,'7500.00');
  assert.deepEqual(full.professionalIncome,{currency:'SAR',net:'10000.00',tax:'1500.00',count:1});
  const cash = full.cashAccounts.find(account=>account.name===bankName);
  assert.deepEqual([cash.opening,cash.inflows,cash.outflows,cash.closing,cash.movementCount],
    ['0.00','4000.00','0.00','4000.00',1]);

  // A period whose only activity is collection must not recognize invoice income again.
  const onSettlement = await report(ownerContext,settlement,settlement);
  assert.deepEqual(onSettlement.professionalIncome,{currency:'SAR',net:'0',tax:'0',count:0});
  assert.equal(onSettlement.cashAccounts.find(account=>account.id===cash.id).inflows,'4000.00');
  const beforeSettlement = await report(ownerContext,start,'2026-02-05');
  assert.deepEqual(beforeSettlement.professionalIncome,full.professionalIncome);
  assert.equal(beforeSettlement.cashAccounts.find(account=>account.id===cash.id).inflows,'0.00');
  const foreign = await report(otherContext);
  assert.deepEqual(foreign.professionalIncome,{currency:'SAR',net:'0',tax:'0',count:0});
  assert.ok(!foreign.cashAccounts.some(account=>account.id===cash.id));
  const mixedScope = await ownerContext.request.get(endpoint,{params:{from:start,to:end,scope:'ORGANIZATION'}});
  assert.equal(mixedScope.status(),400);

  const page = await ownerContext.newPage();
  page.setDefaultTimeout(20000);
  const positionRow = ['SAR','4000.00','7500.00'];
  const bankRow = [bankName,'SAR','0.00','4000.00','0.00','4000.00','4000.00'];
  const csvRow = fields=>fields.map(field=>'"'+field+'"').join(',');
  for (const locale of ['ar','en']) {
    const ar = locale==='ar';
    await page.goto(app+'/'+locale+'/financial-reports?scope=PERSONAL',{waitUntil:'domcontentloaded',timeout:90000});
    const main = page.locator('main.fs-personal-reports');
    await main.getByLabel(ar?'بداية الفترة':'Period start').fill(start);
    await main.getByLabel(ar?'نهاية الفترة':'Period end').fill(end);
    const positionCard = main.locator('.fs-personal-card');
    await positionCard.getByText('7,500.00 SAR',{exact:true}).waitFor();
    await positionCard.getByText('4,000.00 SAR',{exact:true}).waitFor();
    const cashRow = main.getByRole('row').filter({hasText:bankName});
    await cashRow.getByRole('cell',{name:'4,000.00',exact:true}).first().waitFor();

    const csvEvent = page.waitForEvent('download');
    await main.getByRole('button',{name:'CSV',exact:true}).click();
    const csv = await csvEvent;
    assert.equal(await csv.failure(),null);
    const csvText = await readFile(await csv.path(),'utf8');
    assert.ok(csvText.includes(csvRow(positionRow)+','));
    assert.ok(csvText.split('\r\n').includes(csvRow(bankRow)));
    assert.ok(csvText.includes(csvRow([ar?'الذمم المدينة':'Receivables'])));

    const excelEvent = page.waitForEvent('download');
    await main.getByRole('button',{name:'Excel',exact:true}).click();
    const excel = await excelEvent;
    assert.equal(await excel.failure(),null);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(await excel.path());
    const sheet = workbook.worksheets[0];
    const rows = [];
    sheet.eachRow(row=>rows.push(row.values.slice(1)));
    assert.equal(Boolean(sheet.views[0].rightToLeft),ar);
    assert.ok(rows.some(row=>positionRow.every((cell,i)=>row[i]===cell)));
    assert.deepEqual(rows.find(row=>row[0]===bankName),bankRow);

    await main.getByRole('tab',{name:ar?/الدخل والمصروفات/:/Income & expenses/}).click();
    const incomeLabel = ar?'الإيراد المهني المثبت':'Recognized professional income';
    await main.getByRole('heading',{name:incomeLabel,exact:true}).waitFor();
    const incomePanel = main.getByRole('heading',{name:incomeLabel,exact:true}).locator('..');
    const income = await incomePanel.innerText();
    assert.match(income,/10000\.00 SAR/);
    assert.match(income,/1500\.00 SAR/);
    console.log('Invoice report income export control '+locale+' enabled='+
      await main.getByRole('button',{name:'CSV',exact:true}).isEnabled());
  }
  await page.close();
  console.log('PASS invoice report gross receivable, cash at settlement, one period income, tax, AR/EN CSV and Excel overview, and owner/scope isolation');
}
