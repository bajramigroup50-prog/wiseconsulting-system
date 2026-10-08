import { describe, expect, it } from 'vitest';
import { byLocalInDoc, byTagInDoc, parseXml, textOf } from './xml';

describe('parseXml', () => {
  it('elements, attributes, namespaces, text, CDATA, entities', () => {
    const r = parseXml(`<?xml version="1.0"?>\r\n<!DOCTYPE x [<!ELEMENT a ANY>]><!-- c --><ns:Doc xmlns:ns="u" a='1 &amp; 2' b="x&#10;y\tz"><ns:A>t &lt;1&gt; &#x41;&#65;</ns:A><B><![CDATA[<raw> & ]]></B><C/></ns:Doc>`)!;
    expect(r.name).toBe('ns:Doc');
    expect(r.local).toBe('Doc');
    expect(r.attrs).toEqual({ 'xmlns:ns': 'u', a: '1 & 2', b: 'x\ny z' });
    expect(r.children.map((c) => c.local)).toEqual(['A', 'B', 'C']);
    expect(textOf(r.children[0]!)).toBe('t <1> AA');
    expect(textOf(r.children[1]!)).toBe('<raw> & ');
    expect(byLocalInDoc(r, 'A')).toHaveLength(1);
    expect(byTagInDoc(r, 'A')).toHaveLength(0);
    expect(byTagInDoc(r, 'ns:Doc')).toHaveLength(1);
  });
  it('rejects malformed documents', () => {
    for (const bad of ['', '<a>', '<a></b>', '<a x="1" x="2"/>', '<a>&bogus;</a>', '<a>&</a>', '<a/><b/>', '<a x=1/>', 'text', '<a><!-- open</a>']) expect(parseXml(bad), bad).toBeNull();
  });
  it('handles deep nesting and BOM', () => {
    const r = parseXml('﻿' + '<a>'.repeat(200) + 'x' + '</a>'.repeat(200))!;
    expect(textOf(r)).toBe('x');
  });
});
