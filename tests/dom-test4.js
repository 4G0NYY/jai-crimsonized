// Booting with state already in storage.
//
// Every other suite starts from an empty browser, which is exactly why the tag
// vocabulary cache took the script down in the wild without a single test going
// red: buildTagSet only touches tagCase when the cached list has entries, and on
// a fresh profile that list is empty. Anything read out of storage at startup
// gets a case here.
const fs = require('fs');
const { JSDOM } = require('jsdom');

const SCRIPT = fs.readFileSync(process.argv[2], 'utf8');

const TAGS = ['👨 Male', '👩‍🦰 Female', '📚 Fictional', '📺 Anime', '🎲 RPG'];

const page = `<!doctype html><html><head><title>Janitor AI</title></head><body>
  <main>
    <div class="pp-cc-list-container">
      <div class="cell"><a href="/characters/x1_alpha"><div>Alpha</div><span>📺 Anime</span><span>1k tokens</span></a></div>
      <div class="cell"><a href="/characters/x2_bravo"><div>Bravo</div><span>🎲 RPG</span></a></div>
      <div class="cell"><a href="/characters/x3_charlie"><div>Charlie</div><span>📚 Fictional</span></a></div>
    </div>
  </main>
</body></html>`;

let fails = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label.padEnd(50) + ' -> ' + JSON.stringify(actual) +
    (ok ? '' : '  (expected ' + JSON.stringify(expected) + ')'));
}

// Runs the userscript against a browser whose localStorage is seeded first, and
// reports what escaped rather than throwing, so one bad blob does not hide the rest.
function boot(seed) {
  const dom = new JSDOM(page, { url: 'https://janitorai.com/', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  Object.keys(seed).forEach((k) => window.localStorage.setItem(k, seed[k]));
  window.fetch = () => Promise.reject(new Error('offline'));
  let threw = null;
  try { window.eval(SCRIPT); } catch (e) { threw = String(e && e.message || e); }
  return { window, threw };
}

const cached = JSON.stringify({ ts: Date.now(), list: TAGS });

// The exact failure: a vocabulary cached by an earlier visit.
let r = boot({ 'jc.tags.v1': cached });
check('cached vocabulary does not throw at startup', r.threw, null);
check('script is live', typeof r.window.CRIMSONIZED, 'object');

// ...and it has to be in use, not merely survived.
r.window.document.querySelector('main').appendChild(r.window.document.createElement('div'));
const api = r.window.CRIMSONIZED;
check('cached vocabulary is used for extraction', api.settings.enabled, true);

// A vocabulary cached alongside real taste and settings, which is what any
// profile that has been used for more than one session actually looks like.
r = boot({
  'jc.tags.v1': cached,
  'jc.taste.v1': JSON.stringify({ '📺 anime': 6, '🎲 rpg': 3 }),
  'jc.settings.v1': JSON.stringify({ enabled: true, shelves: false, contentWidth: 90 }),
  'jc.seen.v1': JSON.stringify({ 'x1': 1 }),
  'jc.liked.v1': JSON.stringify({ 'x2': 1 })
});
check('a full profile boots', r.threw, null);
check('taste survives the reload', r.window.CRIMSONIZED.taste['📺 anime'], 6);
check('settings survive the reload', r.window.CRIMSONIZED.settings.contentWidth, 90);

// Blobs no sane run would write, but a half finished quota-exceeded write can.
[
  ['vocabulary stored as a bare array', '["📺 Anime"]'],
  ['vocabulary list of the wrong type', '{"ts":1,"list":"anime"}'],
  ['vocabulary with holes in the list', '{"ts":1,"list":["📺 Anime",null,""]}'],
  ['vocabulary that is not an object', '"nope"'],
  ['unparseable json', '{oh no']
].forEach(function (pair) {
  const out = boot({ 'jc.tags.v1': pair[1] });
  check(pair[0], out.threw, null);
  check(pair[0] + ', still live', typeof out.window.CRIMSONIZED, 'object');
});

console.log(fails ? '\n' + fails + ' failing' : '\nall good');
process.exit(fails ? 1 : 0);
