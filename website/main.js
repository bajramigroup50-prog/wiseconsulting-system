(function () {
  document.documentElement.classList.add("js");
  var nodes = document.querySelectorAll("[data-i18n]");
  // Macedonian is the text written in index.html – keep it as the base dictionary.
  var mk = {};
  nodes.forEach(function (n) { if (!(n.dataset.i18n in mk)) mk[n.dataset.i18n] = n.innerHTML; });
  Object.assign(mk, window.I18N.mkExtra || {});
  var dicts = { mk: mk, sq: window.I18N.sq, en: window.I18N.en, tr: window.I18N.tr };
  var meta = window.I18N.meta;

  var currentLang = "mk", news = null;
  function t(key) { var d = dicts[currentLang] || mk; return d[key] != null ? d[key] : mk[key]; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fmtDate(iso) { var p = (iso || "").split("-"); return p.length === 3 ? p[2] + "." + p[1] + "." + p[0] : ""; }
  function safeUrl(u) { return /^https:\/\//.test(u || "") ? u : "#"; }
  var newsFilter = "all", newsShown = 8;
  function renderNews() {
    var grid = document.getElementById("newsGrid");
    if (!news || !grid) return;
    var all = [];
    news.sources.forEach(function (s) { (s.items || []).forEach(function (it) { all.push({ src: s, it: it }); }); });
    all.sort(function (a, b) { return (b.it.date || "").localeCompare(a.it.date || ""); });
    // filter chips
    var chips = '<button type="button" data-f="all" class="' + (newsFilter === "all" ? "active" : "") + '">' + esc(t("news.allSrc")) + "</button>";
    news.sources.forEach(function (s) { if (s.items && s.items.length) chips += '<button type="button" data-f="' + esc(s.id) + '" class="' + (newsFilter === s.id ? "active" : "") + '">' + esc(t("src." + s.id) || s.name) + "</button>"; });
    var fb = document.getElementById("newsFilter"); fb.innerHTML = chips;
    fb.querySelectorAll("button").forEach(function (b) { b.onclick = function () { newsFilter = b.dataset.f; newsShown = 8; renderNews(); }; });
    var list = all.filter(function (x) { return newsFilter === "all" || x.src.id === newsFilter; });
    var html = "";
    list.slice(0, newsShown).forEach(function (x, i) {
      html += '<a class="news-item' + (i === 0 ? " featured" : "") + '" href="' + esc(safeUrl(x.it.url)) + '" target="_blank" rel="noopener">' +
        '<span class="news-meta"><span class="news-src src-' + esc(x.src.id) + '">' + esc(t("src." + x.src.id) || x.src.name) + '</span><time>' + esc(fmtDate(x.it.date)) + "</time></span>" +
        '<span class="news-title">' + esc(x.it.title) + '</span><span class="news-read">' + esc(t("news.read")) + "</span></a>";
    });
    grid.innerHTML = html;
    var more = document.getElementById("newsMore");
    more.parentNode.hidden = list.length <= newsShown;
    more.onclick = function () { newsShown += 8; renderNews(); };
    var d = new Date(news.updated);
    document.getElementById("newsUpdated").textContent = isNaN(d) ? "" : d.toLocaleString(currentLang === "sq" ? "sq-AL" : currentLang === "tr" ? "tr-TR" : currentLang === "en" ? "en-GB" : "mk-MK", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    if (html) { var sec = document.getElementById("news"); sec.hidden = false; sec.querySelectorAll(".reveal").forEach(function (el) { el.classList.add("in"); }); }
  }
  fetch("data/news.json", { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
    if (d && d.sources) { news = d; renderNews(); }
  }).catch(function () {});

  // ---- Next tax deadlines (rules from the WISE program: МПИН 10th, payments 15th, ДДВ-04 25th, annual 15 March)
  function easterOrthodox(y) { var a = y % 4, b = y % 7, c = y % 19, d = (19 * c + 15) % 30, e = (2 * a + 4 * b - d + 34) % 7; var mo = Math.floor((d + e + 114) / 31), da = ((d + e + 114) % 31) + 1; var jul = new Date(Date.UTC(y, mo - 1, da)); return new Date(jul.getTime() + 13 * 864e5); }
  function holidaySet(y) {
    var s = {}, add = function (d) { s[d.toISOString().slice(0, 10)] = 1; };
    ["01-01", "01-07", "05-01", "05-24", "08-02", "09-08", "10-11", "10-23", "12-08"].forEach(function (md) { add(new Date(y + "-" + md + "T00:00:00Z")); });
    var em = easterOrthodox(y); add(new Date(em.getTime() + 864e5)); // Easter Monday
    return s;
  }
  function rollWork(d) {
    for (var i = 0; i < 10; i++) { var w = d.getUTCDay(), hs = holidaySet(d.getUTCFullYear()); if (w !== 0 && w !== 6 && !hs[d.toISOString().slice(0, 10)]) break; d = new Date(d.getTime() + 864e5); }
    return d;
  }
  function renderDeadlines() {
    var box = document.getElementById("deadlines"); if (!box) return;
    var now = new Date(), today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    var list = [];
    for (var k = 0; k < 3; k++) {
      var y = today.getUTCFullYear(), mo = today.getUTCMonth() + k;
      [[10, "dl.mpin", "МПИН"], [15, "dl.pay", "15"], [25, "dl.ddv", "ДДВ"]].forEach(function (r) { list.push({ due: rollWork(new Date(Date.UTC(y, mo, r[0]))), key: r[1], tag: r[2] }); });
    }
    [today.getUTCFullYear(), today.getUTCFullYear() + 1].forEach(function (y) { list.push({ due: rollWork(new Date(Date.UTC(y, 2, 15))), key: "dl.year", tag: "ДБ" }); });
    list = list.filter(function (x) { return x.due >= today; }).sort(function (a, b) { return a.due - b.due; }).slice(0, 3);
    var html = "";
    list.forEach(function (x, i) {
      var n = Math.round((x.due - today) / 864e5);
      var left = n === 0 ? t("dl.today") : n === 1 ? t("dl.tomorrow") : t("dl.days").replace("{n}", n);
      var pct = Math.max(6, Math.min(100, 100 - n * 100 / 31));
      var dd = ("0" + x.due.getUTCDate()).slice(-2) + "." + ("0" + (x.due.getUTCMonth() + 1)).slice(-2) + ".";
      html += '<li class="' + (n <= 3 ? "urgent" : "") + '"><span class="dl-date"><b>' + dd + "</b></span><span class=\"dl-main\"><span class=\"dl-name\">" + esc(t(x.key)) + '</span><span class="dl-bar"><i style="width:' + pct + '%"></i></span></span><span class="dl-left">' + esc(left) + "</span></li>";
    });
    box.querySelector(".dl-list").innerHTML = html;
  }
  function setLang(lang) {
    if (!dicts[lang]) lang = "mk";
    var d = dicts[lang];
    nodes.forEach(function (n) {
      var v = d[n.dataset.i18n];
      n.innerHTML = v != null ? v : mk[n.dataset.i18n];
    });
    document.documentElement.lang = lang;
    if (meta[lang]) document.title = meta[lang];
    document.querySelectorAll(".lang button").forEach(function (b) {
      b.classList.toggle("active", b.dataset.lang === lang);
    });
    try { localStorage.setItem("wise-lang", lang); } catch (e) {}
    currentLang = lang;
    renderNews();
    renderDeadlines();
  }

  document.querySelectorAll(".lang button").forEach(function (b) {
    b.addEventListener("click", function () { setLang(b.dataset.lang); });
  });

  var start = (location.search.match(/lang=(mk|sq|en|tr)/) || location.hash.match(/lang=(mk|sq|en|tr)/) || [])[1];
  if (!start) { try { start = localStorage.getItem("wise-lang"); } catch (e) {} }
  if (start && start !== "mk") setLang(start);

  // Mobile menu
  var burger = document.getElementById("burger");
  var links = document.getElementById("navLinks");
  burger.addEventListener("click", function () {
    var open = links.classList.toggle("open");
    burger.setAttribute("aria-expanded", open ? "true" : "false");
  });
  links.addEventListener("click", function (e) {
    if (e.target.tagName === "A") { links.classList.remove("open"); burger.setAttribute("aria-expanded", "false"); }
  });

  // Nav shadow on scroll
  var nav = document.querySelector(".nav");
  function onScroll() { nav.classList.toggle("scrolled", window.scrollY > 10); }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // Reveal on scroll
  var items = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    items.forEach(function (el, i) {
      el.style.transitionDelay = (i % 4) * 70 + "ms";
      io.observe(el);
    });
  } else {
    items.forEach(function (el) { el.classList.add("in"); });
  }


  // ---- Salary calculator. Rates: packages/core/src/data/payroll-params.json (2026), same as the WISE program.
  var P = { pio: 19.9, zdr: 7.5, dop: 0.5, vrab: 0.1, tax: 10, exempt: 10932, minBase: 34571, maxBase: 1106256 };
  var calcMode = "gross";
  function g2n(g) {
    var base = Math.min(Math.max(g, P.minBase), P.maxBase);
    var c = { pio: base * P.pio / 100, zdr: base * P.zdr / 100, dop: base * P.dop / 100, vrab: base * P.vrab / 100 };
    var contrib = c.pio + c.zdr + c.dop + c.vrab;
    var tax = Math.max(0, g - contrib - P.exempt) * P.tax / 100;
    return { gross: g, pio: Math.round(c.pio), zdr: Math.round(c.zdr), dop: Math.round(c.dop), vrab: Math.round(c.vrab), tax: Math.round(tax), net: Math.round(g - contrib - tax) };
  }
  function n2g(net) { var lo = 0, hi = net * 3 + 100000; for (var i = 0; i < 60; i++) { var mid = (lo + hi) / 2; if (g2n(mid).net < net) lo = mid; else hi = mid; } return Math.round(hi); }
  function fmt(x) { return x.toLocaleString("de-DE") + " ден."; }
  function runCalc() {
    var inp = document.getElementById("calcAmount"); if (!inp) return;
    var v = Math.max(0, Math.round(+inp.value || 0));
    var r = g2n(calcMode === "gross" ? v : n2g(v));
    var map = { cGross: r.gross, cPio: r.pio, cZdr: r.zdr, cDop: r.dop, cVrab: r.vrab, cTax: r.tax, cNet: r.net };
    for (var k in map) document.getElementById(k).textContent = fmt(map[k]);
  }
  document.querySelectorAll(".calc-mode button").forEach(function (b) {
    b.addEventListener("click", function () {
      calcMode = b.dataset.mode;
      document.querySelectorAll(".calc-mode button").forEach(function (x) { x.classList.toggle("active", x === b); });
      var lab = document.getElementById("calcLabel");
      lab.dataset.i18n = calcMode === "gross" ? "calc.gross" : "calc.net";
      lab.innerHTML = t(lab.dataset.i18n);
      runCalc();
    });
  });
  var ca = document.getElementById("calcAmount"); if (ca) ca.addEventListener("input", runCalc);
  runCalc();

  // ---- Offer request: opens the visitor's e-mail app (no server-side form yet)
  var of = document.getElementById("offerForm");
  if (of) of.addEventListener("submit", function (e) {
    e.preventDefault();
    var f = new FormData(of), lines = [];
    of.querySelectorAll("label").forEach(function (l) {
      var el = l.querySelector("input,select,textarea"); if (!el) return;
      var v = (f.get(el.name) || "").toString().trim(); if (v) lines.push(l.querySelector("span").textContent + ": " + v);
    });
    location.href = "mailto:info@wiseconsulting.com.mk?subject=" + encodeURIComponent("Барање за понуда – " + (f.get("company") || "")) + "&body=" + encodeURIComponent(lines.join("\n"));
  });

  // ---- Hero slides
  (function () {
    var box = document.getElementById("heroSlides"); if (!box) return;
    var slides = box.querySelectorAll(".slide"), dots = document.querySelectorAll(".slide-dots button"), hero = document.querySelector(".hero"), cur = 0, timer;
    function go(i) {
      cur = (i + slides.length) % slides.length;
      slides.forEach(function (s, k) { s.classList.toggle("active", k === cur); });
      dots.forEach(function (d, k) { d.classList.toggle("active", k === cur); });
      hero.dataset.slide = cur;
    }
    function start() { stop(); if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) timer = setInterval(function () { go(cur + 1); }, 6500); }
    function stop() { if (timer) clearInterval(timer); }
    dots.forEach(function (d, k) { d.addEventListener("click", function () { go(k); start(); }); });
    box.addEventListener("mouseenter", stop); box.addEventListener("mouseleave", start);
    start();
  })();

  // ---- Forms tabs
  document.querySelectorAll(".forms-tabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll(".forms-tabs button").forEach(function (x) { x.classList.toggle("active", x === b); });
      document.querySelectorAll(".forms-panel").forEach(function (p) { p.hidden = p.dataset.panel !== b.dataset.tab; });
    });
  });

  // ---- Count-up numbers in the hero
  (function () {
    var els = document.querySelectorAll(".count[data-count]");
    if (!els.length || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    function run(el) {
      var end = +el.dataset.count, t0 = null, dur = 1400;
      function step(ts) { if (!t0) t0 = ts; var p = Math.min(1, (ts - t0) / dur); el.textContent = Math.round(end * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); }
      el.textContent = "0"; requestAnimationFrame(step);
    }
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (es) { es.forEach(function (x) { if (x.isIntersecting) { run(x.target); io.unobserve(x.target); } }); }, { threshold: 0.6 });
      els.forEach(function (el) { io.observe(el); });
    }
  })();

  // ---- Animated portal dashboard (plays each time it scrolls into view)
  (function () {
    var dash = document.getElementById("dash"); if (!dash) return;
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    function money(el) {
      var end = +el.dataset.to, t0 = null;
      function step(ts) { if (!t0) t0 = ts; var p = Math.min(1, (ts - t0) / 1600); el.textContent = Math.round(end * (1 - Math.pow(1 - p, 3))).toLocaleString("de-DE"); if (p < 1) requestAnimationFrame(step); }
      requestAnimationFrame(step);
    }
    function play() {
      dash.classList.remove("dash-play"); void dash.offsetWidth; dash.classList.add("dash-play");
      if (!reduce) dash.querySelectorAll(".money").forEach(money);
    }
    if (reduce || !("IntersectionObserver" in window)) { dash.classList.add("dash-play"); return; }
    new IntersectionObserver(function (es) { es.forEach(function (x) { if (x.isIntersecting) play(); }); }, { threshold: 0.45 }).observe(dash);
  })();

  renderDeadlines();
  document.getElementById("year").textContent = new Date().getFullYear();
})();
