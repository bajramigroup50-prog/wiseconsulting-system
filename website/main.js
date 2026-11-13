(function () {
  document.documentElement.classList.add("js");
  var nodes = document.querySelectorAll("[data-i18n]");
  // Macedonian is the text written in index.html – keep it as the base dictionary.
  var mk = {};
  nodes.forEach(function (n) { if (!(n.dataset.i18n in mk)) mk[n.dataset.i18n] = n.innerHTML; });
  var dicts = { mk: mk, sq: window.I18N.sq, en: window.I18N.en };
  var meta = window.I18N.meta;

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
  }

  document.querySelectorAll(".lang button").forEach(function (b) {
    b.addEventListener("click", function () { setLang(b.dataset.lang); });
  });

  var start = (location.search.match(/lang=(mk|sq|en)/) || location.hash.match(/lang=(mk|sq|en)/) || [])[1];
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
