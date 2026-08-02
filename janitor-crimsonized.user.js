// ==UserScript==
// @name         Janitor CRIMSONIZED
// @namespace    janitor-crimsonized
// @version      1.1.2
// @description  Restructured crimson frontend for janitorai.com: shelf based landing page, full width chat, NSFW filter, learned tag preferences and a proper control panel.
// @author       4G0NYY
// @match        https://janitorai.com/*
// @match        https://*.janitorai.com/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @downloadURL  https://raw.githubusercontent.com/4G0NYY/jai-crimsonized/main/janitor-crimsonized.user.js
// @updateURL    https://raw.githubusercontent.com/4G0NYY/jai-crimsonized/main/janitor-crimsonized.user.js
// @noframes
// ==/UserScript==

/*
 * Janitor CRIMSONIZED
 *
 * Design notes, in case you want to tweak things later:
 *
 * janitor.ai ships emotion / Chakra style class names (css-1a2b3c) that change on
 * every deploy, so nothing here matches on class names. Everything keys off things
 * that do not churn: route paths, link hrefs (/characters/<id>), element structure
 * and computed styles. The theming works by reading the colours the site already
 * uses and remapping them onto the crimson ramp, which means it keeps working even
 * when the site restyles itself.
 *
 * Panel: click the button in the bottom right, or press Alt+C.
 */

