// Second pass: card interactions, chat route handling, and mutation churn.
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
<style>.cell{background:#1a202c;color:#a0aec0}.msg{background:#2d3748}</style></head><body>
  <main><div class="grid">
    ${card('c1', 'Alpha', ['anime', 'fantasy'])}
    ${card('c2', 'Bravo', ['fantasy', 'romance'])}
    ${card('c3', 'Charlie', ['scifi'])}
  </div></main>
</body></html>`;

const dom = new JSDOM(page, { url: 'https://janitorai.com/', runScripts: 'dangerously', pretendToBeVisual: true });
const { window } = dom;
window.eval(fs.readFileSync(process.argv[2], 'utf8'));

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const doc = window.document;
const $ = (s) => doc.querySelectorAll(s);
const cardOf = (name) => {
  const link = [...$('a[href*="/characters/"]')].find(a => a.textContent.includes(name));
  return link ? link.closest('[data-jc-card]') : null;
};
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

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

  // heart button boosts every tag on the card
  click(cardOf('Alpha').querySelector('.jc-fx button[data-act="like"]'));
  await wait(400);
  check('heart boosts tags', [api.taste.anime, api.taste.fantasy], [3, 3]);

  // cross button demotes and hides
  click(cardOf('Bravo').querySelector('.jc-fx button[data-act="hide"]'));
  await wait(400);
  check('cross demotes tags', [api.taste.fantasy, api.taste.romance], [1, -2]);
  check('cross hides the card', cardOf('Bravo').hasAttribute('data-jc-off'), true);

  // opening a character learns from it
  click(cardOf('Charlie').querySelector('a'));
  await wait(400);
  check('opening learns the tag', api.taste.scifi, 1);

  // churn check: nothing may keep mutating once the page has settled
  let mutations = 0;
  const spy = new window.MutationObserver(recs => { mutations += recs.length; });
  spy.observe(doc.body, { childList: true, subtree: true, attributes: true });
  await wait(2000);
  spy.disconnect();
  check('no mutation feedback loop while idle', mutations, 0);

  // chat route
  window.history.pushState({}, '', '/chats/abc-123');
  const main = doc.querySelector('main');
  main.innerHTML = '<div class="log"><div class="msg"><p>' +
    'She looks up from the desk, eyes narrowing at the sudden noise in the corridor outside.' +
    '</p></div></div>';
  await wait(1200);
  check('chat route flagged on html', doc.documentElement.className.includes('jc-chat'), true);
  check('message block detected', $('[data-jc-msg]').length, 1);
  check('innermost block wins', $('[data-jc-msg]')[0].tagName, 'P');

  console.log(fails ? '\n' + fails + ' FAILURES' : '\nall good');
  process.exit(fails ? 1 : 0);
})();
