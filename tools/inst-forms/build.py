"""
Official forms of the institutions (the list of „Обрасци“ on wiseconsulting.com.mk, website/index.html #forms)
→ fillable forms of WISE („Барања и обрасци“, `@wise/core/firms/requests` `ReqForm`): every page rendered to a JPG
(apps/web/public/forms/<id>_<page>.jpg) and the fields placed over it, filled from the firm.

- A PDF with form fields (AcroForm, most УЈП forms): every text field / check box at its own rectangle; its meaning is
  taken from the printed label next to it (left on the same line, else just above) and the section it is in
  („Потписник“ / „Овластено лице“ → the signer, „Сметководствено биро“ / „составувач“ → left for the office).
- A PDF with text but no fields: the firm's fields are placed right of their printed labels (Назив, ЕДБ, ЕМБС,
  Адреса / Седиште, Телефон, е-пошта, Трансакциска сметка, Дејност, Место и датум).
- A scan (no text) or a web form: listed with the link to the original only.

Run (Python 3 with pypdf, pdfplumber, pypdfium2):  python tools/inst-forms/build.py <dir with the downloaded PDFs>
Writes packages/core/src/data/inst-forms.json (forms) and packages/core/src/data/inst-forms-links.json (catalog).
"""
import json, os, re, sys, unicodedata, urllib.request
import pdfplumber, pypdf, pypdfium2

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '.inst-forms')
W = 745  # rendered page width in px (the existing WISE forms use 745 × 1053)
INST = {'ujp': 'УЈП', 'crm': 'ЦРСМ', 'avrsm': 'АВРМ', 'fzom': 'ФЗО', 'piom': 'ПИОМ'}
INST_ID = {'ujp': 'ujp', 'crm': 'crm', 'avrsm': 'avrm', 'fzom': 'fzo', 'piom': 'fpiom'}

def links():
    html = open(os.path.join(ROOT, 'website', 'index.html'), encoding='utf8').read()
    i = html.index('<section class="section" id="forms">'); j = html.index('</section>', i)
    sec = html[i:j]
    out = []
    for p in re.finditer(r'data-panel="([^"]+)"(.*?)(?=data-panel=|$)', sec, re.S):
        for h, t in re.findall(r'<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>', p.group(2), re.S):
            code = re.search(r'<b[^>]*>(.*?)</b>', t, re.S)
            txt = re.sub(r'<[^>]+>', ' ', t)
            txt = re.sub(r'\s+', ' ', unescape(txt)).strip()
            kind = 'PDF' if re.search(r'\bPDF$', txt) else 'DOC' if re.search(r'\bDOC$', txt) else 'XLS' if re.search(r'\bXLS$', txt) else 'WEB'
            txt = re.sub(r'\s*(PDF|DOC|XLS|WEB|→)$', '', txt).strip()
            c = unescape(re.sub(r'<[^>]+>', '', code.group(1))).strip() if code else ''
            name = txt[len(c):].strip() if c and txt.startswith(c) else txt
            out.append({'grp': p.group(1), 'code': c, 'name': name, 'url': unescape(h), 'kind': kind, 'all': 'Сите обрасци' in name})
    return out

def unescape(s):
    import html as H
    return H.unescape(s)

def slug(s):
    t = {'а':'a','б':'b','в':'v','г':'g','д':'d','ѓ':'gj','е':'e','ж':'z','з':'z','ѕ':'dz','и':'i','ј':'j','к':'k','л':'l','љ':'lj','м':'m','н':'n','њ':'nj','о':'o','п':'p','р':'r','с':'s','т':'t','ќ':'kj','у':'u','ф':'f','х':'h','ц':'c','ч':'c','џ':'dz','ш':'s'}
    s = ''.join(t.get(c, c) for c in s.lower())
    return re.sub(r'[^a-z0-9]+', '_', s).strip('_')[:24]

