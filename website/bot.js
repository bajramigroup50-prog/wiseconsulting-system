/* WISE assistant: answers only from the site's own, reviewed texts (no AI). Topics are matched by
   quick-reply buttons or by keywords in MK / SQ / EN / TR. Unknown questions go to phone / e-mail. */
(function () {
  var I = window.I18N;
  function lang() { return document.documentElement.lang || "mk"; }
  function t(k) {
    var d = I[lang()] || {};
    if (d[k] != null) return d[k];
    if (I.mkExtra && I.mkExtra[k] != null && lang() === "mk") return I.mkExtra[k];
    var el = document.querySelector('[data-i18n="' + k + '"]');
    return el ? el.innerHTML : k;
  }
  function plain(html) { var d = document.createElement("div"); d.innerHTML = html; return d.textContent; }

  var CONTACT = '<a href="tel:+38975288889">075 288 889</a> · <a href="tel:+38971675538">071 675 538</a> · <a href="mailto:info@wiseconsulting.com.mk">info@wiseconsulting.com.mk</a>';
  function link(href, key) { return '<a class="bot-link" href="' + href + '">' + plain(t(key)) + " →</a>"; }

  var TOPICS = [
    { id: "services", label: "nav.services", kw: ["услуг", "што нуди", "што работ", "shërbim", "sherbim", "çfarë ofro", "service", "offer", "hizmet"],
      answer: function () { return plain(t("services.lead")) + "<ul>" + ["s1.t", "s2.t", "s3.t", "s4.t", "s5.t", "s6.t"].map(function (k) { return "<li>" + plain(t(k)) + "</li>"; }).join("") + "</ul>" + link("#services", "nav.services"); } },
    { id: "price", label: "nav.pricing", kw: ["цен", "чини", "пакет", "колку", "понуд", "çmim", "cmim", "sa kushton", "paket", "ofert", "price", "cost", "how much", "package", "quote", "fiyat", "ücret", "ucret", "teklif"],
      answer: function () { return plain(t("q3.a")) + "<br><br>" + plain(t("pricing.note")).replace(/^\*\s*/, "") + "<br>" + link("#offerForm", "offer.title"); } },
    { id: "contact", label: "contact.eyebrow", kw: ["контакт", "телефон", "адрес", "работно", "време", "е-пошт", "email", "mail", "kontakt", "telefon", "adres", "orar", "contact", "phone", "address", "hours", "open", "iletişim", "iletisim", "saat"],
      answer: function () { return "<b>" + plain(t("contact.phone")) + ":</b> " + '<a href="tel:+38975288889">075 288 889</a>, <a href="tel:+38971675538">071 675 538</a><br><b>' + plain(t("contact.email")) + ':</b> <a href="mailto:info@wiseconsulting.com.mk">info@wiseconsulting.com.mk</a>, <a href="mailto:vbkonsalting@hotmail.com">vbkonsalting@hotmail.com</a><br><b>' + plain(t("contact.hours")) + ":</b> " + plain(t("contact.hoursVal")) + "<br><b>" + plain(t("contact.address")) + ":</b> " + plain(t("contact.city")); } },
    { id: "switch", label: "q1.q", kw: ["премин", "смен", "друг сметковод", "менувам", "kaloj", "ndërro", "nderro", "kontabilist tjetër", "switch", "change account", "another account", "geçiş", "gecis", "değiştir", "degistir"],
      answer: function () { return plain(t("q1.a")) + "<br>" + link("#process", "nav.process"); } },
    { id: "register", label: "s5.t", kw: ["регистрац", "основа", "отвор", "нова фирма", "дооел", "regjistr", "themel", "hap firm", "register", "open a company", "new company", "start a company", "kuruluş", "kurulus", "şirket kur", "sirket kur"],
      answer: function () { return plain(t("s5.d")) + "<br>" + link("#offerForm", "offer.title"); } },
    { id: "salary", label: "nav.tools", kw: ["плат", "бруто", "нето", "придонес", "мпин", "pag", "bruto", "neto", "kontribut", "mpin", "salary", "gross", "net", "payroll", "maaş", "maas", "brüt", "brut", "bordro"],
      answer: function () { return plain(t("s3.d")) + "<br><br>" + plain(t("tools.lead")) + "<br>" + link("#tools", "nav.tools"); } },
    { id: "portal", label: "q2.q", kw: ["портал", "онлајн", "најав", "portal", "online", "hyrj", "login", "giriş", "giris", "çevrimiçi"],
      answer: function () { return plain(t("q2.a")); } },
    { id: "docs", label: "q4.q", kw: ["документ", "фактур", "извод", "достав", "dokument", "fatur", "ekstrakt", "dorëz", "dorez", "document", "invoice", "statement", "submit", "belge", "fatura", "ekstre"],
      answer: function () { return plain(t("q4.a")); } },
    { id: "lang", label: "q5.q", kw: ["албан", "јазик", "shqip", "gjuh", "albanian", "language", "arnavut", "dil"],
      answer: function () { return plain(t("q5.a")); } },
    { id: "security", label: "q6.q", kw: ["безбед", "сигурн", "2fa", "податоц", "sigur", "të dhën", "te dhen", "secur", "safe", "data", "güven", "guven", "veri"],
      answer: function () { return plain(t("q6.a")); } },
    { id: "news", label: "nav.news", kw: ["вест", "новост", "ујп", "соопшт", "закон", "lajm", "njoft", "ligj", "news", "law", "announcement", "haber", "duyuru", "yasa"],
      answer: function () { return plain(t("news.lead")) + "<br>" + link("#news", "nav.news"); } },
    { id: "vat", label: "s2.t", kw: ["ддв", "данок", "даноч", "tvsh", "tatim", "vat", "tax", "kdv", "vergi"],
      answer: function () { return plain(t("s2.d")) + "<br>" + link("#offerForm", "offer.title"); } }
  ];

  function match(q) {
    q = " " + q.toLowerCase() + " ";
    var best = null, score = 0;
    TOPICS.forEach(function (tp) {
      var s = 0;
      tp.kw.forEach(function (k) { if (q.indexOf(k) !== -1) s += k.length; });
      if (s > score) { score = s; best = tp; }
    });
    return best;
  }

  // ---- UI
  var root = document.createElement("div");
  root.className = "bot";
  root.innerHTML =
    '<button class="bot-fab" type="button" aria-expanded="false"><svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/></svg><span class="bot-fab-label"></span></button>' +
    '<div class="bot-panel" role="dialog" hidden>' +
      '<div class="bot-head"><span class="logo-box sm">wise</span><div><b class="bot-title"></b><small class="bot-sub"></small></div><button type="button" class="bot-close" aria-label="×">×</button></div>' +
      '<div class="bot-body" aria-live="polite"></div>' +
      '<form class="bot-form"><input type="text" maxlength="200" autocomplete="off"><button type="submit" aria-label="send"><svg viewBox="0 0 24 24"><path d="M4 12l16-8-6 16-2-6z"/></svg></button></form>' +
    "</div>";
  document.body.appendChild(root);
  var fab = root.querySelector(".bot-fab"), panel = root.querySelector(".bot-panel"), body = root.querySelector(".bot-body"),
      form = root.querySelector(".bot-form"), input = form.querySelector("input");

  function msg(html, who) {
    var d = document.createElement("div");
    d.className = "bot-msg from-" + (who || "bot").replace(" ", " from-");
    d.innerHTML = html;
    body.appendChild(d);
    body.scrollTop = body.scrollHeight;
    return d;
  }
  function chips() {
    var wrap = document.createElement("div");
    wrap.className = "bot-chips";
    TOPICS.forEach(function (tp) {
      var b = document.createElement("button");
      b.type = "button"; b.textContent = plain(t(tp.label));
      b.onclick = function () { ask(tp, b.textContent); };
      wrap.appendChild(b);
    });
    body.appendChild(wrap);
    body.scrollTop = body.scrollHeight;
  }
  function ask(tp, text) {
    msg(text.replace(/[<>&]/g, ""), "me");
    setTimeout(function () {
      if (tp) msg(tp.answer());
      else msg(plain(t("bot.fallback")) + "<br>" + CONTACT);
      msg(plain(t("bot.more")), "bot small");
      chips();
    }, 350);
  }
  function labels() {
    fab.querySelector(".bot-fab-label").textContent = plain(t("bot.fab"));
    root.querySelector(".bot-title").textContent = plain(t("bot.title"));
    root.querySelector(".bot-sub").textContent = plain(t("bot.sub"));
    input.placeholder = plain(t("bot.placeholder"));
  }
  function start() {
    body.innerHTML = "";
    msg(plain(t("bot.hello")));
    chips();
  }
  function open(v) {
    panel.hidden = !v;
    fab.setAttribute("aria-expanded", v ? "true" : "false");
    root.classList.toggle("open", v);
    if (v) { labels(); if (!body.childNodes.length) start(); setTimeout(function () { input.focus({ preventScroll: true }); }, 50); }
  }
  fab.onclick = function () { open(panel.hidden); };
  root.querySelector(".bot-close").onclick = function () { open(false); };
  form.onsubmit = function (e) {
    e.preventDefault();
    var q = input.value.trim(); if (!q) return;
    input.value = "";
    ask(match(q), q);
  };
  // language switch: refresh labels and restart the conversation in the new language
  document.querySelectorAll(".lang button").forEach(function (b) {
    b.addEventListener("click", function () { setTimeout(function () { labels(); if (!panel.hidden) start(); else body.innerHTML = ""; }, 0); });
  });
  labels();
  if (/[?&]bot=open/.test(location.search)) open(true);
})();