(function () {
  'use strict';

  var VERSION = '1.1.1';
  var K_SETTINGS = 'jc.settings.v1';
  var K_TASTE = 'jc.taste.v1';
  var K_SEEN = 'jc.seen.v1';
  var K_HIDDEN = 'jc.hidden.v1';
  var K_LIKED = 'jc.liked.v1';

  /* ================================================================
   * storage
   * ============================================================= */

  var store = {
    get: function (key, fallback) {
      var raw = null;
      try {
        if (typeof GM_getValue === 'function') raw = GM_getValue(key, null);
      } catch (e) { /* fall through to localStorage */ }
      if (raw === null || raw === undefined) {
        try { raw = localStorage.getItem(key); } catch (e) { raw = null; }
      }
      if (!raw) return fallback;
      try { return JSON.parse(raw); } catch (e) { return fallback; }
    },
    set: function (key, value) {
      var raw;
      try { raw = JSON.stringify(value); } catch (e) { return; }
      try {
        if (typeof GM_setValue === 'function') { GM_setValue(key, raw); }
      } catch (e) { /* ignore */ }
      try { localStorage.setItem(key, raw); } catch (e) { /* ignore */ }
    }
  };

  /* ================================================================
   * settings
   * ============================================================= */

  var DEFAULT_NSFW = [
    'nsfw', 'smut', 'explicit', 'erotic', 'lewd', 'hentai', 'porn', 'sex',
    'futa', 'futanari', 'incest', 'noncon', 'non-con', 'rape', 'bdsm',
    'breeding', 'harem', 'milf', 'yandere nsfw', 'furry nsfw'
  ];

  var DEFAULTS = {
    enabled: true,
    title: 'Janitor CRIMSONIZED',
    recolorSheets: true,
    // off | inline | deep. The stylesheet pass does almost all the work, so
    // scanning every element is nearly pure cost. See paintCandidates.
    paintMode: 'inline',

    shelves: true,
    shelfSize: 20,

    wide: true,
    contentWidth: 94,      // vw
    takeoverGrid: true,
    cardsPerRow: 0,        // 0 = auto fill
    cardMin: 200,          // px, used when cardsPerRow is 0
    msgFontSize: 16,       // px inside chat messages
    msgLineHeight: 1.65,

    hideNsfw: false,
    nsfwMode: 'blur',      // blur | hide
    nsfwTags: DEFAULT_NSFW.slice(),
    blockedTags: [],
    quickFilter: '',
    hideSeen: false,

    learn: true,
    sortByTaste: true,
    minScore: 0,

    debug: false
  };

  var S = Object.assign({}, DEFAULTS, store.get(K_SETTINGS, {}));
  // make sure arrays survive a partially written settings blob
  if (!Array.isArray(S.nsfwTags)) S.nsfwTags = DEFAULT_NSFW.slice();
  if (!Array.isArray(S.blockedTags)) S.blockedTags = [];
  // v1 stored a boolean here, and its "on" meant what deep mode means now
  if (typeof S.paintMode !== 'string') S.paintMode = S.recolorElements === false ? 'off' : 'inline';
  delete S.recolorElements;

  var taste = store.get(K_TASTE, {});
  var seen = store.get(K_SEEN, {});
  var hidden = store.get(K_HIDDEN, {});
  var liked = store.get(K_LIKED, {});
  var disposed = false;

  var tasteVersion = 0;

  function saveSettings() { store.set(K_SETTINGS, S); }
  // Every taste change goes through here, including the panel's delete and reset
  // buttons, so this is the one place that has to invalidate the shelves.
  function saveTaste() { tasteVersion++; store.set(K_TASTE, taste); }
  function saveSeen() { store.set(K_SEEN, seen); }
  function saveHidden() { store.set(K_HIDDEN, hidden); }
  function saveLiked() { store.set(K_LIKED, liked); }

  function log() {
    if (!S.debug) return;
    try { console.log.apply(console, ['%c[CRIMSONIZED]', 'color:#ff003c;font-weight:700'].concat([].slice.call(arguments))); } catch (e) { /* ignore */ }
  }

  /* ================================================================
   * colour engine
   * ============================================================= */

  var PALETTE = {
    c950: '#1a0005',
    c900: '#38020c',
    c800: '#5c0514',
    c700: '#8f071d',
    c600: '#c7042d',
    c500: '#ff003c',
    c400: '#ff4066',
    c300: '#ff7792',
    c200: '#ffaebe',
    c100: '#ffe5ea',
    c50: '#fff5f6'
  };

  // The ramp the recolour maps neutral colours onto, darkest first.
  var RAMP = ['#080002', '#0d0004', '#1a0005', '#240108', '#38020c', '#4a0310',
    '#5c0514', '#750620', '#8f071d', '#c7042d', '#ff003c', '#ff4066',
    '#ff7792', '#ffaebe', '#ffe5ea', '#fff5f6'];

  var NAMED = {
    white: '#ffffff', black: '#000000', red: '#ff0000', silver: '#c0c0c0',
    gray: '#808080', grey: '#808080', lightgray: '#d3d3d3', lightgrey: '#d3d3d3',
    darkgray: '#a9a9a9', darkgrey: '#a9a9a9', whitesmoke: '#f5f5f5',
    gainsboro: '#dcdcdc', blue: '#0000ff', green: '#008000', orange: '#ffa500',
    yellow: '#ffff00', purple: '#800080', pink: '#ffc0cb', teal: '#008080',
    navy: '#000080', maroon: '#800000', lime: '#00ff00', cyan: '#00ffff',
    aqua: '#00ffff', magenta: '#ff00ff', fuchsia: '#ff00ff'
  };

  function parseColor(input) {
    if (!input) return null;
    var s = String(input).trim().toLowerCase();
    if (!s) return null;
    if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    if (s === 'currentcolor' || s === 'inherit' || s === 'initial' ||
      s === 'unset' || s === 'revert' || s === 'none' || s === 'auto') return null;
    if (NAMED[s]) s = NAMED[s];

    if (s.charAt(0) === '#') {
      var hex = s.slice(1);
      if (hex.length === 3 || hex.length === 4) {
        hex = hex.split('').map(function (c) { return c + c; }).join('');
      }
      if (hex.length !== 6 && hex.length !== 8) return null;
      var n = parseInt(hex.slice(0, 6), 16);
      if (isNaN(n)) return null;
      return {
        r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255,
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
      };
    }

    var m = s.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      var p = m[1].split(/[\s,\/]+/).filter(Boolean);
      if (p.length < 3) return null;
      var chan = function (v, max) {
        if (v.charAt(v.length - 1) === '%') return parseFloat(v) / 100 * max;
        return parseFloat(v);
      };
      var r = chan(p[0], 255), g = chan(p[1], 255), b = chan(p[2], 255), a = 1;
      if (p[3] !== undefined) a = p[3].charAt(p[3].length - 1) === '%' ? parseFloat(p[3]) / 100 : parseFloat(p[3]);
      if ([r, g, b, a].some(function (v) { return isNaN(v); })) return null;
      return { r: r, g: g, b: b, a: a };
    }

    var hm = s.match(/^hsla?\(([^)]+)\)$/);
    if (hm) {
      var hp = hm[1].split(/[\s,\/]+/).filter(Boolean);
      if (hp.length < 3) return null;
      var hh = parseFloat(hp[0]);
      var ss = parseFloat(hp[1]) / 100;
      var ll = parseFloat(hp[2]) / 100;
      var ha = 1;
      if (hp[3] !== undefined) ha = hp[3].charAt(hp[3].length - 1) === '%' ? parseFloat(hp[3]) / 100 : parseFloat(hp[3]);
      if ([hh, ss, ll, ha].some(function (v) { return isNaN(v); })) return null;
      var rgb = hsl2rgb(hh, ss, ll);
      rgb.a = ha;
      return rgb;
    }
    return null;
  }

  function rgb2hsl(c) {
    var r = c.r / 255, g = c.g / 255, b = c.b / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h = 0, s = 0, l = (max + min) / 2;
    var d = max - min;
    if (d !== 0) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (max === g) h = ((b - r) / d + 2);
      else h = ((r - g) / d + 4);
      h *= 60;
    }
    return { h: h, s: s, l: l };
  }

  function hsl2rgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    var r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      var p = 2 * l - q;
      var hue = function (t) {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      r = hue(h + 1 / 3); g = hue(h); b = hue(h - 1 / 3);
    }
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255), a: 1 };
  }

  function luminance(c) {
    return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
  }

  var rampCache = null;
  function rampAt(t) {
    if (!rampCache) {
      rampCache = RAMP.map(function (hex) { return parseColor(hex); });
    }
    t = Math.max(0, Math.min(1, t));
    var pos = t * (rampCache.length - 1);
    var i = Math.floor(pos);
    var j = Math.min(rampCache.length - 1, i + 1);
    var f = pos - i;
    var a = rampCache[i], b = rampCache[j];
    return {
      r: Math.round(a.r + (b.r - a.r) * f),
      g: Math.round(a.g + (b.g - a.g) * f),
      b: Math.round(a.b + (b.b - a.b) * f),
      a: 1
    };
  }

  var mapCache = Object.create(null);
  // Every colour we have ever emitted, normalised. Re-reading our own output
  // (which happens whenever the site rewrites an element's style attribute)
  // must be a no-op, otherwise colours drift darker on every pass.
  var produced = new Set();

  /*
   * Remap a single colour onto the crimson world.
   * Neutral colours ride the ramp by luminance, saturated colours keep their
   * lightness but get rotated into the crimson hue window so accents stay accents.
   */
  function remap(input, kind) {
    if (input == null) return null;
    if (produced.has(String(input).replace(/\s+/g, ''))) return String(input);
    var ck = kind + '|' + input;
    if (ck in mapCache) return mapCache[ck];

    var c = parseColor(input);
    var out = null;
    if (c && c.a !== 0) {
      var hsl = rgb2hsl(c);
      // Chroma, not HSL saturation: near black colours with a slight blue cast
      // (every Chakra grey) read as heavily saturated in HSL and would otherwise
      // survive as muddy brown instead of dropping onto the crimson ramp.
      var chroma = (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) / 255;
      var res;
      if (chroma < 0.18) {
        var lum = luminance(c);
        if (kind === 'text') {
          // Text lives in the light half of the ramp so it stays readable
          // instead of turning into a saturated mid crimson.
          res = lum > 0.82 ? parseColor(PALETTE.c50) : rampAt(0.60 + lum * 0.38);
        } else {
          res = rampAt(lum);
        }
      } else {
        // keep the accent, move the hue into the crimson band (338 to 358)
        var band = 338 + ((((hsl.h % 60) + 60) % 60) / 60) * 20;
        var sat = Math.min(1, hsl.s * 1.05 + 0.05);
        var lig = hsl.l;
        if (kind === 'bg' && lig > 0.62) lig = 0.5;
        res = hsl2rgb(band, sat, lig);
      }
      out = 'rgba(' + res.r + ',' + res.g + ',' + res.b + ',' + round3(c.a) + ')';
      produced.add(out);
      // getComputedStyle reports opaque colours as rgb(), so register that too
      produced.add('rgb(' + res.r + ',' + res.g + ',' + res.b + ')');
    }
    mapCache[ck] = out;
    return out;
  }

  function round3(n) { return Math.round(n * 1000) / 1000; }

  var COLOR_TOKEN = /(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\))/g;

  function remapAllColors(value, kind) {
    if (!value || value.indexOf('var(') !== -1) return null;
    var touched = false;
    var out = value.replace(COLOR_TOKEN, function (tok) {
      var mapped = remap(tok, kind);
      if (!mapped) return tok;
      touched = true;
      return mapped;
    });
    return touched ? out : null;
  }

  /* ================================================================
   * base theme
   * ============================================================= */

  function css() {
    return [
      ':root{',
      '--jc-950:' + PALETTE.c950 + ';--jc-900:' + PALETTE.c900 + ';--jc-800:' + PALETTE.c800 + ';',
      '--jc-700:' + PALETTE.c700 + ';--jc-600:' + PALETTE.c600 + ';--jc-500:' + PALETTE.c500 + ';',
      '--jc-400:' + PALETTE.c400 + ';--jc-300:' + PALETTE.c300 + ';--jc-200:' + PALETTE.c200 + ';',
      '--jc-100:' + PALETTE.c100 + ';--jc-50:' + PALETTE.c50 + ';',
      '--jc-wide:94vw;--jc-card-min:200px;--jc-msg-fs:16px;--jc-msg-lh:1.65;',
      '--jc-radius:18px;',
      '}',

      /* canvas */
      'html.jc-on,html.jc-on body{background-color:var(--jc-950)!important;color:var(--jc-100);}',
      'html.jc-on body{',
      'background-image:radial-gradient(1100px 560px at 12% -12%,rgba(143,7,29,.40),transparent 62%),',
      'radial-gradient(900px 520px at 108% 4%,rgba(255,0,60,.13),transparent 58%),',
      'radial-gradient(1000px 700px at 50% 120%,rgba(92,5,20,.35),transparent 60%)!important;',
      'background-attachment:fixed!important;background-repeat:no-repeat!important;',
      '}',

      /* scrollbars */
      'html.jc-on *{scrollbar-color:var(--jc-700) transparent;scrollbar-width:thin;}',
      'html.jc-on ::-webkit-scrollbar{width:10px;height:10px;}',
      'html.jc-on ::-webkit-scrollbar-track{background:rgba(255,0,60,.05);}',
      'html.jc-on ::-webkit-scrollbar-thumb{background:linear-gradient(180deg,var(--jc-600),var(--jc-800));border-radius:999px;border:2px solid transparent;background-clip:padding-box;}',
      'html.jc-on ::-webkit-scrollbar-thumb:hover{background:linear-gradient(180deg,var(--jc-500),var(--jc-700));background-clip:padding-box;}',
      'html.jc-on ::selection{background:rgba(255,0,60,.35);color:#fff;}',

      /* focus rings */
      'html.jc-on :focus-visible{outline:2px solid var(--jc-500)!important;outline-offset:2px!important;}',

      /* links and inputs */
      'html.jc-on a:hover{color:var(--jc-400)!important;}',
      'html.jc-on input::placeholder,html.jc-on textarea::placeholder{color:rgba(255,119,146,.45)!important;}',
      'html.jc-on input:focus,html.jc-on textarea:focus{border-color:rgba(255,0,60,.55)!important;box-shadow:0 0 0 3px rgba(255,0,60,.12)!important;}',

      /* wide layout */
      'html.jc-wide [data-jc-unclamped]{max-width:var(--jc-wide)!important;width:100%!important;}',

      /* card grid takeover */
      'html.jc-on [data-jc-grid]{display:grid!important;width:100%!important;max-width:none!important;',
      'grid-template-columns:repeat(auto-fill,minmax(var(--jc-card-min),1fr))!important;',
      'gap:18px!important;align-items:stretch!important;justify-content:start!important;}',
      'html.jc-on [data-jc-grid][data-jc-cols="3"]{grid-template-columns:repeat(3,minmax(0,1fr))!important;}',
      'html.jc-on [data-jc-grid][data-jc-cols="4"]{grid-template-columns:repeat(4,minmax(0,1fr))!important;}',
      'html.jc-on [data-jc-grid][data-jc-cols="5"]{grid-template-columns:repeat(5,minmax(0,1fr))!important;}',
      'html.jc-on [data-jc-grid][data-jc-cols="6"]{grid-template-columns:repeat(6,minmax(0,1fr))!important;}',
      'html.jc-on [data-jc-grid][data-jc-cols="7"]{grid-template-columns:repeat(7,minmax(0,1fr))!important;}',
      'html.jc-on [data-jc-grid][data-jc-cols="8"]{grid-template-columns:repeat(8,minmax(0,1fr))!important;}',

      /* cards */
      /* background-color only, never the shorthand, so cards that carry their
         art as a background-image keep it */
      'html.jc-on [data-jc-card]{position:relative!important;width:auto!important;max-width:none!important;',
      'min-width:0!important;border-radius:var(--jc-radius)!important;overflow:hidden!important;',
      'background-color:rgba(26,0,5,.45)!important;',
      'border:1px solid rgba(143,7,29,.45)!important;',
      'box-shadow:inset 0 -70px 60px -50px rgba(26,0,5,.85)!important;',
      'transition:transform .35s cubic-bezier(.2,.8,.2,1),box-shadow .45s,border-color .45s!important;}',
      'html.jc-on [data-jc-card]:hover{transform:translateY(-5px)!important;border-color:rgba(255,0,60,.55)!important;',
      'box-shadow:inset 0 -70px 60px -50px rgba(26,0,5,.85),0 18px 42px rgba(255,0,60,.20),0 4px 14px rgba(0,0,0,.6)!important;}',
      'html.jc-on [data-jc-card] img{transition:transform .7s cubic-bezier(.2,.8,.2,1)!important;}',
      'html.jc-on [data-jc-card]:hover img{transform:scale(1.06)!important;}',

      /* card action buttons */
      'html.jc-on .jc-fx{position:absolute!important;top:8px;right:8px;display:flex;gap:6px;z-index:40;',
      'opacity:0;transform:translateY(-6px);transition:opacity .25s,transform .25s;pointer-events:none;}',
      'html.jc-on [data-jc-card]:hover .jc-fx{opacity:1;transform:none;pointer-events:auto;}',
      'html.jc-on .jc-fx button{all:unset;cursor:pointer;width:28px;height:28px;display:grid;place-items:center;',
      'border-radius:999px;font-size:13px;line-height:1;color:var(--jc-100);',
      'background:rgba(26,0,5,.82);border:1px solid rgba(255,0,60,.35);backdrop-filter:blur(6px);',
      'box-shadow:0 4px 14px rgba(0,0,0,.5);transition:background .2s,transform .2s,border-color .2s;}',
      'html.jc-on .jc-fx button:hover{background:var(--jc-600);border-color:var(--jc-400);transform:scale(1.12);}',
      'html.jc-on .jc-fx button[data-act="hide"]:hover{background:var(--jc-800);}',

      /* taste badge */
      'html.jc-on .jc-score{position:absolute!important;top:8px;left:8px;z-index:39;',
      'padding:3px 7px;border-radius:999px;font-size:9px;font-weight:900;letter-spacing:.12em;',
      'text-transform:uppercase;color:var(--jc-100);background:rgba(26,0,5,.8);',
      'border:1px solid rgba(255,0,60,.3);pointer-events:none;opacity:.85;}',

      /* filtering */
      'html.jc-on [data-jc-card][data-jc-off]{display:none!important;}',
      'html.jc-on [data-jc-card][data-jc-blur] > *{filter:blur(16px) saturate(.5)!important;}',
      'html.jc-on [data-jc-card][data-jc-blur]{position:relative!important;}',
      'html.jc-on [data-jc-card][data-jc-blur]::after{content:"NSFW / click to reveal";position:absolute;inset:0;',
      'display:grid;place-items:center;text-align:center;padding:12px;z-index:30;',
      'font-size:10px;font-weight:900;letter-spacing:.2em;text-transform:uppercase;',
      'color:var(--jc-300);background:rgba(26,0,5,.55);pointer-events:none;}',
      'html.jc-on [data-jc-card][data-jc-revealed] > *{filter:none!important;}',
      'html.jc-on [data-jc-card][data-jc-revealed]::after{display:none!important;}',

      /* chat messages */
      'html.jc-chat [data-jc-msg]{font-size:var(--jc-msg-fs)!important;line-height:var(--jc-msg-lh)!important;}',
      'html.jc-chat [data-jc-msg] p,html.jc-chat [data-jc-msg] span,html.jc-chat [data-jc-msg] div,',
      'html.jc-chat [data-jc-msg] li,html.jc-chat [data-jc-msg] em,html.jc-chat [data-jc-msg] strong{',
      'font-size:var(--jc-msg-fs)!important;line-height:var(--jc-msg-lh)!important;}',
      'html.jc-chat [data-jc-msg] em,html.jc-chat [data-jc-msg] i{color:var(--jc-300)!important;font-style:italic!important;}',
      'html.jc-chat [data-jc-msg] q,html.jc-chat [data-jc-msg] strong{color:var(--jc-50)!important;}',

      /* ---------- the revamped landing page ---------- */
      'html.jc-on [data-jc-native-hidden]{display:none!important;}',
      '.jc-shelves{display:block!important;width:100%!important;margin:10px 0 48px!important;}',
      '.jc-shelf{margin:0 0 34px!important;}',
      '.jc-shelf-head{display:flex!important;align-items:center!important;gap:12px!important;margin:0 0 14px!important;}',
      '.jc-shelf-bar{width:6px!important;height:26px!important;border-radius:999px!important;flex:none!important;',
      'background:var(--jc-500)!important;box-shadow:0 0 16px rgba(255,0,60,.7)!important;}',
      '.jc-shelf-title{margin:0!important;font-size:19px!important;font-weight:900!important;line-height:1.1!important;',
      'letter-spacing:-.02em!important;text-transform:uppercase!important;color:#fff!important;}',
      '.jc-shelf-hint{font-size:9px!important;font-weight:900!important;letter-spacing:.18em!important;',
      'text-transform:uppercase!important;color:var(--jc-700)!important;white-space:nowrap!important;',
      'overflow:hidden!important;text-overflow:ellipsis!important;}',
      '.jc-shelf-nav{margin-left:auto!important;display:flex!important;gap:8px!important;flex:none!important;}',
      '.jc-shelf-nav button{all:unset!important;cursor:pointer!important;width:32px!important;height:32px!important;',
      'display:grid!important;place-items:center!important;border-radius:999px!important;font-size:17px!important;',
      'color:var(--jc-100)!important;background:rgba(56,2,12,.6)!important;border:1px solid rgba(143,7,29,.7)!important;',
      'transition:background .2s,border-color .2s,transform .2s!important;}',
      '.jc-shelf-nav button:hover{background:var(--jc-600)!important;border-color:var(--jc-400)!important;transform:scale(1.1)!important;}',

      '.jc-rail{display:flex!important;gap:14px!important;overflow-x:auto!important;overflow-y:hidden!important;',
      'padding:4px 2px 14px!important;scroll-behavior:smooth!important;cursor:grab!important;',
      'scrollbar-width:thin!important;overscroll-behavior-x:contain!important;}',
      '.jc-rail.jc-dragging{cursor:grabbing!important;scroll-behavior:auto!important;user-select:none!important;}',
      '.jc-rail.jc-dragging *{pointer-events:none!important;}',

      '.jc-tile{position:relative!important;flex:0 0 auto!important;width:186px!important;display:block!important;',
      'text-decoration:none!important;border-radius:16px!important;overflow:hidden!important;',
      'background:linear-gradient(180deg,rgba(56,2,12,.45),rgba(13,0,4,.92))!important;',
      'border:1px solid rgba(143,7,29,.5)!important;',
      'transition:transform .3s cubic-bezier(.2,.8,.2,1),border-color .3s,box-shadow .4s!important;}',
      '.jc-tile:hover{transform:translateY(-5px)!important;border-color:rgba(255,0,60,.6)!important;',
      'box-shadow:0 16px 36px rgba(255,0,60,.22),0 4px 12px rgba(0,0,0,.6)!important;}',
      '.jc-tile[data-jc-liked]{border-color:rgba(255,0,60,.55)!important;box-shadow:0 0 0 1px rgba(255,0,60,.25)!important;}',
      '.jc-thumb{position:relative!important;width:100%!important;aspect-ratio:3/4!important;',
      'overflow:hidden!important;background:#1a0005!important;}',
      '.jc-thumb img{width:100%!important;height:100%!important;object-fit:cover!important;display:block!important;',
      'transition:transform .6s cubic-bezier(.2,.8,.2,1)!important;}',
      '.jc-tile:hover .jc-thumb img{transform:scale(1.07)!important;}',
      '.jc-tile-body{padding:10px 11px 12px!important;}',
      '.jc-tile-name{font-size:13px!important;font-weight:800!important;color:var(--jc-50)!important;line-height:1.25!important;',
      'display:-webkit-box!important;-webkit-line-clamp:2!important;-webkit-box-orient:vertical!important;overflow:hidden!important;}',
      '.jc-tile-by{margin-top:3px!important;font-size:10px!important;font-weight:700!important;color:var(--jc-700)!important;',
      'white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;}',
      '.jc-tile-tags{display:flex!important;flex-wrap:wrap!important;gap:4px!important;margin-top:8px!important;',
      'max-height:38px!important;overflow:hidden!important;}',
      '.jc-chip{font-size:9px!important;font-weight:800!important;padding:2px 6px!important;border-radius:999px!important;',
      'background:rgba(255,0,60,.1)!important;border:1px solid rgba(255,0,60,.25)!important;color:var(--jc-200)!important;',
      'white-space:nowrap!important;}',
      '.jc-tile-stats{margin-top:8px!important;font-size:9px!important;font-weight:900!important;letter-spacing:.12em!important;',
      'text-transform:uppercase!important;color:var(--jc-600)!important;}',
      '.jc-tile[data-jc-blur] .jc-thumb img{filter:blur(16px) saturate(.5)!important;}',
      '.jc-tile[data-jc-blur] .jc-thumb::after{content:"NSFW"!important;position:absolute!important;inset:0!important;',
      'display:grid!important;place-items:center!important;font-size:10px!important;font-weight:900!important;',
      'letter-spacing:.2em!important;color:var(--jc-300)!important;background:rgba(26,0,5,.5)!important;}',
      'html.jc-on .jc-tile:hover .jc-fx{opacity:1!important;transform:none!important;pointer-events:auto!important;}',
      '.jc-skel{height:270px!important;background:linear-gradient(180deg,rgba(56,2,12,.3),rgba(13,0,4,.7))!important;',
      'border:1px dashed rgba(143,7,29,.45)!important;animation:jcpulse 1.6s ease-in-out infinite!important;}',
      '@keyframes jcpulse{0%,100%{opacity:.45}50%{opacity:.85}}',
      '.jc-empty{padding:26px 22px!important;border-radius:16px!important;border:1px dashed rgba(143,7,29,.5)!important;',
      'background:rgba(26,0,5,.4)!important;color:var(--jc-700)!important;font-size:11px!important;font-weight:800!important;',
      'letter-spacing:.05em!important;max-width:520px!important;line-height:1.6!important;}',

      /* keep our own UI out of the theme engine, including out of the rules
         we re-emit from the site with !important on them */
      'html.jc-on #jc-root{all:revert!important;}'
    ].join('');
  }

  var themeStyle = null;
  var recolorStyle = null;

  function injectStyles() {
    if (!themeStyle) {
      themeStyle = document.createElement('style');
      themeStyle.id = 'jc-theme';
      themeStyle.setAttribute('data-jc', '1');
      themeStyle.textContent = css();
      (document.head || document.documentElement).appendChild(themeStyle);
    }
    if (!recolorStyle) {
      recolorStyle = document.createElement('style');
      recolorStyle.id = 'jc-recolor';
      recolorStyle.setAttribute('data-jc', '1');
      (document.head || document.documentElement).appendChild(recolorStyle);
    }
  }

  function applyRootVars() {
    var r = document.documentElement;
    r.style.setProperty('--jc-wide', S.contentWidth + 'vw');
    r.style.setProperty('--jc-card-min', S.cardMin + 'px');
    r.style.setProperty('--jc-msg-fs', S.msgFontSize + 'px');
    r.style.setProperty('--jc-msg-lh', String(S.msgLineHeight));
    r.classList.toggle('jc-on', !!S.enabled);
    r.classList.toggle('jc-wide', !!(S.enabled && S.wide));
    r.classList.toggle('jc-chat', !!(S.enabled && isChat()));
  }

  /* ================================================================
   * recolour pass 1: rewrite the site stylesheets
   * ============================================================= */

  var SHEET_PROPS = [
    ['background-color', 'bg'],
    ['color', 'text'],
    ['border-top-color', 'border'],
    ['border-right-color', 'border'],
    ['border-bottom-color', 'border'],
    ['border-left-color', 'border'],
    ['outline-color', 'border'],
    ['box-shadow', 'shadow'],
    ['text-decoration-color', 'text'],
    ['caret-color', 'text'],
    ['fill', 'text'],
    ['stroke', 'border'],
    ['background-image', 'bg']
  ];

  var lastSheetSignature = '';
  var sheetCache = new WeakMap();   // CSSStyleSheet -> { count, out }
  var lastSheetRun = 0;
  var sheetRetry = null;

  function recolorSheets() {
    if (!S.enabled || !S.recolorSheets) {
      if (recolorStyle) recolorStyle.textContent = '';
      return;
    }

    // The site injects emotion rules constantly, so throttle the walk.
    var now = Date.now();
    if (now - lastSheetRun < 1200) {
      if (!sheetRetry) {
        sheetRetry = setTimeout(function () { sheetRetry = null; recolorSheets(); }, 1200 - (now - lastSheetRun));
      }
      return;
    }

    var sheets = document.styleSheets;
    var usable = [];
    var signature = sheets.length + ':';

    for (var i = 0; i < sheets.length; i++) {
      var sheet = sheets[i];
      try {
        if (sheet.ownerNode && sheet.ownerNode.getAttribute && sheet.ownerNode.getAttribute('data-jc')) continue;
      } catch (e) { /* ignore */ }
      var rules = null;
      try { rules = sheet.cssRules; } catch (e) { continue; }
      if (!rules) continue;
      signature += rules.length + ',';
      usable.push([sheet, rules]);
    }

    if (signature === lastSheetSignature) return;
    lastSheetSignature = signature;
    lastSheetRun = now;

    var chunks = [];
    for (var j = 0; j < usable.length; j++) {
      var sh = usable[j][0], rl = usable[j][1];
      var cached = sheetCache.get(sh);
      if (cached && cached.count === rl.length) {
        chunks.push(cached.out);
        continue;
      }
      var out = [];
      walkRules(rl, out);
      var text = out.join('\n');
      sheetCache.set(sh, { count: rl.length, out: text });
      chunks.push(text);
    }

    recolorStyle.textContent = chunks.join('\n');
    log('recoloured sheets:', usable.length, 'bytes:', recolorStyle.textContent.length);
  }

  function walkRules(rules, out) {
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      var type = rule.type;
      if (type === 1) {                       // style rule
        var body = rewriteDeclarations(rule.style);
        if (body) out.push(rule.selectorText + '{' + body + '}');
      } else if (type === 4 || type === 12) { // media / supports
        var inner = [];
        try { walkRules(rule.cssRules, inner); } catch (e) { continue; }
        if (inner.length) {
          var cond = type === 4 ? '@media ' + rule.conditionText : '@supports ' + rule.conditionText;
          out.push(cond + '{' + inner.join('\n') + '}');
        }
      }
    }
  }

  function rewriteDeclarations(style) {
    var parts = [];
    for (var i = 0; i < SHEET_PROPS.length; i++) {
      var prop = SHEET_PROPS[i][0];
      var kind = SHEET_PROPS[i][1];
      var value;
      try { value = style.getPropertyValue(prop); } catch (e) { continue; }
      if (!value) continue;
      if (prop === 'background-image' && value.indexOf('gradient(') === -1) continue;
      var mapped = remapAllColors(value, kind);
      if (mapped) parts.push(prop + ':' + mapped + ' !important');
    }

    // Custom properties are where Chakra keeps its palette, so remapping the
    // tokens themselves recolours everything that resolves through var().
    for (var j = 0; j < style.length; j++) {
      var name = style[j];
      if (!name || name.slice(0, 2) !== '--') continue;
      var raw;
      try { raw = style.getPropertyValue(name); } catch (e) { continue; }
      if (!raw || raw.indexOf('var(') !== -1) continue;
      var token = remapAllColors(raw, 'bg');
      if (token) parts.push(name + ':' + token + ' !important');
    }

    return parts.join(';');
  }

  /* ================================================================
   * recolour pass 2: elements carrying inline styles or unreadable sheets
   * ============================================================= */

  var ELEM_PROPS = [
    ['background-color', 'bg'],
    ['color', 'text'],
    ['border-top-color', 'border'],
    ['border-right-color', 'border'],
    ['border-bottom-color', 'border'],
    ['border-left-color', 'border']
  ];

  var paintQueue = [];
  var paintScheduled = false;
  var paintedStyle = new WeakMap();   // element -> the style attribute we last wrote

  var idle = window.requestIdleCallback
    ? window.requestIdleCallback.bind(window)
    : function (fn) { return setTimeout(fn, 16); };

  /*
   * The whole reason this file is careful about read and write ordering.
   *
   * Writing an inline style invalidates style for the document, so a
   * getComputedStyle immediately afterwards forces a full recalculation. Reading
   * and writing one element at a time therefore costs one recalc per element:
   * measured on the janitor.ai home page that was 1002ms for 600 elements, which
   * is the multi second freeze on load. The same 600 elements cost 6ms when all
   * the reads happen first and all the writes follow. So: collect, then apply,
   * in chunks, with a frame budget so nothing ever becomes a long task.
   */
  /*
   * Which elements are worth measuring.
   *
   * Measured on the live site: the stylesheet pass alone (which also rewrites the
   * Chakra colour tokens) themes the page essentially completely. Switching the
   * element pass off and stripping all 1773 of its inline overrides changed two
   * avatar rings and nothing else, while that pass was reading 11k computed
   * values per sweep. So the default only looks at elements that carry an inline
   * colour of their own, which is the one thing a stylesheet rewrite cannot
   * reach. On the character page that is a single element instead of 1844.
   */
  var INLINE_COLOR = /(^|[^-\w])(color|background|border|outline|fill|stroke|shadow)|#[0-9a-f]{3}|rgba?\(|hsla?\(|gradient\(/i;

  function paintCandidates(root, out) {
    if (!root || root.nodeType !== 1 || !root.isConnected) return;
    if (root.id === 'jc-root' || (root.closest && root.closest('[data-jc-ui]'))) return;

    if (S.paintMode === 'deep') {
      out.push(root);
      var all = root.querySelectorAll('*');
      for (var i = 0; i < all.length; i++) out.push(all[i]);
      return;
    }

    var rootStyle = root.getAttribute && root.getAttribute('style');
    if (rootStyle && INLINE_COLOR.test(rootStyle)) out.push(root);
    var styled = root.querySelectorAll('[style]');
    for (var j = 0; j < styled.length; j++) {
      var s = styled[j].getAttribute('style');
      if (s && INLINE_COLOR.test(s)) out.push(styled[j]);
    }
  }

  function paintElements(list) {
    var i = 0;
    function chunk() {
      if (disposed || !S.enabled || S.paintMode === 'off') return;
      var started = performance.now();
      while (i < list.length) {
        var end = Math.min(i + 250, list.length);
        var writes = [];
        for (var r = i; r < end; r++) collectPaint(list[r], writes);   // reads only
        for (var w = 0; w < writes.length; w++) {                      // writes only
          var job = writes[w];
          if (job.attr) job.el.setAttribute(job.prop, job.value);
          else job.el.style.setProperty(job.prop, job.value, 'important');
        }
        for (var m = i; m < end; m++) {
          var el = list[m];
          if (el && el.nodeType === 1) paintedStyle.set(el, el.getAttribute('style'));
        }
        i = end;
        if (performance.now() - started > 8) break;
      }
      if (i < list.length) idle(chunk, { timeout: 400 });
    }
    idle(chunk, { timeout: 400 });
  }

  function collectPaint(el, out) {
    if (!el || el.nodeType !== 1 || !el.isConnected) return;
    if (el.id === 'jc-root' || el.hasAttribute('data-jc-ui')) return;
    var tag = el.tagName;
    if (tag === 'IMG' || tag === 'VIDEO' || tag === 'CANVAS' || tag === 'IFRAME' ||
      tag === 'STYLE' || tag === 'SCRIPT' || tag === 'LINK') return;

    // Nothing changed since our last write, so there is nothing to do.
    if (paintedStyle.get(el) === el.getAttribute('style')) return;

    var cs;
    try { cs = getComputedStyle(el); } catch (e) { return; }
    if (!cs) return;

    var wrote = false;
    for (var i = 0; i < ELEM_PROPS.length; i++) {
      var prop = ELEM_PROPS[i][0];
      var current = cs.getPropertyValue(prop);
      if (!current) continue;
      var parsed = parseColor(current);
      if (!parsed || parsed.a === 0) continue;
      var mapped = remap(current, ELEM_PROPS[i][1]);
      if (!mapped) continue;
      if (el.style.getPropertyValue(prop) === mapped) continue;
      out.push({ el: el, prop: prop, value: mapped });
      wrote = true;
    }

    // Inline gradients: janitor.ai paints each character page banner with an
    // inline linear-gradient, which no stylesheet rewrite can reach.
    var bgi = cs.getPropertyValue('background-image');
    if (bgi && bgi.indexOf('gradient(') !== -1) {
      var mappedBgi = remapAllColors(bgi, 'bg');
      if (mappedBgi && el.style.getPropertyValue('background-image') !== mappedBgi) {
        out.push({ el: el, prop: 'background-image', value: mappedBgi });
        wrote = true;
      }
    }

    if (el instanceof SVGElement) {
      for (var s = 0; s < 2; s++) {
        var sp = s === 0 ? 'fill' : 'stroke';
        var cur = cs.getPropertyValue(sp);
        if (!cur || cur === 'none') continue;
        var mp = remap(cur, sp === 'fill' ? 'text' : 'border');
        if (!mp || el.style.getPropertyValue(sp) === mp) continue;
        out.push({ el: el, prop: sp, value: mp });
        wrote = true;
      }
    }

    if (wrote) out.push({ el: el, prop: 'data-jc-painted', value: '', attr: true });
  }

  function queuePaint(root) {
    if (!S.enabled || S.paintMode === 'off') return;
    paintQueue.push(root || document.body);
    if (paintScheduled) return;
    paintScheduled = true;
    idle(function () {
      paintScheduled = false;
      var batch = paintQueue;
      paintQueue = [];
      var list = [];
      try {
        for (var i = 0; i < batch.length; i++) paintCandidates(batch[i], list);
      } catch (e) { log('paint collect failed', e); }
      if (list.length) paintElements(list);
    }, { timeout: 400 });
  }

  function unpaintAll() {
    var nodes = document.querySelectorAll('[data-jc-painted]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      for (var j = 0; j < ELEM_PROPS.length; j++) el.style.removeProperty(ELEM_PROPS[j][0]);
      el.style.removeProperty('fill');
      el.style.removeProperty('stroke');
      el.style.removeProperty('background-image');
      el.removeAttribute('data-jc-painted');
    }
    paintedStyle = new WeakMap();
  }

  /* ================================================================
   * layout: unclamp the narrow containers
   * ============================================================= */

  var widthChecked = new WeakSet();

  function unclampWidths() {
    if (!S.enabled || !S.wide) return;
    var root = document.querySelector('main') || document.body;
    if (!root) return;
    var nodes = root.querySelectorAll('div,main,section,article,form,ul,ol,header,footer,nav');
    var limit = Math.min(nodes.length, 2500);
    var hits = [];
    // read pass, no writes in between (see paintElements for why)
    for (var i = 0; i < limit; i++) {
      var el = nodes[i];
      if (widthChecked.has(el)) continue;
      if (el.id === 'jc-root' || el.hasAttribute('data-jc-ui')) continue;
      widthChecked.add(el);
      var cs;
      try { cs = getComputedStyle(el); } catch (e) { continue; }
      var mw = cs.maxWidth;
      if (!mw || mw === 'none') continue;
      if (mw.slice(-2) !== 'px') continue;
      var px = parseFloat(mw);
      // narrow reading columns only, leave avatars and small widgets alone
      if (isNaN(px) || px < 420 || px > 1500) continue;
      hits.push(el);
    }
    // write pass
    for (var j = 0; j < hits.length; j++) hits[j].setAttribute('data-jc-unclamped', '');
  }

  function reclampAll() {
    var nodes = document.querySelectorAll('[data-jc-unclamped]');
    for (var i = 0; i < nodes.length; i++) nodes[i].removeAttribute('data-jc-unclamped');
    widthChecked = new WeakSet();
  }

  /* ================================================================
   * chat message detection
   * ============================================================= */

  function isChat() {
    return /^\/chats?\//.test(location.pathname);
  }

  function markMessages() {
    if (!S.enabled || !isChat()) return;
    var root = document.querySelector('main') || document.body;
    if (!root) return;
    var nodes = root.querySelectorAll('p,div,span,article');
    for (var i = nodes.length - 1; i >= 0; i--) {
      var el = nodes[i];
      if (el.hasAttribute('data-jc-msg')) continue;
      if (el.closest('#jc-root')) continue;
      var text = el.textContent || '';
      if (text.length < 60) continue;
      if (el.querySelector('[data-jc-msg]')) continue;   // an inner block already claimed it
      if (el.querySelector('input,textarea,button')) continue;
      el.setAttribute('data-jc-msg', '');
    }
  }

  /* ================================================================
   * character cards
   * ============================================================= */

  var CARD_SEL = 'a[href*="/characters/"],a[href*="/character/"]';

  function characterId(href) {
    if (!href) return '';
    var m = href.match(/\/characters?\/([^/?#]+)/);
    if (!m) return '';
    return m[1].split('_')[0];
  }

  function cardWrapper(link) {
    var el = link;
    for (var i = 0; i < 6; i++) {
      var p = el.parentElement;
      if (!p || p === document.body || p.tagName === 'MAIN') break;
      if (p.querySelectorAll(CARD_SEL).length !== 1) break;
      el = p;
    }
    return el;
  }

  /*
   * With the tag vocabulary loaded this is exact: a leaf is a tag when it is one
   * of janitor's 53 tag names. Without it (first load, or the endpoint moved) it
   * falls back to the shape heuristic, which also picks up stray labels like
   * "1k tokens". The panel lists whatever was learned so mistakes are visible.
   */
  function extractTags(link) {
    var tags = [];
    var nodes = link.querySelectorAll('*');
    var vocab = hasVocab();
    var skippedName = false;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.children.length) continue;                 // leaf text nodes only
      var t = (n.textContent || '').trim();
      if (!t || t.length > 26) continue;
      var low = t.toLowerCase();
      if (vocab) {
        if (!tagSet[low]) continue;
      } else {
        if (/^[\d.,]+\s*[km]?$/i.test(t)) continue;      // chat counts
        if (t.charAt(0) === '@') continue;               // creator handle
        if (t.split(/\s+/).length > 3) continue;
        if (!skippedName) { skippedName = true; continue; } // first leaf is the name
      }
      if (tags.indexOf(low) === -1) tags.push(low);
    }
    return tags;
  }

  function scoreOf(tags) {
    var total = 0;
    for (var i = 0; i < tags.length; i++) {
      var w = taste[tags[i]];
      if (w) total += w;
    }
    return total;
  }

  function matchesAny(haystack, needles) {
    for (var i = 0; i < needles.length; i++) {
      var n = String(needles[i]).trim().toLowerCase();
      if (n && haystack.indexOf(n) !== -1) return true;
    }
    return false;
  }

  var cardMeta = new WeakMap();

  function scanCards() {
    if (!S.enabled) return;
    var links = document.querySelectorAll(CARD_SEL);
    if (!links.length) return;

    // group wrappers by parent so single links in headers are never touched
    var groups = new Map();
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      if (link.closest('[data-jc-ui]')) continue;   // our own shelves and panel
      var wrap = cardWrapper(link);
      var parent = wrap.parentElement;
      if (!parent) continue;
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push({ wrap: wrap, link: link });
    }

    var quick = (S.quickFilter || '').trim().toLowerCase();

    groups.forEach(function (items, parent) {
      if (items.length < 3) return;              // not a grid, leave it alone

      if (S.takeoverGrid) {
        parent.setAttribute('data-jc-grid', '');
        if (S.cardsPerRow > 0) parent.setAttribute('data-jc-cols', String(S.cardsPerRow));
        else parent.removeAttribute('data-jc-cols');
      }

      var ranked = [];
      for (var j = 0; j < items.length; j++) {
        var wrap = items[j].wrap;
        var link = items[j].link;
        var meta = cardMeta.get(wrap);
        if (!meta || meta.link !== link) {
          meta = {
            link: link,
            id: characterId(link.getAttribute('href')),
            text: (wrap.textContent || '').toLowerCase(),
            tags: extractTags(link)
          };
          cardMeta.set(wrap, meta);
          wrap.setAttribute('data-jc-card', '');
          addCardControls(wrap, meta);
        }

        var off = false;
        var blur = false;
        var score = scoreOf(meta.tags);

        if (hidden[meta.id]) off = true;
        if (!off && S.hideSeen && seen[meta.id]) off = true;
        if (!off && S.blockedTags.length && matchesAny(meta.text, S.blockedTags)) off = true;
        if (!off && quick && meta.text.indexOf(quick) === -1) off = true;
        if (!off && S.minScore > 0 && score < S.minScore) off = true;
        if (!off && S.hideNsfw && matchesAny(meta.text, S.nsfwTags)) {
          if (S.nsfwMode === 'hide') off = true; else blur = true;
        }

        toggleAttr(wrap, 'data-jc-off', off);
        toggleAttr(wrap, 'data-jc-blur', blur && !wrap.hasAttribute('data-jc-revealed'));

        var badge = wrap.querySelector('.jc-score');
        if (badge) {
          if (score > 0) { badge.textContent = '+' + score; badge.style.display = ''; }
          else { badge.style.display = 'none'; }
        }

        ranked.push({ wrap: wrap, score: score, index: j });
      }

      if (S.sortByTaste && S.takeoverGrid) {
        ranked.sort(function (a, b) {
          if (b.score !== a.score) return b.score - a.score;
          return a.index - b.index;
        });
        for (var k = 0; k < ranked.length; k++) {
          // CSS order keeps React's DOM tree untouched, so reconciliation stays happy
          if (ranked[k].wrap.style.order !== String(k)) ranked[k].wrap.style.order = String(k);
        }
      } else {
        for (var m = 0; m < ranked.length; m++) {
          if (ranked[m].wrap.style.order) ranked[m].wrap.style.order = '';
        }
      }
    });
  }

  function toggleAttr(el, name, on) {
    if (on) { if (!el.hasAttribute(name)) el.setAttribute(name, ''); }
    else if (el.hasAttribute(name)) el.removeAttribute(name);
  }

  function addCardControls(wrap, meta) {
    if (wrap.querySelector(':scope > .jc-fx')) return;

    var badge = document.createElement('div');
    badge.className = 'jc-score';
    badge.setAttribute('data-jc-ui', '');
    badge.style.display = 'none';
    wrap.appendChild(badge);

    var fx = document.createElement('div');
    fx.className = 'jc-fx';
    fx.setAttribute('data-jc-ui', '');

    var like = document.createElement('button');
    like.setAttribute('data-act', 'like');
    like.title = 'More like this (boosts these tags)';
    like.textContent = '♥';

    var nope = document.createElement('button');
    nope.setAttribute('data-act', 'hide');
    nope.title = 'Hide this and demote its tags';
    nope.textContent = '✕';

    fx.appendChild(like);
    fx.appendChild(nope);
    wrap.appendChild(fx);

    fx.addEventListener('click', function (ev) {
      var btn = ev.target.closest('button');
      if (!btn) return;
      ev.preventDefault();
      ev.stopPropagation();
      var act = btn.getAttribute('data-act');
      var m = cardMeta.get(wrap);
      if (!m) return;
      if (act === 'like') {
        bumpTags(m.tags, 3);
        flash(wrap, 'rgba(255,0,60,.35)');
      } else {
        bumpTags(m.tags, -2);
        hidden[m.id] = 1;
        saveHidden();
        wrap.setAttribute('data-jc-off', '');
      }
      schedule('cards');
      refreshPanel();
    }, true);

    // reveal blurred cards on click instead of navigating away
    wrap.addEventListener('click', function (ev) {
      // the overlay buttons run their own capture handler, do not double count
      if (ev.target && ev.target.closest && ev.target.closest('.jc-fx')) return;
      if (wrap.hasAttribute('data-jc-blur')) {
        ev.preventDefault();
        ev.stopPropagation();
        wrap.setAttribute('data-jc-revealed', '');
        wrap.removeAttribute('data-jc-blur');
        return;
      }
      var m = cardMeta.get(wrap);
      if (!m) return;
      seen[m.id] = Date.now();
      saveSeen();
      if (S.learn) bumpTags(m.tags, 1);
    }, true);
  }

  function bumpTags(tags, amount) {
    if (!tags || !tags.length) return;
    for (var i = 0; i < tags.length; i++) {
      var t = tags[i];
      var v = (taste[t] || 0) + amount;
      if (v > 40) v = 40;
      if (v < -20) v = -20;
      if (v === 0) delete taste[t]; else taste[t] = v;
    }
    saveTaste();
  }

  function flash(el, color) {
    var prev = el.style.boxShadow;
    el.style.boxShadow = '0 0 0 3px ' + color + ', 0 18px 42px rgba(255,0,60,.3)';
    setTimeout(function () { el.style.boxShadow = prev; }, 320);
  }

  /* ================================================================
   * scheduler
   * ============================================================= */

  var pending = {};
  var timer = null;
  var paintTargets = [];

  function schedule(what, target) {
    pending[what || 'all'] = true;
    if (target && target.nodeType === 1 && paintTargets.length < 300) paintTargets.push(target);
    if (timer) return;
    timer = setTimeout(function () {
      timer = null;
      var jobs = pending;
      pending = {};
      var targets = paintTargets;
      paintTargets = [];
      if (disposed) return;
      try {
        if (jobs.all || jobs.sheets) recolorSheets();
        if (jobs.all || jobs.paint) {
          if (jobs.all || !targets.length || targets.length >= 300) queuePaint(document.body);
          else for (var i = 0; i < targets.length; i++) queuePaint(targets[i]);
        }
        if (jobs.all || jobs.layout) { unclampWidths(); markMessages(); }
        if (jobs.all || jobs.cards) { scanCards(); updateShelves(); updatePill(); }
      } catch (e) { log('schedule failed', e); }
    }, 140);
  }

  function applyAll() {
    applyRootVars();
    if (!S.enabled) {
      teardown();
      return;
    }
    lastSheetSignature = '';
    schedule('all');
  }

  // Put the page back the way we found it, short of a reload.
  function teardown() {
    if (recolorStyle) recolorStyle.textContent = '';
    unpaintAll();
    reclampAll();
    removeShelves();
    updatePill();
    var marked = document.querySelectorAll('[data-jc-card],[data-jc-grid],[data-jc-msg],[data-jc-off],[data-jc-blur]');
    for (var i = 0; i < marked.length; i++) {
      var el = marked[i];
      ['data-jc-card', 'data-jc-grid', 'data-jc-cols', 'data-jc-msg', 'data-jc-off', 'data-jc-blur', 'data-jc-revealed']
        .forEach(function (a) { el.removeAttribute(a); });
      if (el.style.order) el.style.order = '';
    }
    cardMeta = new WeakMap();
  }

  /* ================================================================
   * janitor's own API
   *
   * Same origin, cookie authenticated, and exactly what the site itself calls:
   *   /hampter/characters?page&language&sort&mode   sort: popular|trending|latest|random
   *   /hampter/tags                                 the canonical 53 tag names
   * The tags and search query parameters are accepted but ignored by the server,
   * so every shelf below is assembled client side out of the fetched pool.
   * ============================================================= */

  var API = '/hampter';
  var AVATAR_BASE = 'https://ella.janitorai.com/bot-avatars/';
  var K_TAGS = 'jc.tags.v1';
  var POOL_TTL = 10 * 60 * 1000;

  // Order matters here. buildTagSet fills tagCase, so tagCase has to exist before
  // the first call, and function declarations hoist while var initialisers do not.
  // Getting that wrong threw at document-start on every load that had a cached
  // vocabulary, which killed the whole script before anything was applied.
  var tagCase = {};
  var tagVocab = normalizeVocab(store.get(K_TAGS, { ts: 0, list: [] }));
  var tagSet = buildTagSet(tagVocab.list);

  // A cached blob written by an older build, or a half written one, must never
  // take the script down with it.
  function normalizeVocab(v) {
    if (!v || typeof v !== 'object' || !Array.isArray(v.list)) return { ts: 0, list: [] };
    return { ts: Number(v.ts) || 0, list: v.list.filter(Boolean).map(String) };
  }

  function buildTagSet(list) {
    var set = {};
    (list || []).forEach(function (t) {
      if (!t) return;
      var low = String(t).toLowerCase();
      set[low] = 1;
      tagCase[low] = String(t);
    });
    return set;
  }

  function hasVocab() { return tagVocab.list && tagVocab.list.length > 0; }
  function properTag(low) { return tagCase[low] || low; }

  /*
   * Every network call goes through here. If fetch is missing or the endpoint
   * moves, the promise rejects and the caller falls back: the tag heuristic
   * still works and the shelves simply do not appear. Nothing else breaks.
   */
  function apiGet(path) {
    try {
      if (typeof fetch !== 'function') return Promise.reject(new Error('no fetch'));
      return fetch(path, { credentials: 'include' }).then(function (r) {
        return r.ok ? r.json() : null;
      });
    } catch (e) {
      return Promise.reject(e);
    }
  }

  function refreshTagVocab() {
    if (hasVocab() && Date.now() - tagVocab.ts < 864e5) return;
    apiGet(API + '/tags')
      .then(function (j) {
        var raw = Array.isArray(j) ? j : (j && (j.data || j.tags)) || [];
        var list = raw.map(function (t) { return t && (t.name || t); }).filter(Boolean);
        if (!list.length) return;
        tagVocab = { ts: Date.now(), list: list };
        tagSet = buildTagSet(list);
        store.set(K_TAGS, tagVocab);
        log('tag vocabulary:', list.length);
        schedule('cards');
      })
      .catch(function () { /* offline, the heuristic extractor still works */ });
  }

  var SHELF_SOURCES = [
    { key: 'trend', sort: 'trending', page: 1, title: 'Trending on Janitor' },
    { key: 'pop', sort: 'popular', page: 1, title: 'Popular right now' },
    { key: 'pop2', sort: 'popular', page: 2, title: null },
    { key: 'new', sort: 'latest', page: 1, title: 'Fresh off the press' },
    { key: 'rand', sort: 'random', page: 1, title: 'Roll the dice' }
  ];

  var pool = null;
  var poolLoading = null;

  function normalizeChar(c) {
    if (!c || !c.id) return null;
    var tags = (c.tags || []).map(function (t) { return t && (t.name || t); }).filter(Boolean);
    return {
      id: c.id,
      name: c.name || 'Unnamed',
      avatar: c.avatar || '',
      creator: c.creator_name || '',
      desc: String(c.description || '').slice(0, 200),
      tags: tags,
      low: tags.map(function (t) { return t.toLowerCase(); }),
      nsfw: !!(c.is_nsfw || c.is_image_nsfw),
      chats: (c.stats && c.stats.chat) || 0
    };
  }

  function fetchPool(force) {
    if (!force && pool && Date.now() - pool.ts < POOL_TTL) return Promise.resolve(pool);
    if (poolLoading) return poolLoading;
    var bySource = {};
    poolLoading = Promise.all(SHELF_SOURCES.map(function (src) {
      var url = API + '/characters?page=' + src.page + '&language=en&sort=' + src.sort + '&mode=all';
      return apiGet(url)
        .then(function (j) { bySource[src.key] = ((j && j.data) || []).map(normalizeChar).filter(Boolean); })
        .catch(function () { bySource[src.key] = []; });
    })).then(function () {
      var byId = {}, all = [];
      SHELF_SOURCES.forEach(function (src) {
        (bySource[src.key] || []).forEach(function (c) {
          if (byId[c.id]) return;
          byId[c.id] = 1;
          all.push(c);
        });
      });
      pool = { ts: Date.now(), bySource: bySource, all: all };
      poolLoading = null;
      log('pool loaded:', all.length);
      return pool;
    }).catch(function () { poolLoading = null; return { ts: Date.now(), bySource: {}, all: [] }; });
    return poolLoading;
  }

  function characterUrl(c) {
    var slug = String(c.name).toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return '/characters/' + c.id + '_character-' + slug;
  }

  function isNsfwChar(c) {
    if (c.nsfw) return true;
    return matchesAny((c.tags.join(' ') + ' ' + c.name).toLowerCase(), S.nsfwTags);
  }

  function shelfAllows(c) {
    if (hidden[c.id]) return false;
    if (S.hideSeen && seen[c.id]) return false;
    var hay = (c.name + ' ' + c.desc + ' ' + c.tags.join(' ')).toLowerCase();
    if (S.blockedTags.length && matchesAny(hay, S.blockedTags)) return false;
    if (S.hideNsfw && S.nsfwMode === 'hide' && isNsfwChar(c)) return false;
    var q = (S.quickFilter || '').trim().toLowerCase();
    if (q && hay.indexOf(q) === -1) return false;
    return true;
  }

  function buildShelves(p) {
    var shelves = [];
    var size = S.shelfSize;

    var scored = p.all
      .map(function (c) { return { c: c, s: scoreOf(c.low) }; })
      .filter(function (x) { return x.s > 0 && shelfAllows(x.c); })
      .sort(function (a, b) { return b.s - a.s; });

    shelves.push({
      title: 'JC Recommended for you',
      hint: scored.length >= 4 ? 'scored against the tags you keep opening' : 'heart a few characters and this fills up',
      items: scored.slice(0, size).map(function (x) { return x.c; }),
      scores: true
    });

    // a shelf per tag you have clearly committed to
    Object.keys(taste)
      .filter(function (t) { return taste[t] >= 3; })
      .sort(function (a, b) { return taste[b] - taste[a]; })
      .slice(0, 3)
      .forEach(function (tag) {
        var items = p.all.filter(function (c) { return shelfAllows(c) && c.low.indexOf(tag) !== -1; });
        if (items.length >= 4) shelves.push({ title: 'More ' + properTag(tag), items: items.slice(0, size) });
      });

    SHELF_SOURCES.forEach(function (src) {
      if (!src.title) return;
      var items = (p.bySource[src.key] || []).filter(shelfAllows);
      if (items.length) shelves.push({ title: src.title, items: items.slice(0, size) });
    });

    return shelves;
  }

  /* ---------- shelf rendering ---------- */

  var shelfHost = null;
  var shelfPending = false;
  var shelfSignature = '';

  /*
   * updateShelves runs on every mutation batch, so re-rendering unconditionally
   * would rebuild the rows constantly and throw away however far you had
   * scrolled each rail. Only rebuild when something that changes their contents
   * has actually changed.
   */
  function currentShelfSignature(p) {
    return [
      p ? p.ts : 0, tasteVersion, S.shelfSize, S.hideNsfw, S.nsfwMode,
      S.hideSeen, S.quickFilter, S.blockedTags.join('|'),
      Object.keys(hidden).length, Object.keys(seen).length
    ].join('~');
  }

  function isHome() { return location.pathname === '/' || location.pathname === ''; }

  function landingList() {
    return document.querySelector('.characters-list-container-flex') ||
      (document.querySelector('.pp-cc-list-container') || {}).parentElement || null;
  }

  function removeShelves() {
    if (shelfHost && shelfHost.parentNode) shelfHost.parentNode.removeChild(shelfHost);
    shelfHost = null;
    var natives = document.querySelectorAll('[data-jc-native-hidden]');
    for (var i = 0; i < natives.length; i++) natives[i].removeAttribute('data-jc-native-hidden');
  }

  function updateShelves() {
    if (!S.enabled || !S.shelves || !isHome()) { removeShelves(); return; }
    var native = landingList();
    if (!native || !native.parentNode) return;

    native.setAttribute('data-jc-native-hidden', '');
    // the explore filter bar drives the list we just replaced, so it goes too
    var explore = document.querySelector('[class*="exploreSection"]');
    if (explore) explore.setAttribute('data-jc-native-hidden', '');

    if (!shelfHost || !shelfHost.isConnected) {
      shelfHost = document.createElement('section');
      shelfHost.className = 'jc-shelves';
      shelfHost.setAttribute('data-jc-ui', '');
      shelfHost.appendChild(shelfSkeleton());
      native.parentNode.insertBefore(shelfHost, native);
    }

    if (shelfPending) return;
    shelfPending = true;
    fetchPool().then(function (p) {
      shelfPending = false;
      if (disposed || !shelfHost || !S.shelves || !isHome()) return;
      // If the API ever moves, give the page back rather than leaving it blank.
      if (!p.all.length) {
        log('pool empty, restoring the native list');
        removeShelves();
        return;
      }
      var sig = currentShelfSignature(p);
      if (sig === shelfSignature && shelfHost.querySelector('.jc-tile')) return;
      shelfSignature = sig;
      renderShelves(buildShelves(p));
    });
  }

  function refreshShelvesSoon() {
    if (!shelfHost || !S.shelves || !isHome()) return;
    fetchPool().then(function (p) {
      if (disposed || !shelfHost) return;
      shelfSignature = currentShelfSignature(p);
      renderShelves(buildShelves(p));
    });
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function shelfSkeleton() {
    var wrap = el('div', 'jc-shelf');
    var head = el('div', 'jc-shelf-head');
    head.appendChild(el('span', 'jc-shelf-bar'));
    head.appendChild(el('h3', 'jc-shelf-title', 'Loading your shelves'));
    wrap.appendChild(head);
    var rail = el('div', 'jc-rail');
    for (var i = 0; i < 8; i++) rail.appendChild(el('div', 'jc-tile jc-skel'));
    wrap.appendChild(rail);
    return wrap;
  }

  function renderShelves(shelves) {
    var frag = document.createDocumentFragment();
    shelves.forEach(function (s) { frag.appendChild(shelfElement(s)); });
    shelfHost.textContent = '';
    shelfHost.appendChild(frag);
  }

  function shelfElement(shelf) {
    var wrap = el('div', 'jc-shelf');
    var head = el('div', 'jc-shelf-head');
    head.appendChild(el('span', 'jc-shelf-bar'));
    head.appendChild(el('h3', 'jc-shelf-title', shelf.title));
    if (shelf.hint) head.appendChild(el('span', 'jc-shelf-hint', shelf.hint));

    var nav = el('div', 'jc-shelf-nav');
    var prev = el('button', null, '‹');
    var next = el('button', null, '›');
    prev.setAttribute('aria-label', 'Scroll left');
    next.setAttribute('aria-label', 'Scroll right');
    nav.appendChild(prev);
    nav.appendChild(next);
    head.appendChild(nav);
    wrap.appendChild(head);

    var rail = el('div', 'jc-rail');
    if (!shelf.items.length) {
      rail.appendChild(el('div', 'jc-empty',
        'Nothing here yet. Open or heart a few characters and this shelf builds itself.'));
    } else {
      shelf.items.forEach(function (c) { rail.appendChild(tileElement(c, shelf.scores)); });
    }
    wrap.appendChild(rail);

    prev.addEventListener('click', function () { rail.scrollBy({ left: -rail.clientWidth * 0.85, behavior: 'smooth' }); });
    next.addEventListener('click', function () { rail.scrollBy({ left: rail.clientWidth * 0.85, behavior: 'smooth' }); });
    makeDraggable(rail);
    return wrap;
  }

  function shortNum(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'm';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n || 0);
  }

  function tileElement(c, showScore) {
    var tile = el('a', 'jc-tile');
    tile.href = characterUrl(c);
    tile.setAttribute('data-jc-ui', '');
    tile.setAttribute('data-jc-id', c.id);

    var thumb = el('div', 'jc-thumb');
    if (c.avatar) {
      var img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = '';
      img.src = /^https?:/.test(c.avatar) ? c.avatar : AVATAR_BASE + c.avatar + '?width=400';
      thumb.appendChild(img);
    }
    tile.appendChild(thumb);

    var body = el('div', 'jc-tile-body');
    body.appendChild(el('div', 'jc-tile-name', c.name));
    if (c.creator) body.appendChild(el('div', 'jc-tile-by', '@' + c.creator));

    var chips = el('div', 'jc-tile-tags');
    c.tags.slice(0, 3).forEach(function (t) { chips.appendChild(el('span', 'jc-chip', t)); });
    body.appendChild(chips);
    body.appendChild(el('div', 'jc-tile-stats', shortNum(c.chats) + ' chats'));
    tile.appendChild(body);

    if (showScore) {
      var sc = scoreOf(c.low);
      if (sc > 0) {
        var badge = el('div', 'jc-score', '+' + sc);
        badge.setAttribute('data-jc-ui', '');
        tile.appendChild(badge);
      }
    }

    if (S.hideNsfw && S.nsfwMode === 'blur' && isNsfwChar(c)) tile.setAttribute('data-jc-blur', '');
    if (liked[c.id]) tile.setAttribute('data-jc-liked', '');

    var fx = el('div', 'jc-fx');
    fx.setAttribute('data-jc-ui', '');
    var like = el('button', null, '♥');
    like.setAttribute('data-act', 'like');
    like.title = 'More like this';
    var nope = el('button', null, '✕');
    nope.setAttribute('data-act', 'hide');
    nope.title = 'Hide this and demote its tags';
    fx.appendChild(like);
    fx.appendChild(nope);
    tile.appendChild(fx);

    fx.addEventListener('click', function (ev) {
      var btn = ev.target.closest('button');
      if (!btn) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (btn.getAttribute('data-act') === 'like') {
        likeCharacter(c.id, c.low);
        tile.setAttribute('data-jc-liked', '');
        flash(tile, 'rgba(255,0,60,.45)');
      } else {
        bumpTags(c.low, -2);
        hidden[c.id] = 1;
        saveHidden();
        tile.parentNode.removeChild(tile);
      }
      refreshPanel();
      debouncedShelfRefresh();
    }, true);

    tile.addEventListener('click', function (ev) {
      if (tile.hasAttribute('data-jc-blur')) {
        ev.preventDefault();
        tile.removeAttribute('data-jc-blur');
        return;
      }
      seen[c.id] = Date.now();
      saveSeen();
      if (S.learn) bumpTags(c.low, 1);
    });

    return tile;
  }

  var shelfRefreshTimer = null;
  function debouncedShelfRefresh() {
    if (shelfRefreshTimer) clearTimeout(shelfRefreshTimer);
    shelfRefreshTimer = setTimeout(function () {
      shelfRefreshTimer = null;
      refreshShelvesSoon();
    }, 1200);
  }

  /*
   * Drag to scroll. Pointer capture would swallow the click that a browser fires
   * after a drag, so a real drag installs a one shot click eater instead.
   */
  function makeDraggable(rail) {
    var down = false, startX = 0, startLeft = 0, moved = 0;

    rail.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return;
      down = true;
      moved = 0;
      startX = ev.clientX;
      startLeft = rail.scrollLeft;
    });

    rail.addEventListener('pointermove', function (ev) {
      if (!down) return;
      var dx = ev.clientX - startX;
      if (Math.abs(dx) < 4 && moved === 0) return;
      moved = Math.max(moved, Math.abs(dx));
      rail.classList.add('jc-dragging');
      rail.scrollLeft = startLeft - dx;
      ev.preventDefault();
    });

    function end() {
      if (!down) return;
      down = false;
      rail.classList.remove('jc-dragging');
      if (moved > 6) {
        var eat = function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          rail.removeEventListener('click', eat, true);
        };
        rail.addEventListener('click', eat, true);
        setTimeout(function () { rail.removeEventListener('click', eat, true); }, 300);
      }
    }

    rail.addEventListener('pointerup', end);
    rail.addEventListener('pointercancel', end);
    rail.addEventListener('pointerleave', end);
    rail.addEventListener('dragstart', function (ev) { ev.preventDefault(); });
  }

  /* ================================================================
   * liking a character from its own page
   *
   * Grid cards carry a heart, but arriving from search you land on the
   * character page itself, where there is no card to hover. This adds the same
   * control there, reading the tag chips straight off the page.
   * ============================================================= */

  function currentCharacterId() {
    var m = location.pathname.match(/^\/characters\/([^/?#]+)/);
    return m ? m[1].split('_')[0] : '';
  }

  function currentCharacterName() {
    var m = location.pathname.match(/^\/characters\/[^/?#]*?_(?:character-)?([^/?#]*)/);
    if (!m || !m[1]) return 'this character';
    return m[1].replace(/-/g, ' ').replace(/\b\w/g, function (ch) { return ch.toUpperCase(); });
  }

  // Every janitor tag starts with an emoji, which is the fallback on the very
  // first page view, before the tag vocabulary has been fetched.
  var EMOJI_START = /^\p{Extended_Pictographic}/u;

  function pageTags() {
    var root = document.querySelector('main') || document.body;
    var nodes = root.querySelectorAll('span,div,p,a,li');
    var found = [], seenTag = {};
    var vocab = hasVocab();
    var limit = Math.min(nodes.length, 1500);
    for (var i = 0; i < limit; i++) {
      var n = nodes[i];
      if (n.children.length) continue;
      var t = (n.textContent || '').trim();
      if (!t || t.length > 26) continue;
      var low = t.toLowerCase();
      if (seenTag[low]) continue;
      var isTag = vocab ? !!tagSet[low] : EMOJI_START.test(t);
      if (!isTag) continue;
      seenTag[low] = 1;
      found.push(low);
    }
    return found;
  }

  function likeCharacter(id, tags) {
    if (id) { liked[id] = Date.now(); saveLiked(); }
    bumpTags(tags, 3);
  }

  /* ================================================================
   * control panel (shadow DOM so the site cannot touch it)
   * ============================================================= */

  var panelRoot = null;
  var panelShadow = null;
  var panelOpen = false;

  var PANEL_CSS = [
    ':host{all:initial;}',
    '*{box-sizing:border-box;font-family:Inter,"Segoe UI",system-ui,sans-serif;}',
    '.launch{position:fixed;right:20px;bottom:20px;width:52px;height:52px;border-radius:999px;',
    'display:grid;place-items:center;cursor:pointer;border:1px solid rgba(255,0,60,.45);',
    'background:radial-gradient(circle at 30% 25%,#c7042d,#5c0514);color:#fff5f6;font-weight:900;',
    'font-size:11px;letter-spacing:.08em;box-shadow:0 12px 34px rgba(255,0,60,.35),0 4px 12px rgba(0,0,0,.6);',
    'z-index:2147483000;transition:transform .25s,box-shadow .35s;}',
    '.launch:hover{transform:scale(1.08) rotate(-4deg);box-shadow:0 16px 46px rgba(255,0,60,.5);}',

    '.panel{position:fixed;right:20px;bottom:84px;width:360px;max-height:78vh;overflow-y:auto;',
    'background:linear-gradient(180deg,rgba(26,0,5,.97),rgba(15,0,4,.98));',
    'border:1px solid rgba(143,7,29,.7);border-radius:22px;color:#ffe5ea;z-index:2147483000;',
    'box-shadow:0 30px 80px rgba(0,0,0,.8),0 0 60px rgba(255,0,60,.12);',
    'backdrop-filter:blur(18px);padding:18px;display:none;}',
    '.panel.open{display:block;animation:rise .28s cubic-bezier(.2,.8,.2,1);}',
    '@keyframes rise{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:none}}',
    '.panel::-webkit-scrollbar{width:8px}',
    '.panel::-webkit-scrollbar-thumb{background:#8f071d;border-radius:999px}',

    '.head{display:flex;align-items:center;gap:10px;margin-bottom:16px;}',
    '.bar{width:6px;height:26px;border-radius:999px;background:#ff003c;box-shadow:0 0 14px rgba(255,0,60,.7);}',
    '.title{font-size:15px;font-weight:900;letter-spacing:-.02em;text-transform:uppercase;color:#fff;}',
    '.title span{color:#ff003c;}',
    '.ver{margin-left:auto;font-size:9px;font-weight:900;letter-spacing:.16em;color:#8f071d;}',

    '.sec{margin:0 0 8px;padding-top:12px;border-top:1px solid rgba(143,7,29,.35);}',
    '.sec:first-of-type{border-top:0;padding-top:0;}',
    '.sec h4{margin:0 0 10px;font-size:9px;font-weight:900;letter-spacing:.24em;text-transform:uppercase;color:#ff4066;}',

    '.row{display:flex;align-items:center;gap:10px;padding:6px 0;}',
    '.row label{flex:1;font-size:12px;font-weight:600;color:#ffaebe;}',
    '.hint{font-size:10px;color:#8f071d;margin:-2px 0 8px;line-height:1.5;}',

    '.sw{position:relative;width:40px;height:22px;border-radius:999px;background:#38020c;',
    'border:1px solid rgba(143,7,29,.8);cursor:pointer;transition:background .25s,border-color .25s;flex:none;}',
    '.sw::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:999px;',
    'background:#8f071d;transition:transform .25s,background .25s;}',
    '.sw.on{background:rgba(255,0,60,.25);border-color:#ff003c;}',
    '.sw.on::after{transform:translateX(18px);background:#ff003c;box-shadow:0 0 12px rgba(255,0,60,.8);}',

    'input[type=range]{flex:1;accent-color:#ff003c;background:transparent;}',
    '.val{font-size:10px;font-weight:900;color:#ff7792;min-width:38px;text-align:right;}',

    'input[type=text],textarea,select{width:100%;background:rgba(56,2,12,.5);color:#ffe5ea;',
    'border:1px solid rgba(143,7,29,.7);border-radius:12px;padding:8px 10px;font-size:12px;outline:none;}',
    'input[type=text]:focus,textarea:focus,select:focus{border-color:#ff003c;box-shadow:0 0 0 3px rgba(255,0,60,.12);}',
    'textarea{min-height:62px;resize:vertical;line-height:1.5;}',
    'select{cursor:pointer;}',
    'option{background:#1a0005;}',

    '.btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;}',
    'button.act{all:unset;cursor:pointer;padding:8px 12px;border-radius:12px;font-size:10px;font-weight:900;',
    'letter-spacing:.12em;text-transform:uppercase;color:#ffe5ea;background:rgba(143,7,29,.35);',
    'border:1px solid rgba(143,7,29,.8);transition:background .2s,border-color .2s,transform .2s;}',
    'button.act:hover{background:#c7042d;border-color:#ff4066;transform:translateY(-1px);}',
    'button.act.danger:hover{background:#5c0514;}',

    '.tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}',
    '.tag{display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border-radius:999px;font-size:10px;',
    'font-weight:700;background:rgba(255,0,60,.1);border:1px solid rgba(255,0,60,.3);color:#ffaebe;}',
    '.tag b{color:#ff4066;}',
    '.tag i{cursor:pointer;font-style:normal;color:#8f071d;}',
    '.tag i:hover{color:#ff003c;}',
    '.empty{font-size:10px;font-style:italic;color:#8f071d;}',

    /* the like control shown on a character page */
    '.pill{position:fixed;right:84px;bottom:20px;display:none;align-items:center;gap:8px;z-index:2147483000;',
    'padding:8px 10px 8px 14px;border-radius:999px;background:linear-gradient(180deg,rgba(26,0,5,.97),rgba(15,0,4,.98));',
    'border:1px solid rgba(143,7,29,.75);box-shadow:0 12px 34px rgba(0,0,0,.7),0 0 30px rgba(255,0,60,.10);',
    'backdrop-filter:blur(14px);max-width:46vw;}',
    '.pill.show{display:flex;animation:rise .28s cubic-bezier(.2,.8,.2,1);}',
    '.pill .who{font-size:10px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;color:#ffaebe;',
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;}',
    '.pill button{all:unset;cursor:pointer;width:30px;height:30px;display:grid;place-items:center;border-radius:999px;',
    'font-size:13px;color:#ffe5ea;background:rgba(143,7,29,.4);border:1px solid rgba(143,7,29,.8);',
    'transition:background .2s,transform .2s,border-color .2s;flex:none;}',
    '.pill button:hover{background:#c7042d;border-color:#ff4066;transform:scale(1.1);}',
    '.pill button.on{background:#ff003c;border-color:#ff4066;box-shadow:0 0 14px rgba(255,0,60,.6);}',
    '.pill .note{font-size:9px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:#8f071d;white-space:nowrap;}'
  ].join('');

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'text') el.textContent = attrs[k];
        else if (k === 'html') el.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), attrs[k]);
        else el.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) { if (c) el.appendChild(c); });
    return el;
  }

  function section(title, rows) {
    return h('div', { class: 'sec' }, [h('h4', { text: title })].concat(rows));
  }

  function toggleRow(label, key, onChange) {
    var sw = h('div', { class: 'sw' + (S[key] ? ' on' : '') });
    sw.addEventListener('click', function () {
      S[key] = !S[key];
      sw.classList.toggle('on', !!S[key]);
      saveSettings();
      if (onChange) onChange();
    });
    return h('div', { class: 'row' }, [h('label', { text: label }), sw]);
  }

  function rangeRow(label, key, min, max, step, suffix, onChange) {
    var val = h('div', { class: 'val', text: S[key] + (suffix || '') });
    var input = h('input', { type: 'range', min: min, max: max, step: step });
    input.value = S[key];
    input.addEventListener('input', function () {
      S[key] = Math.round(parseFloat(input.value) * 100) / 100;
      val.textContent = S[key] + (suffix || '');
      saveSettings();
      if (onChange) onChange();
    });
    return h('div', {}, [
      h('div', { class: 'row' }, [h('label', { text: label }), val]),
      h('div', { class: 'row' }, [input])
    ]);
  }

  function textRow(label, key, placeholder, onChange) {
    var input = h('input', { type: 'text', placeholder: placeholder || '' });
    input.value = S[key] || '';
    input.addEventListener('input', function () {
      S[key] = input.value;
      saveSettings();
      if (onChange) onChange();
    });
    return h('div', {}, [
      h('div', { class: 'row' }, [h('label', { text: label })]),
      input
    ]);
  }

  function listRow(label, key, hint, onChange) {
    var area = h('textarea', { placeholder: 'one per line' });
    area.value = (S[key] || []).join('\n');
    area.addEventListener('change', function () {
      S[key] = area.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      saveSettings();
      if (onChange) onChange();
    });
    return h('div', {}, [
      h('div', { class: 'row' }, [h('label', { text: label })]),
      hint ? h('div', { class: 'hint', text: hint }) : null,
      area
    ]);
  }

  function selectRow(label, key, options, onChange) {
    var sel = h('select', {});
    options.forEach(function (o) {
      var opt = h('option', { value: String(o.value), text: o.label });
      sel.appendChild(opt);
    });
    sel.value = String(S[key]);
    sel.addEventListener('change', function () {
      var v = sel.value;
      S[key] = isNaN(parseFloat(v)) || String(parseFloat(v)) !== v ? v : parseFloat(v);
      saveSettings();
      if (onChange) onChange();
    });
    return h('div', { class: 'row' }, [h('label', { text: label }), sel]);
  }

  function tasteList() {
    var wrap = h('div', { class: 'tags' });
    var entries = Object.keys(taste).map(function (k) { return [k, taste[k]]; })
      .sort(function (a, b) { return Math.abs(b[1]) - Math.abs(a[1]); })
      .slice(0, 24);
    if (!entries.length) {
      wrap.appendChild(h('div', { class: 'empty', text: 'Nothing learned yet. Open a few characters, or use the heart and cross buttons on the cards.' }));
      return wrap;
    }
    entries.forEach(function (e) {
      var tag = h('span', { class: 'tag' }, [
        document.createTextNode(e[0]),
        h('b', { text: (e[1] > 0 ? '+' : '') + e[1] }),
        h('i', {
          text: '✕', onclick: function () {
            delete taste[e[0]];
            saveTaste();
            refreshPanel();
            schedule('cards');
          }
        })
      ]);
      wrap.appendChild(tag);
    });
    return wrap;
  }

  function buildPanel() {
    if (panelRoot) return;
    panelRoot = document.createElement('div');
    panelRoot.id = 'jc-root';
    panelRoot.setAttribute('data-jc-ui', '');
    panelShadow = panelRoot.attachShadow({ mode: 'open' });
    (document.body || document.documentElement).appendChild(panelRoot);

    var style = document.createElement('style');
    style.textContent = PANEL_CSS;
    panelShadow.appendChild(style);

    var launcher = h('div', { class: 'launch', title: 'Janitor CRIMSONIZED (Alt+C)', text: 'JC' });
    launcher.addEventListener('click', togglePanel);
    panelShadow.appendChild(launcher);

    var panel = h('div', { class: 'panel', id: 'panel' });
    panelShadow.appendChild(panel);

    var pill = h('div', { class: 'pill', id: 'pill' }, [
      h('div', { class: 'who', id: 'pillwho' }),
      h('button', { id: 'pilllike', title: 'Like this character, boosts its tags' }, [document.createTextNode('♥')]),
      h('button', { id: 'pillhide', title: 'Not for me, demotes its tags' }, [document.createTextNode('✕')]),
      h('div', { class: 'note', id: 'pillnote' })
    ]);
    panelShadow.appendChild(pill);

    panelShadow.getElementById('pilllike').addEventListener('click', function () {
      var id = currentCharacterId();
      var tags = pageTags();
      likeCharacter(id, tags);
      updatePill();
      refreshPanel();
      setPillNote(tags.length ? '+3 on ' + tags.length + ' tags' : 'liked, no tags found');
    });

    panelShadow.getElementById('pillhide').addEventListener('click', function () {
      var id = currentCharacterId();
      var tags = pageTags();
      bumpTags(tags, -2);
      if (id) { hidden[id] = 1; saveHidden(); delete liked[id]; saveLiked(); }
      updatePill();
      refreshPanel();
      setPillNote(tags.length ? 'demoted ' + tags.length + ' tags' : 'hidden');
    });

    refreshPanel();
  }

  function setPillNote(text) {
    if (!panelShadow) return;
    var note = panelShadow.getElementById('pillnote');
    if (!note) return;
    note.textContent = text;
    clearTimeout(note._t);
    note._t = setTimeout(function () { note.textContent = ''; }, 2600);
  }

  function updatePill() {
    if (!panelShadow) return;
    var pill = panelShadow.getElementById('pill');
    if (!pill) return;
    var onCharacter = S.enabled && /^\/characters\//.test(location.pathname);
    pill.classList.toggle('show', !!onCharacter);
    if (!onCharacter) return;
    var id = currentCharacterId();
    panelShadow.getElementById('pillwho').textContent = currentCharacterName();
    panelShadow.getElementById('pilllike').classList.toggle('on', !!liked[id]);
  }

  function refreshPanel() {
    if (!panelShadow) return;
    var panel = panelShadow.getElementById('panel');
    if (!panel) return;
    var wasOpen = panel.classList.contains('open');
    var scroll = panel.scrollTop;
    panel.textContent = '';

    panel.appendChild(h('div', { class: 'head' }, [
      h('div', { class: 'bar' }),
      h('div', { class: 'title', html: 'Janitor <span>CRIMSONIZED</span>' }),
      h('div', { class: 'ver', text: 'v' + VERSION })
    ]));

    panel.appendChild(section('Theme', [
      toggleRow('Enable everything', 'enabled', applyAll),
      toggleRow('Recolour stylesheets', 'recolorSheets', function () { lastSheetSignature = ''; lastSheetRun = 0; recolorSheets(); }),
      selectRow('Element recolour', 'paintMode', [
        { value: 'inline', label: 'Inline styles only (fast)' },
        { value: 'deep', label: 'Every element (slow)' },
        { value: 'off', label: 'Off' }
      ], function () {
        unpaintAll();
        if (S.paintMode !== 'off') schedule('paint');
      }),
      h('div', { class: 'hint', text: 'The stylesheet pass does nearly all the theming. Deep mode measures every element on the page and is only worth it if something stays grey.' }),
      textRow('Page title', 'title', 'Janitor CRIMSONIZED', enforceTitle)
    ]));

    panel.appendChild(section('Landing page', [
      toggleRow('Shelves instead of one big grid', 'shelves', function () {
        if (S.shelves) updateShelves(); else removeShelves();
      }),
      h('div', { class: 'hint', text: 'Replaces the default list with draggable rows: your recommendations first, then trending, popular, fresh and random.' }),
      rangeRow('Characters per shelf', 'shelfSize', 8, 40, 1, '', function () { refreshShelvesSoon(); }),
      h('div', { class: 'btns' }, [
        h('button', {
          class: 'act', text: 'Refresh shelves', onclick: function () {
            fetchPool(true).then(function (p) { if (shelfHost) renderShelves(buildShelves(p)); });
          }
        })
      ])
    ]));

    panel.appendChild(section('Layout', [
      toggleRow('Use the full window', 'wide', function () {
        if (!S.wide) reclampAll();
        applyRootVars();
        schedule('layout');
      }),
      rangeRow('Content width', 'contentWidth', 60, 100, 1, 'vw', applyRootVars),
      toggleRow('Rebuild the card grid', 'takeoverGrid', function () { schedule('cards'); }),
      selectRow('Cards per row', 'cardsPerRow', [
        { value: 0, label: 'Auto fill' }, { value: 3, label: '3' }, { value: 4, label: '4' },
        { value: 5, label: '5' }, { value: 6, label: '6' }, { value: 7, label: '7' }, { value: 8, label: '8' }
      ], function () { schedule('cards'); }),
      rangeRow('Card width', 'cardMin', 140, 320, 10, 'px', applyRootVars),
      rangeRow('Chat text size', 'msgFontSize', 12, 26, 1, 'px', applyRootVars),
      rangeRow('Chat line height', 'msgLineHeight', 1.2, 2.2, 0.05, '', applyRootVars)
    ]));

    panel.appendChild(section('Filtering', [
      toggleRow('Hide NSFW', 'hideNsfw', function () { schedule('cards'); }),
      selectRow('NSFW handling', 'nsfwMode', [
        { value: 'blur', label: 'Blur, click to reveal' },
        { value: 'hide', label: 'Remove from the grid' }
      ], function () { schedule('cards'); }),
      listRow('NSFW keywords', 'nsfwTags', 'A card is flagged when its text contains any of these.', function () { schedule('cards'); }),
      listRow('Always hide keywords', 'blockedTags', 'Hard block, independent of the NSFW switch.', function () { schedule('cards'); }),
      textRow('Quick filter', 'quickFilter', 'name, tag or creator', function () { schedule('cards'); }),
      toggleRow('Hide characters I opened', 'hideSeen', function () { schedule('cards'); })
    ]));

    panel.appendChild(section('Taste', [
      toggleRow('Learn from what I open', 'learn'),
      toggleRow('Sort grids by taste', 'sortByTaste', function () { schedule('cards'); }),
      rangeRow('Hide below score', 'minScore', 0, 20, 1, '', function () { schedule('cards'); }),
      tasteList(),
      h('div', { class: 'btns' }, [
        h('button', {
          class: 'act danger', text: 'Reset taste', onclick: function () {
            taste = {}; saveTaste(); refreshPanel(); schedule('cards');
          }
        }),
        h('button', {
          class: 'act danger', text: 'Clear hidden (' + Object.keys(hidden).length + ')', onclick: function () {
            hidden = {}; saveHidden(); refreshPanel(); schedule('cards');
          }
        }),
        h('button', {
          class: 'act danger', text: 'Clear opened (' + Object.keys(seen).length + ')', onclick: function () {
            seen = {}; saveSeen(); refreshPanel(); schedule('cards');
          }
        })
      ])
    ]));

    panel.appendChild(section('Tools', [
      toggleRow('Debug logging', 'debug'),
      h('div', { class: 'btns' }, [
        h('button', {
          class: 'act', text: 'Re-apply', onclick: function () {
            reclampAll();
            paintedStyle = new WeakMap();
            sheetCache = new WeakMap();
            lastSheetRun = 0;
            applyAll();
          }
        }),
        h('button', { class: 'act', text: 'Diagnose', onclick: diagnose }),
        h('button', { class: 'act', text: 'Export', onclick: exportSettings }),
        h('button', { class: 'act', text: 'Import', onclick: importSettings }),
        h('button', {
          class: 'act danger', text: 'Factory reset', onclick: function () {
            S = Object.assign({}, DEFAULTS);
            S.nsfwTags = DEFAULT_NSFW.slice();
            S.blockedTags = [];
            saveSettings();
            refreshPanel();
            applyAll();
          }
        })
      ])
    ]));

    if (wasOpen) panel.classList.add('open');
    panel.scrollTop = scroll;
  }

  function togglePanel() {
    if (!panelShadow) return;
    var panel = panelShadow.getElementById('panel');
    panelOpen = !panelOpen;
    panel.classList.toggle('open', panelOpen);
  }

  function exportSettings() {
    var blob = JSON.stringify({ settings: S, taste: taste, hidden: hidden, seen: seen }, null, 2);
    try {
      navigator.clipboard.writeText(blob);
      alertPanel('Copied to the clipboard.');
    } catch (e) {
      console.log(blob);
      alertPanel('Clipboard blocked, dumped to the console instead.');
    }
  }

  function importSettings() {
    var raw = prompt('Paste an exported Janitor CRIMSONIZED blob:');
    if (!raw) return;
    try {
      var data = JSON.parse(raw);
      if (data.settings) { S = Object.assign({}, DEFAULTS, data.settings); saveSettings(); }
      if (data.taste) { taste = data.taste; saveTaste(); }
      if (data.hidden) { hidden = data.hidden; saveHidden(); }
      if (data.seen) { seen = data.seen; saveSeen(); }
      refreshPanel();
      applyAll();
      alertPanel('Imported.');
    } catch (e) {
      alertPanel('That was not valid JSON.');
    }
  }

  function alertPanel(msg) {
    log(msg);
    var panel = panelShadow && panelShadow.getElementById('panel');
    if (!panel) return;
    var note = h('div', { class: 'hint', text: msg });
    panel.appendChild(note);
    setTimeout(function () { if (note.parentNode) note.parentNode.removeChild(note); }, 2600);
  }

  /*
   * Diagnose dumps what the script actually found on the current page.
   * Run it and paste the output if a selector ever needs retuning.
   */
  function diagnose() {
    var links = document.querySelectorAll(CARD_SEL);
    var readable = 0, blocked = 0, rules = 0;
    for (var i = 0; i < document.styleSheets.length; i++) {
      try {
        var r = document.styleSheets[i].cssRules;
        readable++; rules += r.length;
      } catch (e) { blocked++; }
    }
    var report = {
      version: VERSION,
      url: location.pathname,
      isChat: isChat(),
      characterLinks: links.length,
      managedCards: document.querySelectorAll('[data-jc-card]').length,
      grids: document.querySelectorAll('[data-jc-grid]').length,
      unclamped: document.querySelectorAll('[data-jc-unclamped]').length,
      messages: document.querySelectorAll('[data-jc-msg]').length,
      sheets: { readable: readable, blocked: blocked, rules: rules },
      sampleTags: links.length ? extractTags(links[0]) : [],
      learnedTags: Object.keys(taste).length
    };
    var text = JSON.stringify(report, null, 2);
    try { navigator.clipboard.writeText(text); } catch (e) { /* ignore */ }
    console.log('%c[CRIMSONIZED] diagnose', 'color:#ff003c;font-weight:700', report);
    alertPanel('Diagnose copied. Cards: ' + report.managedCards + ', grids: ' + report.grids + '.');
  }

  /* ================================================================
   * title, routing, observers
   * ============================================================= */

  function enforceTitle() {
    if (!S.enabled || !S.title) return;
    if (document.title !== S.title) document.title = S.title;
  }

  var lastPath = location.pathname;

  function checkRoute() {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    log('route ->', lastPath);
    widthChecked = new WeakSet();
    if (!isHome()) removeShelves();
    applyRootVars();
    updatePill();
    schedule('all');
  }

  var timers = [];
  var observer = null;
  var keyHandler = null;

  /*
   * Leaves no trace behind, so re-running a newer build over a live older one
   * (or switching the whole thing off) does not end up with two instances
   * fighting over the same DOM.
   */
  function dispose() {
    disposed = true;
    timers.forEach(clearInterval);
    timers = [];
    if (observer) { observer.disconnect(); observer = null; }
    if (keyHandler) { document.removeEventListener('keydown', keyHandler, true); keyHandler = null; }
    try { teardown(); } catch (e) { /* ignore */ }
    [panelRoot, themeStyle, recolorStyle].forEach(function (n) {
      if (n && n.parentNode) n.parentNode.removeChild(n);
    });
    panelRoot = null;
    panelShadow = null;
    themeStyle = null;
    recolorStyle = null;
    document.documentElement.classList.remove('jc-on', 'jc-wide', 'jc-chat');
  }

  function boot() {
    injectStyles();
    applyRootVars();

    var mo = new MutationObserver(function (records) {
      if (!S.enabled) return;
      var needCards = false, needLayout = false;
      for (var i = 0; i < records.length; i++) {
        var rec = records[i];
        var target = rec.target;
        if (!target || target.nodeType !== 1) continue;
        if (target.id === 'jc-root' || target.hasAttribute('data-jc-ui')) continue;

        if (rec.type === 'childList' && rec.addedNodes.length) {
          needCards = true; needLayout = true;
          for (var j = 0; j < rec.addedNodes.length; j++) {
            var node = rec.addedNodes[j];
            if (node.nodeType === 1 && !node.hasAttribute('data-jc-ui')) schedule('paint', node);
          }
        } else if (rec.type === 'attributes') {
          // Ignore the echo of our own inline writes, otherwise we loop forever.
          if (rec.attributeName === 'style' && paintedStyle.get(target) === target.getAttribute('style')) continue;
          schedule('paint', target);
        }
      }
      if (needCards) schedule('cards');
      if (needLayout) schedule('layout');
      schedule('sheets');
    });

    observer = mo;

    var start = function () {
      if (disposed) return;
      if (!document.body) { setTimeout(start, 20); return; }
      buildPanel();
      mo.observe(document.body, {
        childList: true, subtree: true,
        attributes: true, attributeFilter: ['class', 'style']
      });
      refreshTagVocab();
      applyAll();
      enforceTitle();
      updatePill();
    };
    start();

    timers.push(setInterval(function () {
      if (disposed) return;
      checkRoute();
      enforceTitle();
    }, 500));

    window.addEventListener('resize', function () { schedule('layout'); });

    keyHandler = function (ev) {
      if (ev.altKey && (ev.key === 'c' || ev.key === 'C')) {
        ev.preventDefault();
        togglePanel();
      } else if (ev.key === 'Escape' && panelOpen) {
        togglePanel();
      }
    };
    document.addEventListener('keydown', keyHandler, true);
  }

  /* ================================================================
   * debug handle: window.CRIMSONIZED in the console
   * ============================================================= */

  var api = {
    version: VERSION,
    get settings() { return S; },
    get taste() { return taste; },
    get pool() { return pool; },
    remap: remap,
    parseColor: parseColor,
    apply: applyAll,
    teardown: teardown,
    dispose: dispose,
    diagnose: diagnose,
    panel: togglePanel,
    shelves: updateShelves,
    refreshShelves: refreshShelvesSoon,
    refreshPool: function () { return fetchPool(true).then(refreshShelvesSoon); }
  };
  // capture any live older build before we overwrite the handle
  var previous = null;
  try { previous = window.CRIMSONIZED || null; } catch (e) { /* ignore */ }

  try { window.CRIMSONIZED = api; } catch (e) { /* ignore */ }
  try { if (typeof unsafeWindow !== 'undefined') unsafeWindow.CRIMSONIZED = api; } catch (e) { /* ignore */ }

  // If an older build is already live (a dev reload, or two copies installed),
  // shut it down first so the two do not fight over the same DOM.
  try {
    if (previous && previous !== api && typeof previous.dispose === 'function') previous.dispose();
  } catch (e) { /* ignore */ }

  if (document.readyState === 'loading') {
    injectStyles();
    applyRootVars();
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
