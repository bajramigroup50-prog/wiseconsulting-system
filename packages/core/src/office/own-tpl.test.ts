import { describe, expect, it } from 'vitest';
import { docxToHtml, parseXml } from './docx-html';
import { hrDocTplKeys, tplCtVars, tplKdVars, tplOsnVars, tplPick, tplSrcParse } from './own-tpl';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

describe('own templates: picking and context (legacy tplActive / tplVars)', () => {
  it('first key with an active template wins', () => {
    const T = [{ kind: 'ct', active: true, id: 'a' }, { kind: 'ct:pos', active: false, id: 'b' }, { kind: 'kd', active: false, id: 'c' }];
    expect(tplPick(['ct:pos', 'ct'], T)?.id).toBe('a');
    expect(tplPick(['kd'], T)).toBeNull();
  });
  it('formation values (osnData)', () => {
    const V = tplOsnVars({ name: 'Алфа', form: 'ДООЕЛ', data: { city: 'Битола', street: 'Партизанска', no: '5', nkd: '62.01', activity: 'Програмирање', docDate: '2026-03-02' },
      founders: [{ kind: 'ФЛ', name: 'Ана', surname: 'Петрова', embg: '0101990450001', address: 'ул. 1', city: 'Битола', contrib: 5000 }], managers: [] });
    expect(V).toMatchObject({ ОСНОВАЧ: 'Ана Петрова', УПРАВИТЕЛ: 'Ана Петрова', НАЗИВ_СКРАТЕН: 'Алфа ДООЕЛ Битола', СЕДИШТЕ: 'Партизанска 5 Битола', ДАТУМ_ИЗЈАВА: '02.03.2026', ДЕЈНОСТ: '62.01 - Програмирање', ГЛАВНИНА_ИЗНОС: '5.000,00' });
    expect(String(V.ОСНОВАЧ_ПОДАТОЦИ)).toContain('државјанин на Р.С.Македонија со ЕМБГ 0101990450001');
  });
  it('contract, kd and hr keys', () => {
    expect(tplCtVars({ name: 'Б', position: 'Возач' }, { no: '12', start: '2026-01-05', typeName: 'неопределено' })).toMatchObject({ РАБОТНО_МЕСТО: 'Возач', ПОЧЕТОК: '05.01.2026', ДОГОВОР_БРОЈ: '12' });
    expect(tplKdVars({ number: 'СУ-001/2026', services: ['Книговодство', 'Плати'] }).УСЛУГИ).toBe('– Книговодство\n– Плати');
    expect(hrDocTplKeys('contract', null)).toEqual(['ct']);
    expect(hrDocTplKeys('di-warn', 'Писмено предупредување')).toEqual(['d:Писмено предупредување']);
    expect(hrDocTplKeys('leave', 'x')).toEqual([]);
    expect(tplSrcParse('osn:6f1c2a3b-0000-4000-8000-000000000001')).toEqual({ t: 'osn', id: '6f1c2a3b-0000-4000-8000-000000000001' });
    expect(tplSrcParse('firm:')).toEqual({ t: 'firm', id: '' });
    expect(tplSrcParse('x:1')).toBeNull();
  });
});

describe('ncCheck (legacy formation checklist)', async () => {
  const { ncCheck } = await import('./formation');
  it('lists what is missing and is empty when complete', () => {
    expect(ncCheck({ name: '', form: 'ДООЕЛ', data: {}, founders: [], managers: [] })).toEqual(['Назив', 'Адреса на седиштето', 'Шифра на дејност', 'Барем еден основач', 'Управител', 'Основачки влог']);
    const F = [{ kind: 'ФЛ', name: 'Ана', surname: 'Петрова', embg: '0101990450001', address: 'ул. 1', share: 100 }];
    expect(ncCheck({ name: 'Алфа', form: 'ДООЕЛ', data: { street: 'Партизанска', city: 'Битола', nkd: '62.01' }, founders: F, managers: [{ name: 'Ана Петрова' }], capEur: 5000 })).toEqual([]);
    expect(ncCheck({ name: 'Алфа', form: 'ДООЕЛ', data: { street: 'П', city: 'Б', nkd: '1' }, founders: [...F, { ...F[0], name: 'Б' }], managers: [{ name: 'Друг' }], capEur: 100 }))
      .toEqual(['ДООЕЛ има само еден основач', 'Уделите треба да се 100% (сега 200%)', 'Управител 1: име и ЕМБГ', 'Основачки влог под 5.000 € (проверете го важечкиот минимум)']);
  });
});

describe('docxToHtml (legacy tplHtml)', () => {
  it('parses XML with entities and self-closing tags', () => {
    const r = parseXml(`<?xml version="1.0"?><a x="1 &amp; 2"><b/><c>т&lt;т</c></a>`);
    expect(r.c[0]!.a.x).toBe('1 & 2');
    expect(r.c[0]!.c[1]!.c[0]!.t).toBe('т<т');
  });
  it('paragraphs, runs, alignment, tables and numbering', () => {
    const document = `<w:document ${W}><w:body>
      <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="28"/></w:rPr><w:t>ДОГОВОР</w:t></w:r></w:p>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">Прва &amp; </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>точка</w:t></w:r></w:p>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Втора</w:t><w:br w:type="page"/></w:r></w:p>
      <w:tbl><w:tblPr><w:tblBorders/></w:tblPr><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>ќелија</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      <w:sectPr/></w:body></w:document>`;
    const numbering = `<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
    const H = docxToHtml({ document, numbering });
    expect(H).toContain('text-align:center');
    expect(H).toContain('<span style="font-weight:bold;font-size:14pt;">ДОГОВОР</span>');
    expect(H).toContain('1. <span style="">Прва &amp; </span><span style="font-style:italic;">точка</span>');
    expect(H).toContain('2. <span style="">Втора</span><div class="pb"></div>');
    expect(H).toContain('<td colspan="2" style="border:1px solid #444');
  });
  it('images through relationships, default header', () => {
    const document = `<w:document ${W} xmlns:r="r" xmlns:a="a" xmlns:wp="wp"><w:body><w:p><w:r><w:drawing><wp:extent cx="952500" cy="476250"/><a:blip r:embed="rId5"/></w:drawing></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="rId9"/></w:sectPr></w:body></w:document>`;
    const rels = `<Relationships><Relationship Id="rId5" Target="media/image1.png"/><Relationship Id="rId9" Target="header1.xml"/></Relationships>`;
    const H = docxToHtml({ document, rels, media: { 'word/media/image1.png': 'data:image/png;base64,AA' }, headers: { 'word/header1.xml': `<w:hdr ${W}><w:p><w:r><w:t>Заглавие</w:t></w:r></w:p></w:hdr>` } });
    expect(H).toContain('<img src="data:image/png;base64,AA" style="width:100px;height:50px;');
    expect(H).toContain('Заглавие');
  });
});
