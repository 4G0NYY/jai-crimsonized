// Landing page shelves, the character page like control, and the API fallbacks.
const fs = require('fs');
const { JSDOM } = require('jsdom');

const TAGS = ['📺 Anime', '🎲 RPG', '🔮 Magical', '❤️‍🔥 Smut', '👨 Male'];

function character(i, tags, nsfw) {
  return {
    id: 'id-' + i, name: 'Char ' + i, avatar: 'a' + i + '.webp',
    creator_name: 'maker' + i, description: 'A description for character ' + i,
    tags: tags.map((t, n) => ({ id: n, name: t, slug: t })),
    is_nsfw: !!nsfw, is_image_nsfw: false, stats: { chat: 1000 * i, message: 10 }
  };
}

// sort -> the characters that endpoint returns
const FIXTURES = {
  trending: [character(1, ['📺 Anime', '🎲 RPG']), character(2, ['🔮 Magical']), character(3, ['📺 Anime']), character(4, ['👨 Male'])],
  popular: [character(5, ['📺 Anime']), character(6, ['❤️‍🔥 Smut'], true), character(7, ['🎲 RPG']), character(8, ['🔮 Magical'])],
  latest: [character(9, ['📺 Anime']), character(10, ['🎲 RPG']), character(11, ['👨 Male']), character(12, ['🔮 Magical'])],
  random: [character(13, ['📺 Anime']), character(14, ['🎲 RPG']), character(15, ['👨 Male']), character(16, ['🔮 Magical'])]
};

const page = `<!doctype html><html><head><title>Janitor AI</title></head><body>
  <main>
    <div class="_exploreSection_abc123">filter tabs</div>
    <div class="characters-list-container-flex">
      <div class="pp-cc-list-container">
        <div class="cell"><a href="/characters/x1_alpha"><div>Alpha</div><span>📺 Anime</span><span>1k tokens</span></a></div>
        <div class="cell"><a href="/characters/x2_bravo"><div>Bravo</div><span>🎲 RPG</span></a></div>
        <div class="cell"><a href="/characters/x3_charlie"><div>Charlie</div><span>🔮 Magical</span></a></div>
      </div>
    </div>
  </main>
</body></html>`;

let failFetch = false;
const dom = new JSDOM(page, { url: 'https://janitorai.com/', runScripts: 'dangerously', pretendToBeVisual: true });
const { window } = dom;

const calls = [];
window.fetch = (url) => {
  calls.push(String(url));
  if (failFetch) return Promise.reject(new Error('offline'));
  if (String(url).includes('/hampter/tags')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(TAGS.map((t, i) => ({ id: i, name: t, slug: t }))) });
  }
  const sort = (String(url).match(/sort=(\w+)/) || [])[1];
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: FIXTURES[sort] || [], page: 1, size: 4, total: 4 }) });
};
window.eval(fs.readFileSync(process.argv[2], 'utf8'));

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const doc = window.document;
const $ = (s) => doc.querySelectorAll(s);
const shelfTitles = () => [...$('.jc-shelf-title')].map(e => e.textContent);

let fails = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label.padEnd(48) + ' -> ' + JSON.stringify(actual) +
    (ok ? '' : '  (expected ' + JSON.stringify(expected) + ')'));
}

(async () => {
  await wait(900);
  const api = window.CRIMSONIZED;

  check('shelves rendered', $('.jc-shelf').length > 0, true);
  check('recommended shelf is first', shelfTitles()[0], 'JC Recommended for you');
  check('janitor categories follow', shelfTitles().slice(1),
    ['Trending on Janitor', 'Popular right now', 'Fresh off the press', 'Roll the dice']);
  check('native list hidden', $('.characters-list-container-flex[data-jc-native-hidden]').length, 1);
  check('explore bar hidden', $('[class*="exploreSection"][data-jc-native-hidden]').length, 1);
  check('tiles built', $('.jc-tile').length > 8, true);
  check('tile links to the character', $('.jc-tile')[0].getAttribute('href').startsWith('/characters/id-'), true);
  check('tile url carries the slug', /_character-char-\d+$/.test($('.jc-tile')[0].getAttribute('href')), true);
  check('pool deduped across sorts', api.pool.all.length, 16);
  check('shelf tiles are not adopted as site cards', $('.jc-tile[data-jc-card]').length, 0);

  // the tag vocabulary makes card extraction exact ("1k tokens" is not a tag)
  // (poking taste directly bypasses saveTaste, so ask for the rebuild explicitly)
  api.taste['📺 anime'] = 5;
  api.refreshShelves();
  api.apply();
  await wait(700);
  check('vocabulary rejects junk tags', Object.keys(api.taste).includes('1k tokens'), false);
  check('recommended is populated once taste exists',
    $('.jc-shelf')[0].querySelectorAll('.jc-tile').length > 0, true);
  const recNames = [...$('.jc-shelf')[0].querySelectorAll('.jc-tile-name')].map(e => e.textContent);
  check('recommended holds anime characters', recNames.length >= 4, true);
  check('a strong tag earns its own shelf', shelfTitles().includes('More 📺 Anime'), true);

  // Site mutations must not rebuild the rows, or every DOM change from the app
  // would throw away how far you had dragged each rail.
  const railBefore = doc.querySelector('.jc-rail');
  railBefore.dataset.marker = 'keep-me';
  const noise = doc.createElement('div');
  noise.textContent = 'the site rendered something';
  doc.querySelector('main').appendChild(noise);
  await wait(800);
  check('rails survive unrelated site mutations',
    (doc.querySelector('.jc-rail').dataset || {}).marker, 'keep-me');

  // NSFW handling on shelves uses the API flag, not keyword guessing
  api.settings.hideNsfw = true;
  api.settings.nsfwMode = 'hide';
  api.apply();
  await wait(700);
  const names = [...$('.jc-tile-name')].map(e => e.textContent);
  check('nsfw character dropped from shelves', names.includes('Char 6'), false);
  check('sfw characters kept', names.includes('Char 5'), true);
  api.settings.hideNsfw = false;

  // liking from a character page
  window.history.pushState({}, '', '/characters/abc123_character-medieval-fantasy-world-rp');
  doc.querySelector('main').innerHTML = '<div><span>📺 Anime</span><span>🎲 RPG</span><span>not a tag</span></div>';
  await wait(1200);
  const shadow = doc.getElementById('jc-root').shadowRoot;
  check('like pill shown on a character page', shadow.getElementById('pill').classList.contains('show'), true);
  check('pill names the character', shadow.getElementById('pillwho').textContent, 'Medieval Fantasy World Rp');
  const before = api.taste['🎲 rpg'] || 0;
  shadow.getElementById('pilllike').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(300);
  check('pill like boosts the page tags', api.taste['🎲 rpg'], before + 3);
  check('pill ignores non tag text', Object.keys(api.taste).includes('not a tag'), false);
  check('pill shows the liked state', shadow.getElementById('pilllike').classList.contains('on'), true);

  // shelves must not appear off the landing page
  check('no shelves on a character page', $('.jc-shelf').length, 0);

  // a dead API gives the page back instead of blanking it
  window.history.pushState({}, '', '/');
  failFetch = true;
  api.refreshPool();
  await wait(900);
  window.CRIMSONIZED.shelves();
  await wait(900);
  check('native list restored when the api fails', $('[data-jc-native-hidden]').length, 0);

  console.log(fails ? '\n' + fails + ' FAILURES' : '\nall good');
  process.exit(fails ? 1 : 0);
})();
