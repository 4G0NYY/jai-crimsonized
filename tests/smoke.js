// Minimal DOM stub so the userscript can be loaded in node and its pure
// helpers exercised. Not a browser, just enough surface to reach the API.
const fs = require('fs');

function fakeStyle() {
  const map = {};
  return {
    setProperty: (k, v) => { map[k] = v; },
    removeProperty: (k) => { delete map[k]; },
    getPropertyValue: (k) => map[k] || '',
    _map: map
  };
}

function fakeEl(tag) {
  const attrs = {};
  return {
    tagName: (tag || 'div').toUpperCase(),
    nodeType: 1,
    id: '',
    textContent: '',
    style: fakeStyle(),
    classList: { toggle() {}, contains() { return false; }, add() {}, remove() {} },
    children: [],
    setAttribute: (k, v) => { attrs[k] = v; },
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    removeAttribute: (k) => { delete attrs[k]; },
    hasAttribute: (k) => k in attrs,
    appendChild(c) { this.children.push(c); return c; },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    closest: () => null,
    attachShadow: () => ({
      appendChild: () => {},
      getElementById: () => null
    })
  };
}

const html = fakeEl('html');
global.document = {
  readyState: 'loading',
  documentElement: html,
  head: fakeEl('head'),
  body: null,
  title: '',
  styleSheets: [],
  createElement: fakeEl,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {}
};
global.window = global;
global.location = { pathname: '/', href: 'https://janitorai.com/' };
global.getComputedStyle = () => null;
global.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
global.SVGElement = class {};
global.navigator = { clipboard: { writeText: () => {} } };

const src = fs.readFileSync(process.argv[2], 'utf8');
eval(src);

const api = global.CRIMSONIZED;
if (!api) { console.error('FAIL: no CRIMSONIZED handle'); process.exit(1); }

let fails = 0;
function check(label, got, predicate) {
  const ok = predicate(got);
  if (!ok) fails++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label.padEnd(42) + ' -> ' + got);
}

// parsing
check('parse #fff', JSON.stringify(api.parseColor('#fff')), v => v === '{"r":255,"g":255,"b":255,"a":1}');
check('parse rgba space syntax', JSON.stringify(api.parseColor('rgb(255 0 60 / 50%)')), v => v === '{"r":255,"g":0,"b":60,"a":0.5}');
check('parse hsl', JSON.stringify(api.parseColor('hsl(348, 100%, 50%)')), v => /"r":255/.test(v));
check('parse transparent', JSON.stringify(api.parseColor('transparent')), v => v === '{"r":0,"g":0,"b":0,"a":0}');
check('parse currentColor', String(api.parseColor('currentColor')), v => v === 'null');
check('parse garbage', String(api.parseColor('linear-gradient(red)')), v => v === 'null');

// remapping: neutrals ride the ramp, alpha survives, accents rotate to crimson
const near = (s) => s.replace(/rgba?\(|\)/g, '').split(',').map(Number);
check('dark chakra grey -> deep crimson', api.remap('#1a202c', 'bg'), v => {
  const [r, g, b] = near(v); return r > g && r > b && r < 60;
});
check('white text stays near white', api.remap('#ffffff', 'text'), v => {
  const [r, g, b] = near(v); return r > 245 && g > 235 && b > 235;
});
check('mid grey text -> rose', api.remap('rgb(160,160,160)', 'text'), v => {
  const [r, g, b] = near(v); return r > g && r > b;
});
check('alpha preserved', api.remap('rgba(20,20,20,0.4)', 'bg'), v => /,0\.4\)$/.test(v));
check('blue accent -> crimson hue', api.remap('#3b82f6', 'bg'), v => {
  const [r, g, b] = near(v); return r > g && r > b;
});
check('green accent -> crimson hue', api.remap('#22c55e', 'bg'), v => {
  const [r, g, b] = near(v); return r > g && r > b;
});
check('black -> near black crimson', api.remap('#000000', 'bg'), v => {
  const [r, g, b] = near(v); return r < 30 && g < 10;
});
const once = api.remap('#1a202c', 'bg');
check('idempotent on own output', api.remap(once, 'bg'), v => v === once);
check('idempotent via computed rgb() form', api.remap('rgb(24, 0, 5)', 'bg'), v => v === 'rgb(24, 0, 5)');
check('chakra gray.700 -> ramp', api.remap('#2d3748', 'bg'), v => {
  const [r, g, b] = near(v); return r > g && r > b && r < 70;
});
check('dim grey text stays readable', api.remap('rgb(113,128,150)', 'text'), v => {
  const [r] = near(v); return r > 200;
});
check('border grey -> dark crimson', api.remap('rgb(45,55,72)', 'border'), v => {
  const [r, g, b] = near(v); return r > g && r < 70;
});

console.log(fails ? '\n' + fails + ' FAILURES' : '\nall good');
process.exit(fails ? 1 : 0);
