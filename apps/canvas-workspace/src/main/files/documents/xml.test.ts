import { describe, expect, it } from 'vitest';
import { parseXmlElement } from './xml';

describe('parseXmlElement', () => {
  it('keeps prefixed and plain attributes with the same local name apart', () => {
    const root = parseXmlElement(
      "<?xml version='1.0' encoding='UTF-8' standalone='yes'?>\r\n"
      + '<p:sldIdLst xmlns:p="p" xmlns:r="r"><p:sldId id="256" r:id="rId2"/></p:sldIdLst>',
    );
    const [slide] = root.children;
    expect(slide.localName).toBe('sldId');
    expect(slide.attributes.get('id')).toBe('256');
    expect(slide.attributes.get('r:id')).toBe('rId2');
  });

  it('decodes entities and CDATA, and skips comments', () => {
    const root = parseXmlElement('<a t="&quot;x&quot;"><!-- note --><b>&lt;1&gt; &amp; &#20013;&#x6587;</b><c><![CDATA[<raw>]]></c></a>');
    expect(root.attributes.get('t')).toBe('"x"');
    expect(root.children.map((node) => node.textContent)).toEqual(['<1> & 中文', '<raw>']);
  });

  it('allows > inside quoted attribute values', () => {
    const root = parseXmlElement('<a><b title="x > y"/><c name=\'1>0\'>text</c></a>');
    expect(root.children[0].attributes.get('title')).toBe('x > y');
    expect(root.children[1].attributes.get('name')).toBe('1>0');
    expect(root.textContent).toBe('text');
  });

  it('does not expand custom entities', () => {
    expect(parseXmlElement('<!DOCTYPE a [<!ENTITY x "boom">]><a>&x;</a>').textContent).toBe('&x;');
  });

  it('rejects malformed XML', () => {
    expect(() => parseXmlElement('<a><b></a>')).toThrow();
    expect(() => parseXmlElement('<a>')).toThrow();
    expect(() => parseXmlElement('plain text')).toThrow();
  });
});
