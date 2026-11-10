/* Pitaka Sales OS — UZ / RU interface language (2026-11-10).
   The panel is written in Uzbek. In Russian mode this layer swaps interface text in place: whole strings from
   the dictionary (window.PK_RU, i18n-ru.js), then number patterns ("7 kun"), then known phrases inside longer text.
   Data from the API that is not in the dictionary (names, Bitrix stage names, reasons) stays as it is.
   The choice is kept in localStorage; switching reloads the page so every screen is drawn once in one language. */
(function () {
  "use strict";
  var KEY = "pitaka.lang";
  var lang = "uz";
  try { lang = localStorage.getItem(KEY) === "ru" ? "ru" : "uz"; } catch (e) { /* storage blocked: Uzbek */ }
  window.PK_LANG = lang;
  document.documentElement.lang = lang;

  window.pkSetLang = function (next) {
    if (next !== "ru" && next !== "uz") return;
    try { localStorage.setItem(KEY, next); } catch (e) { /* not saved, still switch for this load */ }
    location.reload();
  };

  function wireSwitch() {
    var segs = document.querySelectorAll(".langseg");
    for (var i = 0; i < segs.length; i++) {
      var btns = segs[i].querySelectorAll("button[data-l]");
      for (var j = 0; j < btns.length; j++) {
        btns[j].setAttribute("aria-pressed", String(btns[j].getAttribute("data-l") === lang));
        btns[j].onclick = function () { if (this.getAttribute("data-l") !== lang) window.pkSetLang(this.getAttribute("data-l")); };
      }
    }
  }

  if (lang !== "ru") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wireSwitch); else wireSwitch();
    return;
  }

  var D = window.PK_RU || {};
  var norm = function (s) { return s.replace(/\s+/g, " ").trim(); };
  var NUM = [
    [/^(\d[\d\s]*) kun$/, "$1 дн."], [/^(\d[\d\s]*) kun oldin$/, "$1 дн. назад"],
    [/^(\d+) soat$/, "$1 ч"], [/^(\d+) soat oldin$/, "$1 ч назад"],
    [/^(\d+) daqiqa$/, "$1 мин"], [/^(\d+) daq oldin$/, "$1 мин назад"], [/^(\d+) daqiqa oldin$/, "$1 мин назад"],
    [/^(\d[\d\s]*) ta$/, "$1"], [/^(\d[\d\s]*) gap$/, "$1 фраз"], [/^(\d[\d\s]*) ta lid$/, "$1 лидов"],
    [/^hozir$/, "сейчас"], [/^ulangan$/, "подключено"],
    [/^Operator ishi — (\d+)\/100$/, "Работа оператора — $1/100"], [/^▸ dalil$/, "▸ доказательство"],
    [/^Yana (\d+) ta maydon aytilmagan$/, "Ещё $1 полей не прозвучало"]
  ];

  var MONTHS = { yanvar: "января", fevral: "февраля", mart: "марта", aprel: "апреля", may: "мая", iyun: "июня", iyul: "июля",
    avgust: "августа", sentabr: "сентября", oktabr: "октября", noyabr: "ноября", dekabr: "декабря" };
  var DATE_RE = /(\d{1,2})-(yanvar|fevral|mart|aprel|may|iyun|iyul|avgust|sentabr|oktabr|noyabr|dekabr)\b/g;
  function dates(s) {
    return s.replace(DATE_RE, function (_, d, m) { return d + " " + MONTHS[m]; })
      .replace(/— hozir\b/g, "— сейчас").replace(/\(oxirgi (\d+) kun\)/g, "(последние $1 дн.)")
      .replace(/(\d+) soat\b/g, "$1 ч").replace(/(\d+) kun\b/g, "$1 дн.").replace(/(\d+) daqiqa\b/g, "$1 мин");
  }
  function one(k) {
    if (Object.prototype.hasOwnProperty.call(D, k)) return D[k] === k ? null : D[k];
    for (var i = 0; i < NUM.length; i++) if (NUM[i][0].test(k)) return k.replace(NUM[i][0], NUM[i][1]);
    var m = k.match(/^(\d[\d\s]*) ta (.+)$/);
    if (m && D[m[2]]) return m[1] + " " + D[m[2]];
    return null;
  }
  function tr(text) {
    var k = norm(text);
    if (!k || !/[A-Za-z]/.test(k)) return null;
    var t = one(k);
    if (t !== null) return t;
    // Composite text "part · part · date": translate each part on its own.
    // Accepted only when every part is translated or is a name/number (no lowercase Uzbek words left), never half-and-half.
    if (k.indexOf(" · ") > 0) {
      var parts = k.split(" · "), changed = false, mixed = false;
      for (var p = 0; p < parts.length; p++) {
        var tp = one(parts[p]) || (dates(parts[p]) !== parts[p] ? dates(parts[p]) : null);
        if (tp !== null) { parts[p] = tp; changed = true; }
        else if (/(^|\s)[a-z‘’'ʻ]{3,}/.test(parts[p])) mixed = true;
      }
      if (changed && !mixed) return parts.join(" · ");
    }
    // Only whole strings and dates/units are translated: swapping phrases inside a sentence left half-Uzbek text.
    var out = dates(k);
    return out !== k ? out : null;
  }

  var ATTRS = ["placeholder", "title", "aria-label", "data-tip", "data-v2i", "alt"];
  var done = new WeakMap();
  function trText(node) {
    var v = node.nodeValue;
    if (done.get(node) === v) return;
    var t = tr(v);
    if (t !== null) {
      var lead = v.match(/^\s*/)[0], tail = v.match(/\s*$/)[0];
      v = lead + t + tail; node.nodeValue = v;
    }
    done.set(node, v);
  }
  function trAttrs(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i], v = el.getAttribute(a);
      if (!v) continue;
      var t = tr(v);
      if (t !== null) el.setAttribute(a, t);
    }
  }
  function walk(root) {
    if (root.nodeType === 3) { var p = root.parentNode; if (p && !/^(SCRIPT|STYLE)$/.test(p.nodeName)) trText(root); return; }
    if (root.nodeType !== 1 || /^(SCRIPT|STYLE)$/.test(root.nodeName)) return;
    trAttrs(root);
    var w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 3) { if (!/^(SCRIPT|STYLE)$/.test(n.parentNode.nodeName)) trText(n); }
      else trAttrs(n);
    }
  }

  function start() {
    document.title = tr(document.title) || document.title;
    walk(document.body);
    wireSwitch();
    new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        var r = list[i];
        if (r.type === "childList") for (var j = 0; j < r.addedNodes.length; j++) walk(r.addedNodes[j]);
        else if (r.type === "characterData") trText(r.target);
        else if (r.type === "attributes") {
          var v = r.target.getAttribute(r.attributeName), t = v ? tr(v) : null;
          if (t !== null && t !== v) r.target.setAttribute(r.attributeName, t);
        }
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
