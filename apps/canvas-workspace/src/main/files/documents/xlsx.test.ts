import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { XLSX_MAX_ROWS_PER_SHEET, xlsxToMarkdown } from './xlsx';

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
  + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const workbook = (rows: string, extraRows = '') => zipSync({
  'xl/workbook.xml': strToU8(`<?xml version='1.0' encoding='UTF-8' standalone='yes'?><workbook ${NS}><sheets>`
    + '<sheet name="需求" sheetId="1" r:id="rId1"/><sheet name="Empty" sheetId="2" r:id="rId2"/></sheets></workbook>'),
  'xl/_rels/workbook.xml.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/>'
    + '<Relationship Id="rId2" Type="worksheet" Target="/xl/worksheets/sheet2.xml"/></Relationships>'),
  'xl/sharedStrings.xml': strToU8(`<sst ${NS}><si><t>模块</t></si><si><t>优先级</t></si>`
    + '<si><r><t>线</t></r><r><t>索</t></r><rPh><t>xiansuo</t></rPh></si></sst>'),
  'xl/worksheets/sheet1.xml': strToU8(`<worksheet ${NS}><sheetData>${rows}${extraRows}</sheetData></worksheet>`),
  'xl/worksheets/sheet2.xml': strToU8(`<worksheet ${NS}><sheetData/></worksheet>`),
});

const rows = '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>'
  + '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><f>1+1</f><v>2</v></c></row>'
  + '<row r="3"><c r="A3" t="inlineStr"><is><t>A|B</t></is></c><c r="C3" t="b"><v>1</v></c></row>';

describe('xlsxToMarkdown', () => {
  it('renders each sheet as a table with shared, inline, formula, and boolean values', () => {
    expect(xlsxToMarkdown(workbook(rows))).toBe([
      '## Sheet: 需求',
      '| 模块 | 优先级 |\n| --- | --- |\n| 线索 | 2 |\n| A\\|B | TRUE |',
      '## Sheet: Empty',
      '(empty)',
    ].join('\n\n'));
  });

  it('cuts long sheets and says how many rows were left out', () => {
    const many = Array.from({ length: XLSX_MAX_ROWS_PER_SHEET + 2 }, (_, index) => (
      `<row r="${index + 4}"><c r="A${index + 4}"><v>${index}</v></c></row>`
    )).join('');
    expect(xlsxToMarkdown(workbook(rows, many))).toContain('(5 more rows not shown)');
  });

  it('shows date-formatted numbers as dates and uncached formulas as formulas', () => {
    const styles = `<styleSheet ${NS}><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy/m/d h:mm"/></numFmts>`
      + '<cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>';
    const dated = '<row r="1"><c r="A1" t="inlineStr"><is><t>日期</t></is></c><c r="B1" t="inlineStr"><is><t>工时</t></is></c></row>'
      + '<row r="2"><c r="A2" s="1"><v>46346</v></c><c r="B2"><f>C2*2</f></c></row>'
      + '<row r="3"><c r="A3" s="2"><v>46346.5</v></c><c r="B3" s="0"><v>46346</v></c></row>';
    const bytes = zipSync({ ...unzipSync(workbook(dated)), 'xl/styles.xml': strToU8(styles) });
    expect(xlsxToMarkdown(bytes)).toContain(
      '| 日期 | 工时 |\n| --- | --- |\n| 2026-11-20 | =C2\\*2 |\n| 2026-11-20 12:00 | 46346 |',
    );
  });

  it('uses the 1904 date system when the workbook asks for it', () => {
    const styles = `<styleSheet ${NS}><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`;
    const dated = '<row r="1"><c r="A1" t="inlineStr"><is><t>日期</t></is></c></row><row r="2"><c r="A2" s="1"><v>1</v></c></row>';
    const files = unzipSync(workbook(dated));
    const book = new TextDecoder().decode(files['xl/workbook.xml']).replace('<sheets>', '<workbookPr date1904="1"/><sheets>');
    const bytes = zipSync({ ...files, 'xl/workbook.xml': strToU8(book), 'xl/styles.xml': strToU8(styles) });
    expect(xlsxToMarkdown(bytes)).toContain('| 1904-01-02 |');
  });

  it('says how many cells right of column CV were left out', () => {
    const wide = '<row r="1"><c r="CW1" t="inlineStr"><is><t>远</t></is></c></row>';
    const markdown = xlsxToMarkdown(workbook(wide));
    expect(markdown).toContain('## Sheet: 需求\n\n(1 cell right of column CV not shown)');
  });

  it('rejects files that are not workbooks', () => {
    expect(() => xlsxToMarkdown(zipSync({ 'a.txt': strToU8('a') }))).toThrow();
  });
});
