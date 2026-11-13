#!/usr/bin/env python3
"""Собира најнови вести / соопштенија од институции во С. Македонија.

Употреба:  python3 fetch_news.py OUTPUT.json

Само стандардна библиотека (Python 3.12). Ако некој извор не успее,
се задржуваат неговите ставки од постоечкиот OUTPUT.json. Излезот се
запишува атомски (привремена датотека + замена). Секогаш излегува со 0.
"""

import datetime as dt
import html
import json
import os
import re
import sys
import tempfile
import urllib.request
from urllib.parse import urljoin

TIMEOUT = 20
MAX_ITEMS = 5

HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "mk-MK,mk;q=0.9,en-US;q=0.6,en;q=0.5",
}

MK_MONTHS = {
    "јануари": 1, "февруари": 2, "март": 3, "април": 4, "мај": 5, "јуни": 6,
    "јули": 7, "август": 8, "септември": 9, "октомври": 10, "ноември": 11,
    "декември": 12,
}

# Текстови од навигација што никогаш не се наслов на вест.
NAV_TITLES = {"повеќе", "прочитај повеќе", "дознај повеќе", "детали",
              "соопштенија", "новости", "вести"}


# ---------------------------------------------------------------- помошни

def fetch(url, data=None, extra_headers=None):
    headers = dict(HEADERS)
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        raw = resp.read()
        charset = resp.headers.get_content_charset() or "utf-8"
    return raw.decode(charset, errors="replace")


def clean(text):
    text = re.sub(r"<[^>]+>", " ", text or "")
    text = html.unescape(text).replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


def ymd(year, month, day):
    try:
        return dt.date(int(year), int(month), int(day)).isoformat()
    except (ValueError, TypeError):
        return None


def num_date(s):
    """'12.11.2026' или '12/11/2026' -> '2026-11-12'."""
    m = re.search(r"(\d{1,2})[./](\d{1,2})[./](\d{4})", s or "")
    return ymd(m.group(3), m.group(2), m.group(1)) if m else None


def mk_text_date(s):
    """'Скопје, 13 ноември 2026 година' -> '2026-11-13'."""
    m = re.search(r"(\d{1,2})\s+([А-Яа-яЃѓЅѕЈјЉљЊњЌќЏџ]+)\s+(\d{4})", s or "")
    if not m:
        return None
    month = MK_MONTHS.get(m.group(2).lower())
    return ymd(m.group(3), month, m.group(1)) if month else None


def item(title, url, date):
    title = clean(title)
    if len(title) < 8 or title.lower().rstrip(".…» ") in NAV_TITLES:
        return None
    return {"title": title, "url": url, "date": date}


def finalize(items):
    """Без дупликати, најновите прво (стабилно), најмногу MAX_ITEMS."""
    seen, out = set(), []
    for it in items:
        if it and (it["url"], it["title"]) not in seen:
            seen.add((it["url"], it["title"]))
            out.append(it)
    out.sort(key=lambda it: it["date"] or "", reverse=True)
    return out[:MAX_ITEMS]


# ---------------------------------------------------------------- извори

def src_ujp():
    url = "https://www.ujp.gov.mk/mk/javnost/soopstenija/pregled"
    page = fetch(url)
    items = []
    for m in re.finditer(
            r'class="article-head">\s*([^<]*?)\s*</div>\s*'
            r'<div class="article-title">\s*<a href="([^"]+)"[^>]*>(.*?)</a>',
            page, re.S):
        items.append(item(m.group(3), urljoin(url, m.group(2)), num_date(m.group(1))))
    return url, items


def gov_cards(base, sections):
    """Нова платформа на министерствата (finance.gov.mk, economy.gov.mk):
    картички со датум 'DD/MM/YYYY' и наслов во <h3>. Ги спојува разделите."""
    items = []
    for section in sections:
        listing = f"{base}/mk-MK/odnosi-so-javnost/{section}"
        page = fetch(listing)
        prefix = re.escape(listing + "/")
        for m in re.finditer(
                r">\s*(\d\d/\d\d/\d{4})\s*</div>(?:(?!</h3>).)*?"
                r'<a href="(' + prefix + r'[^"]+)"\s*>\s*<h3[^>]*>(.*?)</h3>',
                page, re.S):
            items.append(item(m.group(3), m.group(2), num_date(m.group(1))))
    return f"{base}/mk-MK/odnosi-so-javnost/{sections[0]}", items


