import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { pptxToMarkdown } from './pptx';

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
  + 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
  + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
const NOTES_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide';

const para = (text: string, lvl = 0) => `<a:p>${lvl ? `<a:pPr lvl="${lvl}"/>` : ''}<a:r><a:t>${text}</a:t></a:r></a:p>`;
const shape = (paragraphs: string, ph?: string) => '<p:sp><p:nvSpPr><p:cNvPr id="2" name="s"/><p:cNvSpPr/>'
  + `<p:nvPr>${ph === undefined ? '' : `<p:ph${ph ? ` type="${ph}"` : ''}/>`}</p:nvPr></p:nvSpPr>`
  + `<p:txBody>${paragraphs}</p:txBody></p:sp>`;
const slide = (shapes: string) => `<?xml version='1.0' encoding='UTF-8' standalone='yes'?>`
  + `<p:sld ${NS}><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld></p:sld>`;

const table = '<p:graphicFrame><a:graphic><a:graphicData><a:tbl>'
  + `<a:tr><a:tc><a:txBody>${para('模块')}</a:txBody></a:tc><a:tc><a:txBody>${para('状态')}</a:txBody></a:tc></a:tr>`
  + `<a:tr><a:tc><a:txBody>${para('线索')}</a:txBody></a:tc><a:tc><a:txBody>${para('完成')}</a:txBody></a:tc></a:tr>`
  + '</a:tbl></a:graphicData></a:graphic></p:graphicFrame>';

const deck = () => zipSync({
  'ppt/presentation.xml': strToU8(`<p:presentation ${NS}><p:sldIdLst>`
    + '<p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>'),
  'ppt/_rels/presentation.xml.rels': strToU8(`<Relationships ${REL_NS}>`
    + '<Relationship Id="rId2" Type="slide" Target="slides/slide1.xml"/>'
    + '<Relationship Id="rId3" Type="slide" Target="slides/slide2.xml"/></Relationships>'),
  // slide2 comes first in the deck even though its file number is higher.
  'ppt/slides/slide2.xml': strToU8(slide(
    shape(para('CRM 需求对齐'), 'ctrTitle') + shape(para('业主交流 V1.0'), 'subTitle'),
  )),
  'ppt/slides/slide1.xml': strToU8(slide(
    shape(para('功能画像'), 'title')
      + shape(para('客户管理') + para('公海池', 1) + para('# 不是标题'), '')
      + shape(para('附注文本框'))
      + table,
  )),
  'ppt/slides/_rels/slide1.xml.rels': strToU8(`<Relationships ${REL_NS}>`
    + `<Relationship Id="rId1" Type="${NOTES_TYPE}" Target="../notesSlides/notesSlide1.xml"/></Relationships>`),
  'ppt/notesSlides/notesSlide1.xml': strToU8(`<p:notes ${NS}><p:cSld><p:spTree>`
    + shape(para('1'), 'sldNum') + shape(para('讲清楚公海规则'), 'body')
    + '</p:spTree></p:cSld></p:notes>'),
});

describe('pptxToMarkdown', () => {
  it('reads slides in deck order with titles, bullets, tables, and notes', () => {
    expect(pptxToMarkdown(deck())).toBe([
      '## Slide 1: CRM 需求对齐',
      '- 业主交流 V1.0',
      '## Slide 2: 功能画像',
      '- 客户管理\n    - 公海池\n- \\# 不是标题',
      '附注文本框',
      '| 模块 | 状态 |\n| --- | --- |\n| 线索 | 完成 |',
      '**Notes**\n\n讲清楚公海规则',
    ].join('\n\n'));
  });

  it('rejects files that are not presentations', () => {
    expect(() => pptxToMarkdown(zipSync({ 'word/document.xml': strToU8('<x/>') }))).toThrow();
  });
});
