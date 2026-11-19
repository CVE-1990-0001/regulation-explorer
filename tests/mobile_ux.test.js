// Comprehensive Mobile & Touch UX integration tests:
// - Off-canvas drawer open/close (Browse button, close button, backdrop, Escape, resize > 1080px)
// - Smart drawer behavior: stays open when expanding folders/acts, auto-closes on article selection
// - Auto-open drawer when typing search query on mobile viewport
// - Touch tap-to-toggle & tap-outside-to-dismiss on defined-term tooltips
// - Tap-to-reveal paragraph copy tools without conflicting with links or defined terms
// - Narrow 360px viewport boundary clamping on tooltips
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert');
const { bootApp } = require('./jsdom_harness');

let app;
before(async () => { app = await bootApp(); });

const setViewport = (width, height = 780, isTouch = true) => {
  app.window.innerWidth = width;
  app.window.innerHeight = height;
  app.window.matchMedia = (q) => ({
    matches: q.includes('hover: none') ? isTouch : false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  });
  app.window.dispatchEvent(new app.window.Event('resize'));
};

beforeEach(async () => {
  setViewport(390, 844, true); // iPhone 14/15 viewport
  const input = app.doc.getElementById('searchInput');
  if (input.value) {
    input.value = '';
    input.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    await app.tick();
  }
  const closeBtn = app.doc.getElementById('mobileDrawerClose');
  if (app.doc.getElementById('sidePanel').classList.contains('is-drawer-open')) {
    app.click(closeBtn);
  }
});

test('mobile drawer opens via Browse button and closes via backdrop, close button, Escape, and desktop resize', () => {
  const toggleBtn = app.doc.getElementById('mobileNavToggle');
  const sidePanel = app.doc.getElementById('sidePanel');
  const backdrop = app.doc.getElementById('mobileDrawerBackdrop');
  const closeBtn = app.doc.getElementById('mobileDrawerClose');

  assert.strictEqual(sidePanel.classList.contains('is-drawer-open'), false);
  assert.strictEqual(backdrop.hidden, true);
  assert.strictEqual(toggleBtn.getAttribute('aria-expanded'), 'false');

  // 1. Open via Browse button
  app.click(toggleBtn);
  assert.strictEqual(sidePanel.classList.contains('is-drawer-open'), true);
  assert.strictEqual(backdrop.hidden, false);
  assert.strictEqual(toggleBtn.getAttribute('aria-expanded'), 'true');
  assert.strictEqual(app.doc.body.classList.contains('has-open-drawer'), true);

  // 2. Close via backdrop tap
  app.click(backdrop);
  assert.strictEqual(sidePanel.classList.contains('is-drawer-open'), false);
  assert.strictEqual(backdrop.hidden, true);
  assert.strictEqual(app.doc.body.classList.contains('has-open-drawer'), false);

  // 3. Open and close via drawer X button
  app.click(toggleBtn);
  assert.strictEqual(sidePanel.classList.contains('is-drawer-open'), true);
  app.click(closeBtn);
  assert.strictEqual(sidePanel.classList.contains('is-drawer-open'), false);

  // 4. Open and close via Escape key
  app.click(toggleBtn);
  app.doc.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.strictEqual(sidePanel.classList.contains('is-drawer-open'), false);

  // 5. Resizing above 1080px automatically resets mobile drawer state
  app.click(toggleBtn);
  assert.strictEqual(sidePanel.classList.contains('is-drawer-open'), true);
  setViewport(1280, 900, false);
  assert.strictEqual(sidePanel.classList.contains('is-drawer-open'), false);
  assert.strictEqual(app.doc.body.classList.contains('has-open-drawer'), false);
});

