// Runtime integration tests for faceted Jurisdiction + Topic tag filtering.
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert');
const { bootApp } = require('./jsdom_harness');

let app;
before(async () => { app = await bootApp(); });

beforeEach(async () => {
  // Ensure clean state before each test
  const input = app.doc.getElementById('searchInput');
  if (input.value) {
    input.value = '';
    input.dispatchEvent(new app.window.Event('input', { bubbles: true }));
  }
  const tagBtn = app.doc.getElementById('tagFilterButton');
  if (app.doc.getElementById('tagFilterPopover').hidden) {
    app.click(tagBtn);
  }
  const clearBtn = app.doc.querySelector('.tag-clear-button');
  if (clearBtn) {
    app.click(clearBtn);
  }
  if (!app.doc.getElementById('tagFilterPopover').hidden) {
    app.click(tagBtn);
  }
  await app.tick();
});

const openPopover = () => {
  const btn = app.doc.getElementById('tagFilterButton');
  const popover = app.doc.getElementById('tagFilterPopover');
  if (popover.hidden) app.click(btn);
  return popover;
};

const getChip = (kind, value) => app.doc.querySelector(
  `#tagFilterPopover .tag-option-chip[data-filter-kind="${kind}"][data-filter-value="${value}"]`,
);

const topSidebarTitles = () => [...app.doc.querySelectorAll('#articleList > .article-list-item > .article-link .list-article-number')]
  .map((el) => el.textContent.trim());

test('tag popover opens with Jurisdiction and Topic facets and live counts', () => {
  const popover = openPopover();
  assert.strictEqual(popover.hidden, false);

  const deChip = getChip('jurisdiction', 'DE');
  const euChip = getChip('jurisdiction', 'EU');
  assert.ok(deChip && euChip, 'expected EU and DE jurisdiction chips');
  assert.strictEqual(deChip.querySelector('.tag-option-count').textContent, '3');
  assert.strictEqual(euChip.querySelector('.tag-option-count').textContent, '21');

  const finChip = getChip('topic', 'financial-markets');
  assert.ok(finChip, 'expected Financial Markets topic chip');
  assert.strictEqual(finChip.querySelector('.tag-option-count').textContent, '16');
});

test('multi-tag drill-down combines Jurisdiction + Topics with AND and prunes DORA folder tree', async () => {
  openPopover();

  // Select "Incident Reporting" (8 regulations across DORA + standalone acts)
  app.click(getChip('topic', 'incident-reporting'));
  await app.tick();

  assert.strictEqual(app.doc.getElementById('listMessage').textContent, '8 of 24 regulations');
  assert.strictEqual(app.doc.getElementById('tagFilterCount').textContent, '1');

  // DORA bundle stays in the sidebar, pruned down to matching DORA members only
  app.nav('#bundle:bundle_dora');
  await app.tick();
  const memberLinks = [...app.doc.querySelectorAll('.bundle-members a')].map((a) => a.textContent.trim());
  assert.deepStrictEqual(memberLinks, ['DORA Regulation', 'RTS', 'ITS']);

  // Drill into DORA RTS sub-folder: only RTS 2 and RTS 3 relate to incident reporting
  app.nav('#bundle:bundle_dora_rts');
  await app.tick();
  const rtsLinks = [...app.doc.querySelectorAll('.bundle-members a')].map((a) => a.textContent.trim());
  assert.deepStrictEqual(rtsLinks, ['RTS 2', 'RTS 3']);

  // Narrow further with Jurisdiction "DE": only BSIG matches both DE and Incident Reporting
  openPopover();
  app.click(getChip('jurisdiction', 'DE'));
  await app.tick();

  assert.strictEqual(app.doc.getElementById('listMessage').textContent, '1 of 24 regulations');
  assert.deepStrictEqual(topSidebarTitles(), ['DEBSIG']);
});

test('search respects active tag filters and updates live facet counts', async () => {
  openPopover();
  app.click(getChip('jurisdiction', 'DE'));
  await app.tick();

  // Search for "cloud" while filtered to DE: only BSI C3A and BSIG match (GDPR/Data Act/DORA excluded)
  const input = app.doc.getElementById('searchInput');
  input.value = 'cloud';
  input.dispatchEvent(new app.window.Event('input', { bubbles: true }));
  await app.tick();

  const titles = topSidebarTitles();
  assert.ok(titles.every((t) => t.startsWith('DE')), `expected only DE acts, got ${titles}`);
  assert.ok(titles.some((t) => t.includes('BSI C3A')));
  assert.ok(!titles.some((t) => t.includes('Data Act')));
});

test('inline active pills, Backspace removal, and clickable act-header topic chips work', async () => {
  await app.openAct('act_eu_gdpr_2016_0679');

  // Act root header shows GDPR's topic chips; clicking "Data & Privacy" filters immediately
  const headerChips = [...app.doc.querySelectorAll('#actTopicTags .act-topic-tag')];
  assert.deepStrictEqual(headerChips.map((c) => c.textContent), ['Data & Privacy', 'Incident Reporting']);

  app.click(headerChips[0]);
  await app.tick();

  assert.strictEqual(app.doc.getElementById('listMessage').textContent, '2 of 24 regulations');
  const pills = [...app.doc.querySelectorAll('#activeFilterPills .active-filter-pill')];
  assert.strictEqual(pills.length, 1);
  assert.match(pills[0].textContent, /Data & Privacy/);

  // Pressing Backspace in an empty search input removes the active filter pill
  const input = app.doc.getElementById('searchInput');
  input.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
  await app.tick();

  assert.strictEqual(app.doc.getElementById('activeFilterPills').hidden, true);
  assert.strictEqual(app.doc.getElementById('listMessage').textContent, '');
});

test('cross-act reference to an act outside the active tag filter clears tags and navigates cleanly', async () => {
  // Filter to "Data & Privacy" (GDPR + Data Act), open Data Act, then click a cross-ref if needed
  // or open DORA RTS 1 filtered to "Cybersecurity" then navigate via hash to EMIR (not Cybersecurity)
  openPopover();
  app.click(getChip('topic', 'data-privacy'));
  await app.tick();
  assert.strictEqual(app.doc.getElementById('tagFilterCount').textContent, '1');

  // Navigating to an article in EMIR (which does not have data-privacy) auto-clears conflicting tag filter
  app.nav('#a:act_eu_emir_2012_0648:art_1');
  await app.tick();
  assert.strictEqual(app.doc.getElementById('tagFilterCount').hidden, true);
  assert.match(app.hash(), /act_eu_emir_2012_0648:art_1/);
});
