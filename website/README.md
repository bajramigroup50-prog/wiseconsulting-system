# WISE CONSULTING – public website

Static marketing site (plain HTML/CSS/JS, no build step). Separate from `apps/web`; not deployed anywhere yet.

- `index.html` – content in Macedonian (base language)
- `i18n.js` – Albanian (`sq`) and English (`en`) translations, keyed by `data-i18n`
- `main.js` – language switch (MK / SQ / EN, remembered in localStorage, or `#lang=sq`), mobile menu, contact form stub
- `styles.css` – styles; brand colour `#0d5c4a`

Yellow highlighted text (`.ph`, `.ph-box`) marks placeholders still to be supplied: phone, e-mail, address, hours, prices, photos, map, stats.
The contact form is not connected to any backend.

Local preview: `python -m http.server 5500 -d website`
