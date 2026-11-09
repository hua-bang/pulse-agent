import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { docxToMarkdown } from './docx';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
  + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

// Word writes a single-quoted XML declaration, which some parsers reject.
const docx = (body: string, extra: Record<string, string> = {}): Uint8Array => zipSync({
  'word/document.xml': strToU8(`<?xml version='1.0' encoding='UTF-8' standalone='yes'?>\r\n<w:document ${W}><w:body>${body}<w:sectPr/></w:body></w:document>`),
  ...Object.fromEntries(Object.entries(extra).map(([name, xml]) => [name, strToU8(xml)])),
});

const run = (text: string, props = '') => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const para = (content: string, pPr = '') => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${content}</w:p>`;

const styles = `<?xml version="1.0"?><w:styles ${W}>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>
  <w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="20"><w:name w:val="标题 2 字符"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>
</w:styles>`;

const numbering = `<?xml version="1.0"?><w:numbering ${W}>
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl>
    <w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId9" Type="hyperlink" Target="https://example.com/crm" TargetMode="External"/>
</Relationships>`;

const listItem = (text: string, numId: number, ilvl = 0) => para(
  run(text),
  `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>`,
);

describe('docxToMarkdown', () => {
  it('keeps headings, lists, emphasis, links, and tables from a Word document', () => {
    const body = [
      para(run('成熟 CRM 功能画像'), '<w:pStyle w:val="Title"/>'),
      para(run('一、背景'), '<w:pStyle w:val="1"/>'),
      para(run('需求：', '<w:b/>') + run('与业主对齐 ') + run('核心', '<w:i/>') + run('能力。')),
      para(''),
      para(run('客户管理'), '<w:pStyle w:val="20"/>'),
      listItem('线索', 1),
      listItem('公海池', 1, 1),
      listItem('商机', 1),
      listItem('确认范围', 2),
      listItem('排期', 2),
      para(`<w:hyperlink r:id="rId9">${run('参考链接')}</w:hyperlink>`),
      para(`<w:ins>${run('新增')}</w:ins><w:del><w:r><w:delText>删掉</w:delText></w:r></w:del>`),
      `<w:tbl>
        <w:tr><w:tc>${para(run('模块'))}</w:tc><w:tc>${para(run('说明'))}</w:tc></w:tr>
        <w:tr><w:tc>${para(run('线索'))}</w:tc><w:tc>${para(run('A|B'))}${para(run('第二行'))}</w:tc></w:tr>
      </w:tbl>`,
    ].join('');

    const markdown = docxToMarkdown(docx(body, {
      'word/styles.xml': styles,
      'word/numbering.xml': numbering,
      'word/_rels/document.xml.rels': rels,
    }));

    expect(markdown).toBe([
      '# 成熟 CRM 功能画像',
      '# 一、背景',
      '**需求**：与业主对齐 *核心*能力。',
      '## 客户管理',
      '- 线索\n    - 公海池\n- 商机\n1. 确认范围\n2. 排期',
      '[参考链接](https://example.com/crm)',
      '新增',
      '| 模块 | 说明 |\n| --- | --- |\n| 线索 | A\\|B 第二行 |',
    ].join('\n\n'));
  });

  it('works without styles or numbering parts and escapes Markdown characters', () => {
    expect(docxToMarkdown(docx(para(run('a*b_c')) + para('<w:r><w:t>x</w:t><w:br/><w:t>y</w:t></w:r>'))))
      .toBe('a\\*b\\_c\n\nx  \ny');
  });

  it('keeps literal Markdown syntax in Word text as plain text', () => {
    const lines = ['# 不是标题', '- 不是列表', '1. 不是编号', '---', '&copy; 2026', '> 引用'];
    expect(docxToMarkdown(docx(lines.map((line) => para(run(line.replace(/&/g, '&amp;').replace(/>/g, '&gt;')))).join(''))))
      .toBe('\\# 不是标题\n\n\\- 不是列表\n\n1\\. 不是编号\n\n\\---\n\n\\&copy; 2026\n\n\\> 引用');
  });

  it('percent-encodes parentheses in link targets', () => {
    const linkRels = rels.replace('https://example.com/crm', 'https://example.com/a)b (c');
    expect(docxToMarkdown(docx(para(`<w:hyperlink r:id="rId9">${run('链接')}</w:hyperlink>`), {
      'word/_rels/document.xml.rels': linkRels,
    }))).toBe('[链接](https://example.com/a%29b%20%28c)');
  });

  it('keeps counting a numbered list across a paragraph between its items', () => {
    const body = listItem('第一步', 2) + para(run('说明')) + listItem('第二步', 2);
    expect(docxToMarkdown(docx(body, { 'word/numbering.xml': numbering })))
      .toBe('1. 第一步\n\n说明\n\n2. 第二步');
  });

  it('keeps configured starting numbers from w:start and w:startOverride', () => {
    const startNumbering = `<w:numbering ${W}>
      <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="3"/><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
      <w:num w:numId="2"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="5"/></w:lvlOverride></w:num>
    </w:numbering>`;
    const body = listItem('甲', 1) + listItem('乙', 1) + para(run('说明')) + listItem('丙', 2) + listItem('丁', 2);
    expect(docxToMarkdown(docx(body, { 'word/numbering.xml': startNumbering })))
      .toBe('3. 甲\n4. 乙\n\n说明\n\n5. 丙\n6. 丁');
  });

  it('rejects files that are not Word documents', () => {
    expect(() => docxToMarkdown(zipSync({ 'readme.txt': strToU8('hi') }))).toThrow();
    expect(() => docxToMarkdown(strToU8('not a zip'))).toThrow();
  });

  it('reads stored (uncompressed) zip entries too', () => {
    const xml = `<w:document ${W}><w:body>${para(run('原文'))}</w:body></w:document>`;
    expect(docxToMarkdown(zipSync({ 'word/document.xml': strToU8(xml) }, { level: 0 }))).toBe('原文');
  });
});
