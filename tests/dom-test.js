// Drives the userscript against a janitor-shaped DOM in jsdom.
const fs = require('fs');
const { JSDOM } = require('jsdom');

const card = (id, name, tags) => `
  <div class="cell">
    <a href="/characters/${id}_${name.toLowerCase()}">
      <img src="x.png">
      <div class="meta">
        <div class="name">${name}</div>
        <div class="by">@maker</div>
        ${tags.map(t => `<span class="tag">${t}</span>`).join('')}
        <div class="count">1.2k</div>
      </div>
    </a>
  </div>`;

const page = `<!doctype html><html><head><title>Janitor AI</title>
<style>.cell{background:#1a202c;color:#a0aec0}.wrap{max-width:900px}</style>
</head><body>
  <header><a href="/characters/solo1_open">Currently open character</a></header>
  <main>
    <div class="wrap">
      <div class="grid">
        ${card('c1', 'Alpha', ['anime', 'fantasy'])}
        ${card('c2', 'Bravo', ['fantasy', 'romance'])}
        ${card('c3', 'Charlie', ['scifi'])}
        ${card('c4', 'Delta', ['nsfw', 'smut'])}
        ${card('c5', 'Echo', ['anime', 'scifi'])}
      </div>
    </div>
  </main>
</body></html>`;

const dom = new JSDOM(page, { url: 'https://janitorai.com/', runScripts: 'dangerously', pretendToBeVisual: true });
const { window } = dom;
window.eval(fs.readFileSync(process.argv[2], 'utf8'));

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const $ = (sel) => window.document.querySelectorAll(sel);
const cardOf = (name) => {
  const link = [...$('a[href*="/characters/"]')].find(a => a.textContent.includes(name));
  return link ? link.closest('[data-jc-card]') : null;
};

let fails = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label.padEnd(46) + ' -> ' + JSON.stringify(actual) +
    (ok ? '' : '  (expected ' + JSON.stringify(expected) + ')'));
}

(async () => {
  await wait(700);
  const api = window.CRIMSONIZED;
  if (!api) { console.error('FAIL: no CRIMSONIZED handle'); process.exit(1); }

  check('title overridden', window.document.title, 'Janitor CRIMSONIZED');
  check('cards adopted', $('[data-jc-card]').length, 5);
  check('grid adopted', $('[data-jc-grid]').length, 1);
  check('grid is the card container', $('[data-jc-grid]')[0].className, 'grid');
  check('lone header link untouched',
    window.document.querySelector('header a').closest('[data-jc-card]'), null);
  check('narrow container unclamped', $('[data-jc-unclamped]').length >= 1, true);
  check('card controls injected', $('[data-jc-card] .jc-fx').length, 5);

  // NSFW blurring
  api.settings.hideNsfw = true;
  api.apply();
  await wait(500);
  check('nsfw card blurred', !!cardOf('Delta').hasAttribute('data-jc-blur'), true);
  check('clean card not blurred', cardOf('Alpha').hasAttribute('data-jc-blur'), false);

  api.settings.nsfwMode = 'hide';
  api.apply();
  await wait(500);
  check('nsfw card removed in hide mode', cardOf('Delta').hasAttribute('data-jc-off'), true);
  api.settings.hideNsfw = false;

  // taste sorting
  api.taste.fantasy = 6;
  api.taste.scifi = 2;
  api.apply();
  await wait(500);
  const order = [...$('[data-jc-card]')].map(c => [c.textContent.match(/^\s*(\w+)/)[1], c.style.order]);
  const byOrder = order.sort((a, b) => Number(a[1]) - Number(b[1])).map(x => x[0]);
  check('grid sorted by learned taste', byOrder.slice(0, 2), ['Alpha', 'Bravo']);
  check('score badge shown', cardOf('Alpha').querySelector('.jc-score').textContent, '+6');

  // quick filter
  api.settings.quickFilter = 'charlie';
  api.apply();
  await wait(500);
  check('quick filter keeps the match', cardOf('Charlie').hasAttribute('data-jc-off'), false);
  check('quick filter hides the rest', cardOf('Alpha').hasAttribute('data-jc-off'), true);
  api.settings.quickFilter = '';

  // teardown restores the page
  api.settings.enabled = false;
  api.apply();
  await wait(500);
  check('teardown removes card marks', $('[data-jc-card]').length, 0);
  check('teardown removes grid marks', $('[data-jc-grid]').length, 0);
  check('teardown removes painted styles', $('[data-jc-painted]').length, 0);

  // and re-enabling brings it all back
  api.settings.enabled = true;
  api.apply();
  await wait(600);
  check('re-enable restores cards', $('[data-jc-card]').length, 5);
  check('no duplicate controls', $('[data-jc-card] .jc-fx').length, 5);

  console.log(fails ? '\n' + fails + ' FAILURES' : '\nall good');
  process.exit(fails ? 1 : 0);
})();