def src_finance():
    return gov_cards("https://finance.gov.mk", ["novosti", "soopstenija"])


def src_economy():
    return gov_cards("https://www.economy.gov.mk", ["novosti", "soopstenija"])


def src_avrm():
    # Делот „Настани“ на av.gov.mk не е ажуриран од 2022; актуелните објави
    # се јавните огласи за активни мерки, кои страницата ги вчитува од овој
    # веб-сервис. Огласите немаат посебна страница, па линкот е кон листата.
    listing = "https://av.gov.mk/oglasi-za-aktivni-merki.nspx"
    business = "https://av.gov.mk/oglasi-za-rabotodavaci.nspx"
    body = fetch("https://av.gov.mk/services/ServiceJobAnnouncements.asmx/"
                 "GetActiveEmploymentMeasures", data=b"{}",
                 extra_headers={"Content-Type": "application/json; charset=utf-8",
                                "Accept": "application/json"})
    rows = json.loads(body).get("d") or []
    rows.sort(key=lambda r: (num_date(r.get("AnnouncementDateFromDateFormat")) or "",
                             r.get("AnnouncementId") or 0), reverse=True)
    items = []
    for r in rows:
        title = r.get("AnnouncementDescription") or r.get("ActiveMeasureDescription")
        link = business if r.get("PbBusinessDescriptionMKD") else listing
        items.append(item(title, link, num_date(r.get("AnnouncementDateFromDateFormat"))))
    return listing, items


def src_nbrm():
    year = dt.date.today().year
    first = None
    items = []
    for y in (year, year - 1):  # на почетокот на годината листата е кратка
        listing = f"https://www.nbrm.mk/soopstenija-{y}.nspx"
        first = first or listing
        try:
            page = fetch(listing)
        except Exception:
            if y == year:
                raise
            break
        for m in re.finditer(r'<article class="news-article-item">(.*?)</article>', page, re.S):
            block = m.group(1)
            t = re.search(r'class="news-title"[^>]*>(.*?)</h2>', block, re.S)
            a = re.search(r'class="read-more-link" href="([^"]+)"', block)
            d = re.search(r'class="news-superscription"[^>]*>(.*?)</p>', block, re.S)
            if t and a:
                items.append(item(t.group(1), urljoin(listing, html.unescape(a.group(1))),
                                  mk_text_date(clean(d.group(1)) if d else "")))
        if len([i for i in items if i]) >= MAX_ITEMS:
            break
    return first, items


SOURCES = [
    ("ujp", "УЈП", src_ujp),
    ("finance", "Министерство за финансии", src_finance),
    ("avrm", "АВРСМ", src_avrm),
    ("economy", "Министерство за економија и труд", src_economy),
    ("nbrm", "НБРСМ", src_nbrm),
]


# ---------------------------------------------------------------- главно

def load_previous(path):
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return {s["id"]: s for s in data.get("sources", []) if isinstance(s, dict) and "id" in s}
    except Exception:
        return {}


def write_atomic(path, data):
    folder = os.path.dirname(os.path.abspath(path))
    fd, tmp = tempfile.mkstemp(prefix=".news-", suffix=".tmp", dir=folder)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def main(argv):
    if len(argv) != 2:
        print("Употреба: python3 fetch_news.py OUTPUT.json", file=sys.stderr)
        return 2
    out_path = argv[1]
    previous = load_previous(out_path)
    sources = []
    for sid, name, func in SOURCES:
        old = previous.get(sid, {})
        try:
            url, items = func()
            items = finalize(items)
            if not items:
                raise ValueError("нема пронајдени ставки (сменет изглед на страницата?)")
            sources.append({"id": sid, "name": name, "url": url, "items": items})
            print(f"[ok]   {sid}: {len(items)} ставки, најнова {items[0]['date']}", file=sys.stderr)
        except Exception as exc:
            kept = old.get("items") or []
            sources.append({"id": sid, "name": name, "url": old.get("url") or "", "items": kept})
            print(f"[fail] {sid}: {type(exc).__name__}: {exc} — задржани {len(kept)} стари ставки",
                  file=sys.stderr)
    data = {
        "updated": dt.datetime.now(dt.timezone.utc).astimezone().isoformat(timespec="seconds"),
        "sources": sources,
    }
    try:
        write_atomic(out_path, data)
    except Exception as exc:
        print(f"[fail] запишување {out_path}: {exc}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