# label → firm source (in the firm's own section); order matters (the first match wins)
RULES = [
    (r'назив и адреса', 'f.nameaddr'),
    (r'назив на банка|^банка', 'f.bankName'),
    (r'наце', 'f.activity'),
    (r'идентификац\w* број', 'f.edb'),
    (r'ембс|матичен број', 'f.embs'),
    (r'едб|даночен број', 'f.edb'),
    (r'назив|име и презиме|фирма', 'f.name'),
    (r'седиште|адреса', 'f.addr'),
    (r'телефон|тел\.', 'f.phone'),
    (r'е-?пошта|e-?mail', 'f.email'),
    (r'трансакциска|жиро', 'f.bank'),
    (r'банка', 'f.bankName'),
    (r'дејност|шифра на дејност', 'f.activity'),
    (r'датум на пополнување|датум на поднесување|^датум$', 'today'),
]
SIGNER = [(r'ембг', 'f.signerEmbg'), (r'име и презиме|потписник', 'f.signer')]
SIGNER_SEC = re.compile(r'потписник|овластено лице|подносител|одговорно лице|застапник', re.I)
OFFICE_SEC = re.compile(r'сметководствен|составувач|полномошник|пополнувач', re.I)
UJP_SEC = re.compile(r'пополнува управа|пополнува ујп|се пополнува од', re.I)

def src_of(label, sec):
    l = label.lower()
    if sec == 'skip':
        return ''
    if re.search(r'датум на (пополн|поднес)|^датум$|место и датум', l):
        return 'today'
    if 'датум' in l:
        return ''
    if sec == 'office':
        return ''
    if sec == 'signer':
        if re.search(r'својство', l): return 'Управител'
        for re_, s_ in SIGNER:
            if re.search(re_, l): return s_
        return ''
    if re.search(r'шифра', l) and not re.search(r'опис', l): return 'f.nkd'
    if re.search(r'^опис|опис$', l) or re.search(r'дејност', l) and 'опис' in l: return 'f.actname'
    for re_, s_ in RULES:
        if re.search(re_, l): return s_
    return ''

def render(pdf, fid, pages):
    doc = pypdfium2.PdfDocument(pdf)
    dims = []
    for i in range(pages):
        pg = doc[i]
        w, h = pg.get_size()
        sc = W / w
        img = pg.render(scale=sc * 1.4).to_pil()  # sharper image, shown at 100 % width
        img = img.convert('RGB')
        out = os.path.join(ROOT, 'apps', 'web', 'public', 'forms', f'{fid}_{i}.jpg')
        img.save(out, quality=60, optimize=True, progressive=True)
        dims.append({'W': W, 'H': round(h * sc)})
    return dims

