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
  function renderNews() {
    var grid = document.getElementById("newsGrid");
    if (!news || !grid) return;
    var html = "";
    news.sources.forEach(function (s) {
      if (!s.items || !s.items.length) return;
      html += '<article class="news-card"><h3>' + esc(t("src." + s.id) || s.name) + "</h3><ul>";
      s.items.slice(0, 4).forEach(function (it) {
        html += '<li><time>' + esc(fmtDate(it.date)) + '</time><a href="' + esc(safeUrl(it.url)) + '" target="_blank" rel="noopener">' + esc(it.title) + "</a></li>";
      });
      html += '</ul><a class="news-all" href="' + esc(safeUrl(s.url)) + '" target="_blank" rel="noopener">' + esc(t("news.all")) + "</a></article>";
    });
    grid.innerHTML = html;
    var d = new Date(news.updated);
    document.getElementById("newsUpdated").textContent = isNaN(d) ? "" : d.toLocaleString(currentLang === "sq" ? "sq-AL" : currentLang === "tr" ? "tr-TR" : currentLang === "en" ? "en-GB" : "mk-MK", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    if (html) document.getElementById("news").hidden = false;
  }
  fetch("data/news.json", { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
    if (d && d.sources) { news = d; renderNews(); }
  }).catch(function () {});

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

  document.getElementById("year").textContent = new Date().getFullYear();
})();
