# Janitor CRIMSONIZED

A Violentmonkey userscript that rebuilds the janitor.ai frontend in place: crimson theming
lifted from crimson-client, a card grid that actually uses the window, an NSFW filter, and
a taste model that learns which tags you keep opening.

Everything runs inside the real page, so Cloudflare sees a normal janitor.ai session.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser.
2. Open the Tampermonkey dashboard, click the **+** tab (Create a new script).
3. Delete the placeholder, paste the whole of `janitor-crimsonized.user.js`, press Ctrl+S.
4. Open <https://janitorai.com>. A round **JC** button appears in the bottom right.

Press **Alt+C** or click that button to open the control panel. **Esc** closes it.

## What it does

**Landing page.** With shelves on (the default), the single endless grid is replaced by
draggable rows: **JC Recommended for you** first, then a row for each tag you have clearly
committed to, then janitor's own categories (Trending, Popular, Fresh off the press, Roll the
dice). Drag a row sideways with the mouse, use the arrows, or swipe. The rows are built from
janitor's own API (`/hampter/characters`, the same call the site makes) and scored against
your learned tags. If that API ever changes, the shelves remove themselves and janitor's
normal list comes back rather than leaving you with an empty page. Toggle it in the panel.

**Hearting from anywhere.** Cards in a grid have a heart on hover. Arriving from search you
land on the character page itself, where there is no card, so the same control appears as a
pill next to the JC button. It reads the tag chips off the page and scores them exactly like
a card heart, and remembers which characters you liked.

**Theme.** The crimson palette comes straight from `crimson-client/src/index.css`
(`#1a0005` through `#fff5f6`). Rather than guessing at janitor.ai's class names, the script
reads the colours the site actually renders and remaps them: neutral greys drop onto the
crimson ramp by brightness, and saturated accents keep their lightness but get rotated into
the crimson hue band. Two passes do this:

- The stylesheet pass rewrites the site's own CSS rules, including the Chakra
  `--chakra-colors-*` custom properties, which recolours hover states and pseudo elements
  that inline styles cannot reach.
- The element pass catches anything set inline or coming from a stylesheet the browser will
  not let the script read.

Either can be switched off in the panel if you want a lighter touch.

The element pass defaults to **inline styles only**, and that default matters. Writing an
inline style invalidates document style, so a `getComputedStyle` right afterwards forces a
full recalculation. Reading and writing one element at a time therefore costs one recalc per
element: measured on the live home page that was 1002ms for 600 elements, which was the
multi second freeze on load. The same 600 elements cost 6ms when every read happens before
every write. On top of that, the stylesheet pass turned out to do essentially all of the
theming on its own: switching the element pass off and stripping all 1773 of its overrides
changed two avatar rings and nothing else. So the default now measures only the elements
carrying an inline colour of their own, which is one element on a character page instead of
1844, and it also catches the inline gradient banner that the old full scan missed. **Deep**
mode restores the full scan if you ever see something stay grey.

**Tags.** On first load the script fetches janitor's canonical tag list once a day and caches
it. Tag detection is then exact rather than guessed, so stray labels like "1k tokens" no
longer end up in your taste profile.

**Layout.** Any container clamped to a narrow reading column (between 420px and 1500px) gets
released to a width you control with a slider, default 94vw. On browse pages the card
container is rebuilt as a real responsive grid, either auto filling or a fixed number of
columns.

**Filtering.** Hide NSFW either blurs the card with a click to reveal, or drops it from the
grid entirely. The keyword list is editable, as is a separate hard block list. There is also
a live quick filter and an option to hide characters you have already opened.

**Taste.** Opening a character adds a point to each of its tags. The heart button on a card
adds three, the cross demotes by two and hides the character. Grids are then sorted by score,
and you can hide anything below a threshold. The panel lists the learned tags with weights so
you can prune anything the tag extraction picked up wrongly.

Sorting is done with CSS `order` rather than by moving nodes, so React's rendering is never
disturbed.

**Title.** Set to `Janitor CRIMSONIZED` and re-applied when the app changes it. Editable in
the panel.

Settings, taste weights, hidden and opened characters are stored per browser and can be
exported or imported as JSON from the Tools section.

## If something looks wrong

janitor.ai ships hashed class names that change on every deploy, so the script deliberately
never matches on them. If a future redesign still breaks something:

1. Open the panel, Tools, **Diagnose**. It copies a report to your clipboard and logs it to
   the console: how many character links it found, how many it adopted as cards, how many
   grids and narrow containers it caught, how many stylesheets it could read, and the tags it
   extracted from the first card.
2. **Re-apply** forces a full rescan without a reload.
3. Turning off **Enable everything** restores the page without a reload.

`window.CRIMSONIZED` in the devtools console exposes `settings`, `taste`, `pool`, `remap`,
`apply`, `teardown`, `dispose`, `diagnose`, `panel`, `shelves`, `refreshShelves` and
`refreshPool`. One caveat: Tampermonkey hands the page a copy of `settings`, so assigning to
it from the console does nothing. Change settings through the panel.

The knobs worth knowing about, near the top of the script:

- `DEFAULTS` for every setting and its starting value.
- `CARD_SEL` for how character cards are recognised.
- `PALETTE` and `RAMP` for the colours.
- The chroma threshold of `0.18` in `remap`, which decides whether a colour is treated as a
  neutral surface or as an accent.

## Tests

`tests/` holds five node scripts that run the userscript against a stubbed and a jsdom DOM:
colour mapping, card handling and filtering, interactions and mutation churn, the shelves,
the character page pill and the API fallbacks, and finally booting against a browser that
already has settings, taste and a cached tag vocabulary in storage.

```
cd tests
npm install jsdom
node smoke.js ../janitor-crimsonized.user.js
node dom-test.js ../janitor-crimsonized.user.js
node dom-test2.js ../janitor-crimsonized.user.js
node dom-test3.js ../janitor-crimsonized.user.js
node dom-test4.js ../janitor-crimsonized.user.js
```

That last one exists because every other suite starts from an empty browser, and the one bug
that took the whole script down in the wild only appeared on the *second* visit, once the tag
vocabulary had been cached.

## Known limits

- Semantic colours lose their meaning. A green success toast comes out crimson like
  everything else. Turn off element recolouring if that ever matters.
- Tag extraction is a heuristic over short leaf text inside a card, so it can pick up a stray
  label. The panel shows exactly what was learned and lets you delete entries.
- Sorting only reorders the cards currently loaded, which is what infinite scroll allows.
- Shelves are built from roughly 170 characters pulled across janitor's four sort modes, so
  "Recommended" picks from that pool rather than the whole site. The server ignores tag and
  search filters on that endpoint, so there is no way to ask it for a specific tag.
- The shelf pool is cached for ten minutes. Use Refresh shelves in the panel to force it.