def acro_fields(pdf, pages):
    r = pypdf.PdfReader(pdf)
    pl = pdfplumber.open(pdf)
    F = []
    for pi, page in enumerate(r.pages[:pages]):
        pw, ph = float(page.mediabox.width), float(page.mediabox.height)
        sc = W / pw
        words = pl.pages[pi].extract_words(keep_blank_chars=True, x_tolerance=2)
        lines = sorted(words, key=lambda w: (round(w['top']), w['x0']))
        for a in page.get('/Annots') or []:
            a = a.get_object()
            if a.get('/Subtype') != '/Widget': continue
            par = a.get('/Parent').get_object() if a.get('/Parent') else {}
            name = str(a.get('/T') or par.get('/T') or '')
            ft = a.get('/FT') or par.get('/FT')
            x0, y0, x1, y1 = [float(v) for v in a['/Rect']]
            top, bot = ph - y1, ph - y0
            if x1 - x0 < 4 or bot - top < 4: continue
            mid = (top + bot) / 2
            near = sorted([w for w in words if w['x1'] <= x0 + 2 and x0 - w['x1'] < 160 and w['top'] < bot - 3 and w['bottom'] > top + 3], key=lambda w: -w['x1'])
            above = [w for w in words if top - 14 < w['bottom'] <= top + 2 and w['x0'] < x1 and w['x1'] > x0]
            if near and re.fullmatch(r'\d{1,3}\.?', near[0]['text'].strip()):
                label = ''  # a numbered row of the return (amounts): never firm data
            elif near:
                # the label block left of the field (a label may run over two or three lines)
                n0 = near[0]
                label = ' '.join(w['text'] for w in sorted([w for w in near if abs(w['x0'] - n0['x0']) < 30], key=lambda w: w['top'])).strip()
            else:
                label = ' '.join(w['text'] for w in above).strip()
            label = re.sub(r'\s+', ' ', label)
            if x1 - x0 < 45 and not ft == '/Btn': label = label if re.search(r'датум', label, re.I) else ''
            # the section: the nearest heading-like line above the field on the left part of the page
            # the section: the nearest heading above (or the row title on the left of the same line)
            sec = 'firm'
            cand = [w for w in lines if w['x0'] < pw * 0.5 and (w['bottom'] <= top + 2 or (w['x1'] <= x0 + 2 and w['top'] <= bot))]
            for w in sorted(cand, key=lambda w: -w['top']):
                t = w['text']
                if UJP_SEC.search(t): sec = 'skip'; break
                if OFFICE_SEC.search(t) and not re.search(r'управител', t, re.I): sec = 'office'; break
                if SIGNER_SEC.search(t): sec = 'signer'; break
            if UJP_SEC.search(label): sec = 'skip'
            f = {'sec': sec, 'k': f'p{pi}_{slug(name) or len(F)}_{len(F)}', 'l': (label or name or 'Поле')[:60], 'x': round(x0 * sc), 'y': round(top * sc), 'w': round((x1 - x0) * sc), 'h': round((bot - top) * sc), 'p': pi}
            if ft == '/Btn':
                f.update({'t': 'x', 'src': ''})
            else:
                f.update({'t': 'm' if bot - top > 26 else 't', 'src': src_of(label, sec)})
            if sec == 'skip': continue
            F.append(f)
    return F

EXTRA = [
    (r'даночен идентификационен број|^едб', 'f.edb'), (r'улица и број', 'f.address'), (r'населено место|^место$|^град$', 'f.city'),
    (r'^држава$', 'Република Северна Македонија'),
]

def section_of(text, cur):
    if UJP_SEC.search(text): return 'skip'
    if OFFICE_SEC.search(text): return 'office'
    if SIGNER_SEC.search(text): return 'signer'
    if re.search(r'обврзник|подносител на барањето|работодавач|податоци за правното лице|барател', text, re.I): return 'firm'
    return cur

# in a form without fields a label must START with the keyword („За пред банка“ is a choice, not the bank)
START = re.compile(r'^(назив|име и презиме|фирма|едб|ембс|матичен|седиште|адреса|телефон|тел\.|е-?пошта|e-?mail|трансакциска|жиро|банка$|дејност|шифра на дејност|датум|место и датум)', re.I)

def text_fields(pdf, pages):
    """Forms without AcroForm fields: a recognised label → the empty printed box right of it (or the line after it)."""
    pl = pdfplumber.open(pdf)
    F = []
    for pi in range(pages):
        pg = pl.pages[pi]
        pw = float(pg.width); sc = W / pw
        words = pg.extract_words(keep_blank_chars=True, x_tolerance=2)
        rects = [r for r in pg.rects if r['width'] > 25 and 8 < r['height'] < 60]
        def empty(r):
            return not any(w['x0'] >= r['x0'] - 1 and w['x1'] <= r['x1'] + 1 and w['top'] >= r['top'] - 1 and w['bottom'] <= r['bottom'] + 1 for w in words)
        sec = 'firm'
        done = set()
        for w in sorted(words, key=lambda v: (round(v['top']), v['x0'])):
            t = w['text'].strip()
            if len(t) > 3 and t.upper() == t and re.search('[А-Ш]', t):
                sec = section_of(t, sec)
                continue  # a heading is never a label
            if sec == 'skip' or len(t) > 38: continue
            lab = t.lower().rstrip(':').strip()
            src = ''
            for re_, s_ in EXTRA:
                if re.search(re_, lab): src = s_; break
            if sec in ('office', 'skip'): src = ''
            elif sec == 'signer' and src not in ('today',): src = src_of(lab, sec) or ('' if src.startswith('f.') else src)
            else: src = src or (src_of(lab, sec) if START.match(lab) else '')
            if not src or (src, sec, pi) in done and src != 'today': continue
            mid = (w['top'] + w['bottom']) / 2
            box = sorted([r for r in rects if r['x0'] >= w['x1'] - 3 and r['top'] - 2 <= mid <= r['bottom'] + 2 and r['height'] <= 34 and empty(r)], key=lambda r: (round(r['x0']), r['width']))
            if box:
                m = box[0]['x0']
                r = sorted([b for b in box if b['x0'] - m < 6], key=lambda b: b['width'])[0]; x0, x1, top, bot = r['x0'] + 2, r['x1'] - 2, r['top'] + 1, r['bottom'] - 1
            else:
                same = [v for v in words if v is not w and v['x0'] > w['x1'] + 2 and abs(v['top'] - w['top']) < 4]
                x0 = w['x1'] + 4; x1 = min([v['x0'] for v in same] + [pw - 30]) - 3
                top, bot = w['top'] - 3, w['bottom'] + 3
                if x1 - x0 < 40: continue
            F.append({'k': f'p{pi}_{slug(src)}_{len(F)}', 'l': t[:60], 'x': round(x0 * sc), 'y': round(top * sc), 'w': round((x1 - x0) * sc), 'h': round(max(bot - top, 12) * sc), 'p': pi, 't': 't', 'src': src})
            done.add((src, sec, pi))
    return F

