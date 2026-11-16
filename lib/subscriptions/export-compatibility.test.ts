import { it, expect } from 'vitest';
import ExcelJS from 'exceljs';

it('preserves an Arabic assessment Excel export through ZIP serialization and reload', async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('التقييم اليدوي');
  sheet.views = [{ rightToLeft: true }];
  sheet.addRow(['البند', 'القيمة']);
  sheet.addRow(['النقدية', 1250.75]);
  const bytes = await book.xlsx.writeBuffer();
  const restored = new ExcelJS.Workbook();
  await restored.xlsx.load(bytes);
  const result = restored.getWorksheet('التقييم اليدوي')!;
  expect(result.getCell('A2').value).toBe('النقدية');
  expect(result.getCell('B2').value).toBe(1250.75);
  expect(result.views[0].rightToLeft).toBe(true);
});
