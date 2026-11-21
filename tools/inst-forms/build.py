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
INST = {'ujp': 'УЈП', 'crm': 'ЦРСМ', 'avrsm': 'АВРМ', 'fzom': 'ФЗО', 'piom': 'ПИОМ', 'dpi': 'ДПИ', 'me': 'МЕ'}
INST_ID = {'ujp': 'ujp', 'crm': 'crm', 'avrsm': 'avrm', 'fzom': 'fzo', 'piom': 'fpiom', 'dit': 'dit', 'dpi': 'dpi', 'me': 'me'}

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

ME_PAGE = 'https://www.economy.gov.mk/mk-MK/dokumenti/formulari'

def me_links():
    """The forms page of the Ministry of Economy and Labour: the МТУ applications (to ДПИ) and the ministry's own forms."""
    req = urllib.request.Request(ME_PAGE, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
    html = urllib.request.urlopen(req, timeout=60).read().decode('utf8')
    out = []
    for h, t in re.findall(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', html, re.S):
        t = re.sub(r'<[^>]+>|\s+', ' ', unescape(t)).strip()
        ext = re.search(r'\.(pdf|docx?|xlsx?)$', h, re.I)
        if not ext or re.search(r'правилник', t, re.I) or t in ('МТУ',): continue
        kind = {'pdf': 'PDF', 'doc': 'DOC', 'docx': 'DOC', 'xls': 'XLS', 'xlsx': 'XLS'}[ext.group(1).lower()]
        t = re.sub(r'\s*(\.?pdf|\.docx?|>>>)\s*$', '', t, flags=re.I).strip()
        mtu = re.match(r'ДПИ\s*-\s*Пријава за\s*-\s*МТУ\s*-?\s*(.*)$', t)
        if mtu:
            what = re.sub(r'\s*-\s*', ' ', mtu.group(1)).replace('MK', '').replace('МК', '').strip()
            al = bool(re.search(r'A[LЛ]|АL', t))
            what = re.sub(r'(A[LЛ]|АL)', '', what).strip()
            out.append({'grp': 'dpi', 'code': 'МТУ', 'name': f"Пријава за минимални технички услови – {what}{' (МК / АЛ)' if al else ''}", 'url': h, 'kind': kind, 'all': False})
        else:
            if t in ('БАРАЊЕ', 'ИЗЈАВА'): t = t.capitalize() + ' (стручен испит за идентификација)'
            out.append({'grp': 'me', 'code': '', 'name': t[:1] + t[1:].lower() if t.isupper() else t, 'url': h, 'kind': kind, 'all': False})
    out.append({'grp': 'me', 'code': '', 'name': 'Сите обрасци на официјалната страница', 'url': ME_PAGE, 'kind': 'WEB', 'all': True})
    return out

def unescape(s):
    import html as H
    return H.unescape(s)

def slug(s):
    t = {'а':'a','б':'b','в':'v','г':'g','д':'d','ѓ':'gj','е':'e','ж':'z','з':'z','ѕ':'dz','и':'i','ј':'j','к':'k','л':'l','љ':'lj','м':'m','н':'n','њ':'nj','о':'o','п':'p','р':'r','с':'s','т':'t','ќ':'kj','у':'u','ф':'f','х':'h','ц':'c','ч':'c','џ':'dz','ш':'s'}
    s = ''.join(t.get(c, c) for c in s.lower())
    return re.sub(r'[^a-z0-9]+', '_', s).strip('_')[:30]

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

DPI = 200  # print quality: the page is printed on A4 from this image

def save_page(pg, out):
    """The page as a JPG for printing: 200 dpi, grey when the page has no real colour (smaller, sharper text)."""
    img = pg.render(scale=DPI / 72).to_pil().convert('RGB')
    small = img.resize((80, 110))
    colour = max(max(p) - min(p) for p in small.getdata()) > 40
    (img if colour else img.convert('L')).save(out, quality=80, optimize=True, progressive=True)

def render(pdf, fid, pages):
    doc = pypdfium2.PdfDocument(pdf)
    dims = []
    for i in range(pages):
        pg = doc[i]
        w, h = pg.get_size()
        sc = W / w
        save_page(pg, os.path.join(ROOT, 'apps', 'web', 'public', 'forms', f'{fid}_{i}.jpg'))
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
            ff = int(a.get('/Ff') or par.get('/Ff') or 0)
            ml = int(a.get('/MaxLen') or par.get('/MaxLen') or 0)
            if ft == '/Tx' and ff & (1 << 24) and 1 < ml <= 20: f['cells'] = ml  # a comb field: one character per box
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


# Forms placed by hand (a scanned form in the Official Gazette, no text to anchor on): coordinates in px of the
# 745-wide page image. ДИТ „Известување за вршење на работа во недела“ (Правилник, Сл. весник 299/2021, Прилог).
MANUAL = [
    {'id': 'i_avrsm_ppr_ppr_obrazec_pdf', 'grp': 'avrsm', 'inst': 'АВРМ', 'code': 'ППР', 'name': 'Пријава за потреба од работник',
     'url': 'https://av.gov.mk/content/%D0%9E%D0%B1%D1%80%D0%B0%D1%81%D1%86%D0%B8/PPR%2024%20word.pdf', 'pages': [0, 1],
     'fields': [
        {'k': 'naziv', 'l': '1. Назив на работодавачот', 'x': 336, 'y': 206, 'w': 384, 'h': 20, 'p': 0, 't': 't', 'src': 'f.name'},
        {'k': 'embs', 'l': '2. ЕМБС', 'x': 608, 'y': 239, 'w': 116, 'h': 30, 'p': 0, 't': 't', 'src': 'f.embs', 'cells': 7},
        {'k': 'dejnost', 'l': '4. Шифра и назив на претежната дејност', 'x': 336, 'y': 322, 'w': 384, 'h': 46, 'p': 0, 't': 'm', 'src': 'f.activity'},
        {'k': 'ulica', 'l': '5. Улица и број', 'x': 336, 'y': 391, 'w': 384, 'h': 19, 'p': 0, 't': 't', 'src': 'f.address'},
        {'k': 'opstina', 'l': '6. Општина', 'x': 336, 'y': 415, 'w': 316, 'h': 24, 'p': 0, 't': 't', 'src': ''},
        {'k': 'mesto', 'l': '7. Населено место', 'x': 336, 'y': 447, 'w': 300, 'h': 24, 'p': 0, 't': 't', 'src': 'f.city'},
        {'k': 'tel', 'l': '8. Телефон', 'x': 336, 'y': 483, 'w': 384, 'h': 19, 'p': 0, 't': 't', 'src': 'f.phone'},
        {'k': 'faks', 'l': '9. Факс', 'x': 336, 'y': 508, 'w': 384, 'h': 18, 'p': 0, 't': 't', 'src': ''},
        {'k': 'email', 'l': '10. Е-маил', 'x': 336, 'y': 532, 'w': 384, 'h': 18, 'p': 0, 't': 't', 'src': 'f.email'},
        {'k': 'edb', 'l': '11. Единствен даночен број', 'x': 507, 'y': 555, 'w': 217, 'h': 17, 'p': 0, 't': 't', 'src': 'f.edb', 'cells': 13},
        {'k': 'kontakt', 'l': '12. Лице за контакт', 'x': 336, 'y': 597, 'w': 384, 'h': 24, 'p': 0, 't': 't', 'src': 'f.signer'},
        {'k': 'broj', 'l': '13. Број на барани работници', 'x': 674, 'y': 627, 'w': 50, 'h': 17, 'p': 0, 't': 't', 'src': '', 'cells': 3},
        {'k': 'zanimanje', 'l': '14. Занимање / работно место', 'x': 336, 'y': 666, 'w': 280, 'h': 24, 'p': 0, 't': 't', 'src': ''},
        {'k': 'mesto2', 'l': '15. Населено место (на работното место)', 'x': 336, 'y': 700, 'w': 384, 'h': 22, 'p': 0, 't': 't', 'src': ''},
        {'k': 'raspored', 'l': '18. Распоред на работно време', 'x': 336, 'y': 845, 'w': 384, 'h': 22, 'p': 0, 't': 't', 'src': ''},
        {'k': 'plata', 'l': '19. Паричен износ на основна плата', 'x': 336, 'y': 876, 'w': 384, 'h': 22, 'p': 0, 't': 't', 'src': ''},
        {'k': 'casovi', 'l': '21. Работно време (часови неделно)', 'x': 385, 'y': 968, 'w': 150, 'h': 18, 'p': 0, 't': 't', 'src': ''},
     ]},
    {'id': 'i_dit_nedela', 'grp': 'dit', 'inst': 'ДИТ', 'code': '', 'name': 'Известување за вршење на работа во недела (Сл. весник 299/2021)',
     'url': 'https://localeconomy.gazibaba.gov.mk/wp-content/uploads/2023/12/pravilnik-izvestuvanje-nedela-299-21.pdf', 'pages': [1, 2, 3],
     'fields': [
        {'k': 'naziv', 'l': 'Назив на работодавач', 'x': 294, 'y': 216, 'w': 349, 'h': 27, 'p': 0, 't': 't', 'src': 'f.name'},
        {'k': 'sediste', 'l': 'Седиште на работодавач', 'x': 294, 'y': 248, 'w': 349, 'h': 27, 'p': 0, 't': 't', 'src': 'f.addr'},
        {'k': 'edb', 'l': 'Даночен број', 'x': 294, 'y': 280, 'w': 349, 'h': 27, 'p': 0, 't': 't', 'src': 'f.edb'},
        {'k': 'embs', 'l': 'ЕМБС', 'x': 294, 'y': 312, 'w': 349, 'h': 27, 'p': 0, 't': 't', 'src': 'f.embs'},
        {'k': 'dejnost', 'l': 'Дејност (главна приходна шифра)', 'x': 294, 'y': 345, 'w': 349, 'h': 50, 'p': 0, 't': 'm', 'src': 'f.activity'},
        {'k': 'odg', 'l': 'Одговорно лице – име и презиме', 'x': 397, 'y': 434, 'w': 248, 'h': 26, 'p': 0, 't': 't', 'src': 'f.signer'},
        {'k': 'odg_adr', 'l': 'Одговорно лице – адреса на живеење', 'x': 397, 'y': 465, 'w': 248, 'h': 31, 'p': 0, 't': 'm', 'src': ''},
        {'k': 'mesto', 'l': 'Место на вршење на работниот процес', 'x': 392, 'y': 539, 'w': 253, 'h': 29, 'p': 0, 't': 't', 'src': 'f.addr'},
        {'k': 'opis', 'l': 'Опис на работниот процес', 'x': 101, 'y': 593, 'w': 545, 'h': 123, 'p': 0, 't': 'm', 'src': ''},
        {'k': 'dogovor', 'l': 'Ал. 42 – број и датум на договор за техничка соработка', 'x': 90, 'y': 154, 'w': 271, 'h': 600, 'p': 1, 't': 'm', 'src': ''},
        {'k': 'mesta', 'l': 'Ал. 43 – работни места и број на извршители', 'x': 366, 'y': 135, 'w': 289, 'h': 231, 'p': 1, 't': 'm', 'src': ''},
        {'k': 'raboti', 'l': 'Ал. 43 – опис на работите и образложение', 'x': 366, 'y': 443, 'w': 289, 'h': 145, 'p': 1, 't': 'm', 'src': ''},
        {'k': 'vreme', 'l': 'Ал. 43 – работно време', 'x': 366, 'y': 636, 'w': 289, 'h': 279, 'p': 1, 't': 'm', 'src': ''},
        {'k': 'datum', 'l': 'Место и датум', 'x': 85, 'y': 860, 'w': 250, 'h': 22, 'p': 2, 't': 't', 'src': 'today'},
     ]},
]

def render_pages(pdf, fid, pages):
    doc = pypdfium2.PdfDocument(pdf)
    dims = []
    for n, i in enumerate(pages):
        pg = doc[i]
        w, h = pg.get_size()
        sc = W / w
        save_page(pg, os.path.join(ROOT, 'apps', 'web', 'public', 'forms', f'{fid}_{n}.jpg'))
        dims.append({'W': W, 'H': round(h * sc)})
    return dims


BLANK_RULES = [
    (r'под која фирма', 'f.name', 'any'),
    (r'податоци за одговорното лице|одговорно лице', 'f.signer', 'any'),
    (r'назив на фирмата|назив на (правното лице|подносител|работодавач)|^назив', 'f.name', 'firm'),
    (r'ембс|матичен број', 'f.embs', 'firm'),
    (r'даночен број|едб', 'f.edb', 'firm'),
    (r'жиро сметка|трансакциска сметка', 'f.bank', 'firm'),
    (r'банка депонент|^банка', 'f.bankName', 'firm'),
    (r'име и презиме', 'f.signer', 'any'),
    (r'ембг', 'f.signerEmbg', 'any'),
    (r'тел\.?$|телефон', 'f.phone', 'any'),
    (r'e-?mail|е-?пошта', 'f.email', 'any'),
    (r'шифра', 'f.nkd', 'firm'),
    (r'опис', 'f.actname', 'firm'),
    (r'ул\.?$|улица|адреса|седиште', 'f.address', 'firm'),
    (r'место$|^место|град$', 'f.city', 'firm'),
]

def blank_fields(pdf, pages):
    """Fill-in-the-blank forms („Назив: ________“): every run of underscores gets the firm value named by the text
    right before it (or by the line above when the run starts the line); the numbered item it is in decides whether
    the address / place is the firm's („Седиште на фирмата“) or a person's (left empty)."""
    pl = pdfplumber.open(pdf)
    F = []
    for pi in range(pages):
        pg = pl.pages[pi]
        pw = float(pg.width); sc = W / pw
        chars = sorted(pg.chars, key=lambda c: (round(c['top'] / 3), c['x0']))
        lines = []
        for c in chars:
            if lines and abs(lines[-1][-1]['top'] - c['top']) < 3: lines[-1].append(c)
            else: lines.append([c])
        sec, item = 'firm', ''
        prev_text = ''
        used = set()
        for L in lines:
            L = sorted(L, key=lambda c: c['x0'])
            text = ''.join(c['text'] for c in L)
            m = re.match(r'^\s*(\d{1,2})\.\s*(.*)', text)
            if m:
                item = m.group(2).lower()
                sec = ('signer' if re.search(r'овластено лице|одговорно|застапување|управител', item)
                       else 'skip' if re.search(r'регистерск|суд|заверка', item)
                       else 'firm')
            # runs of underscores on the line
            runs, cur = [], []
            for c in L:
                if c['text'] == '_':
                    if cur and c['x0'] - cur[-1]['x1'] > 3: runs.append(cur); cur = []
                    cur.append(c)
                elif cur: runs.append(cur); cur = []
            if cur: runs.append(cur)
            for r in runs:
                x0, x1 = r[0]['x0'], r[-1]['x1']
                if x1 - x0 < 25: continue
                full = ''.join(c['text'] for c in L if c['x1'] <= x0 + 0.5 and c['text'] != '_').strip()
                before = re.split(r'[,;]', full)[-1].strip() if full else ''
                cands = [before, full] if full else [prev_text]
                src = ''
                for lab in cands:
                    lab = re.sub(r'^\d{1,2}\.\s*', '', lab.strip().lower().rstrip(':').strip())
                    if sec == 'skip' or not lab or re.fullmatch(r'бр\.?|дата', lab): break
                    for re_, s_, where in BLANK_RULES:
                        if re.search(re_, lab):
                            if not (where == 'firm' and sec == 'signer' and s_ in ('f.address', 'f.city', 'f.name')): src = s_
                            break
                    if src: break
                if not src or (src, item, pi) in used: continue
                used.add((src, item, pi))
                bot = max(c['bottom'] for c in r)
                F.append({'k': f'p{pi}_{slug(src)}_{len(F)}', 'l': (before or prev_text)[:60] or src, 'x': round(x0 * sc), 'y': round((bot - 13) * sc), 'w': round((x1 - x0) * sc), 'h': round(12 * sc), 'p': pi, 't': 't', 'src': src})
            stripped = text.replace('_', '').strip()
            if stripped: prev_text = re.split(r'[,;]', stripped)[-1]
    # one value per firm source per item is enough when a label repeats on continuation lines
    return F

def main():
    L = links() + me_links()
    forms, catalog = [], []
    seen = set()
    os.makedirs(os.path.join(ROOT, 'apps', 'web', 'public', 'forms'), exist_ok=True)
    for n, x in enumerate(L):
        if x['all']:
            catalog.append({'inst': INST_ID[x['grp']], 'code': '', 'name': 'Сите обрасци на официјалната страница', 'url': x['url'], 'kind': 'WEB', 'form': None}); continue
        fid = f"i_{x['grp']}_{slug(x['code'] or x['name'])}"
        if x['grp'] in ('dpi', 'me'):
            fid = f"i_{x['grp']}_{slug(x['code'] + ' ' + x['name'].split('–')[-1])}"[:40]
        while fid in seen: fid += '_2'
        seen.add(fid)
        if fid in {m['id'] for m in MANUAL}: continue  # placed by hand below
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
                    F = acro_fields(pdf, pages) if r.get_fields() else (blank_fields(pdf, pages) if '____' in (r.pages[0].extract_text() or '') else text_fields(pdf, pages))
                    if any(f['src'] for f in F):
                        dims = render(pdf, fid, pages)
                        forms.append({'id': fid, 'inst': INST[x['grp']], 'name': (f"{x['code']} – " if x['code'] else '') + x['name'], 'form': True, 'pages': dims, 'fields': F, 'url': x['url']})
                        entry['form'] = fid
            except Exception as e:
                print('  !', pdf, e)
        catalog.append(entry)
        print(f"{fid:28} {x['kind']:4} {'FORM ' + str(len(forms[-1]['fields'])) + ' fields, ' + str(sum(1 for f in forms[-1]['fields'] if f['src'])) + ' from the firm' if entry['form'] else 'link'}")
    for m in MANUAL:
        pdf = os.path.join(SRC, f"{m['id']}.pdf")
        if not os.path.exists(pdf):
            req = urllib.request.Request(m['url'], headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
            open(pdf, 'wb').write(urllib.request.urlopen(req, timeout=60).read())
        forms.append({'id': m['id'], 'inst': m['inst'], 'name': m['name'], 'form': True, 'pages': render_pages(pdf, m['id'], m['pages']), 'fields': m['fields'], 'url': m['url']})
        catalog.append({'inst': INST_ID.get(m['grp'], m['grp']), 'code': m['code'], 'name': m['name'], 'url': m['url'], 'kind': 'PDF', 'form': m['id']})
        print(f"{m['id']:28} MANUAL {len(m['fields'])} fields")
    data = os.path.join(ROOT, 'packages', 'core', 'src', 'data')
    for f in forms:
        for x in f['fields']: x.pop('sec', None)
    json.dump(forms, open(os.path.join(data, 'inst-forms.json'), 'w', encoding='utf8'), ensure_ascii=False, separators=(',', ':'))
    json.dump(catalog, open(os.path.join(data, 'inst-forms-links.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    print(len(forms), 'forms,', len(catalog), 'catalog rows')

if __name__ == '__main__':
    main()