def main():
    L = links()
    forms, catalog = [], []
    os.makedirs(os.path.join(ROOT, 'apps', 'web', 'public', 'forms'), exist_ok=True)
    for n, x in enumerate(L):
        if x['all']:
            catalog.append({'inst': INST_ID[x['grp']], 'code': '', 'name': 'Сите обрасци на официјалната страница', 'url': x['url'], 'kind': 'WEB', 'form': None}); continue
        fid = f"i_{x['grp']}_{slug(x['code'] or x['name'])}"
        entry = {'inst': INST_ID[x['grp']], 'code': x['code'], 'name': x['name'], 'url': x['url'], 'kind': x['kind'], 'form': None}
        pdf = os.path.join(SRC, f"{fid}.pdf")
        if x['kind'] == 'PDF' and not os.path.exists(pdf):
            try:
                req = urllib.request.Request(x['url'], headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
                open(pdf, 'wb').write(urllib.request.urlopen(req, timeout=60).read())
            except Exception as e: print('  ! download', x['url'], e)
        if x['kind'] == 'PDF' and os.path.exists(pdf):
            try:
                r = pypdf.PdfReader(pdf)
                pages = min(len(r.pages), 4)
                has_text = len((r.pages[0].extract_text() or '').strip()) > 20
                if len(r.pages) > 8 or not has_text:
                    pass  # a gazette / instructions or a scan: link only
                else:
                    F = acro_fields(pdf, pages) if r.get_fields() else text_fields(pdf, pages)
                    if any(f['src'] for f in F):
                        dims = render(pdf, fid, pages)
                        forms.append({'id': fid, 'inst': INST[x['grp']], 'name': (f"{x['code']} – " if x['code'] else '') + x['name'], 'form': True, 'pages': dims, 'fields': F, 'url': x['url']})
                        entry['form'] = fid
            except Exception as e:
                print('  !', pdf, e)
        catalog.append(entry)
        print(f"{fid:28} {x['kind']:4} {'FORM ' + str(len(forms[-1]['fields'])) + ' fields, ' + str(sum(1 for f in forms[-1]['fields'] if f['src'])) + ' from the firm' if entry['form'] else 'link'}")
    data = os.path.join(ROOT, 'packages', 'core', 'src', 'data')
    for f in forms:
        for x in f['fields']: x.pop('sec', None)
    json.dump(forms, open(os.path.join(data, 'inst-forms.json'), 'w', encoding='utf8'), ensure_ascii=False, separators=(',', ':'))
    json.dump(catalog, open(os.path.join(data, 'inst-forms-links.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    print(len(forms), 'forms,', len(catalog), 'catalog rows')

if __name__ == '__main__':
    main()