test('expanding folders/acts keeps mobile drawer open to pick an article, while selecting an article auto-closes it', async () => {
  const toggleBtn = app.doc.getElementById('mobileNavToggle');
  const sidePanel = app.doc.getElementById('sidePanel');

  app.click(toggleBtn);
  assert.strictEqual(sidePanel.classList.contains('is-drawer-open'), true);

  // Expanding GDPR keeps the drawer open so its child articles can be tapped
  const gdprRow = [...sidePanel.querySelectorAll('#articleList > .article-list-item > .article-link')]
    .find((btn) => /GDPR/.test(btn.textContent));
  assert.ok(gdprRow, 'expected GDPR row in drawer');
  app.click(gdprRow);
  await app.tick();
  assert.strictEqual(sidePanel.classList.contains('is-drawer-open'), true, 'drawer stays open when expanding act');

  // Tapping Article 5 inside GDPR selects it and auto-closes the drawer
  const art5Row = [...sidePanel.querySelectorAll('.act-article-list .article-child-link')]
    .find((btn) => /^Article 5\b/.test(btn.querySelector('.list-article-number')?.textContent || ''));
  assert.ok(art5Row, 'expected GDPR Article 5 child row');
  app.click(art5Row);
  await app.tick();
  assert.strictEqual(sidePanel.classList.contains('is-drawer-open'), false, 'drawer auto-closes on article selection');
  assert.match(app.hash(), /act_eu_gdpr_2016_0679:art_5$/);
});

test('typing in search on mobile auto-opens the navigation drawer to reveal matching regulations and articles', async () => {
  const sidePanel = app.doc.getElementById('sidePanel');
  const input = app.doc.getElementById('searchInput');

  assert.strictEqual(sidePanel.classList.contains('is-drawer-open'), false);
  input.focus();
  input.value = 'incident';
  input.dispatchEvent(new app.window.Event('input', { bubbles: true }));
  await app.tick();

  assert.strictEqual(sidePanel.classList.contains('is-drawer-open'), true, 'typing in search on mobile opens drawer');
});

test('touch tapping a defined term toggles its tooltip and tapping outside dismisses it', async () => {
  app.nav('#a:act_eu_gdpr_2016_0679:art_5');
  await app.tick();

  const container = app.doc.getElementById('paragraphsContainer');
  const term = container.querySelector('.defined-term');
  assert.ok(term, 'expected a defined term in GDPR Art. 5');

  // Tap (click with detail=1 on touch matchMedia) shows tooltip
  term.dispatchEvent(new app.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
  const tooltip = app.doc.querySelector('.legal-tooltip');
  assert.ok(tooltip && tooltip.classList.contains('is-visible'), 'tap opens defined-term tooltip');

  // Tapping the same defined term a second time on touch toggles it closed
  term.dispatchEvent(new app.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
  assert.strictEqual(tooltip.classList.contains('is-visible'), false, 'second tap closes defined-term tooltip');

  // Re-open, then tap outside on paragraph text -> tooltip dismisses cleanly
  term.dispatchEvent(new app.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
  assert.strictEqual(tooltip.classList.contains('is-visible'), true);
  app.doc.body.dispatchEvent(new app.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
  assert.strictEqual(tooltip.classList.contains('is-visible'), false, 'outside tap dismisses tooltip');
});

test('tap-to-reveal paragraph tools works on mobile without interfering with defined terms or links, and tooltips clamp inside 360px viewport', async () => {
  setViewport(360, 740, true);
  app.nav('#a:act_eu_gdpr_2016_0679:art_6');
  await app.tick();

  const paras = [...app.doc.querySelectorAll('#paragraphsContainer .article-paragraph.has-paragraph-tools')];
  const para = paras[1];
  const paraC = paras[2];
  assert.ok(para && paraC, 'expected multiple paragraphs with tools in GDPR Art. 6');
  assert.strictEqual(para.classList.contains('is-touch-selected'), false);

  // Tapping paragraph selects it to reveal copy tools
  app.click(para);
  assert.strictEqual(para.classList.contains('is-touch-selected'), true);

  // Tapping a second paragraph moves the selection cleanly
  app.click(paraC);
  assert.strictEqual(para.classList.contains('is-touch-selected'), false);
  assert.strictEqual(paraC.classList.contains('is-touch-selected'), true);

  // Narrow 360px viewport clamping: tooltip left never goes below viewportPadding (8px)
  const term = paraC.querySelector('.defined-term') || app.doc.querySelector('#paragraphsContainer .defined-term');
  term.dispatchEvent(new app.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
  const tooltip = app.doc.querySelector('.legal-tooltip');
  const leftPx = parseInt(tooltip.style.left, 10);
  assert.ok(leftPx >= 8, `expected tooltip left >= 8px on 360px screen, got ${leftPx}`);
});
