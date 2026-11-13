(function () {
  var nodes = document.querySelectorAll("[data-i18n]");
  // Macedonian is the text written in index.html – keep it as the base dictionary.
  var mk = {};
  nodes.forEach(function (n) { mk[n.dataset.i18n] = n.innerHTML; });
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

  var start = (location.hash.match(/lang=(mk|sq|en)/) || [])[1];
  if (!start) { try { start = localStorage.getItem("wise-lang"); } catch (e) {} }
  if (start && start !== "mk") setLang(start);

  // Mobile menu
  var burger = document.getElementById("burger");
  var links = document.getElementById("navLinks");
  burger.addEventListener("click", function () { links.classList.toggle("open"); });
  links.addEventListener("click", function (e) { if (e.target.tagName === "A") links.classList.remove("open"); });

  // Contact form – not connected to any backend yet
  document.getElementById("contactForm").addEventListener("submit", function (e) {
    e.preventDefault();
    document.getElementById("formNote").hidden = false;
  });

  document.getElementById("year").textContent = new Date().getFullYear();
})();
