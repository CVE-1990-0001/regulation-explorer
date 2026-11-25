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
  assert.strictEqual(deChip.querySelector('.tag-option-count').textContent, '7');
  assert.strictEqual(euChip.querySelector('.tag-option-count').textContent, '21');

  const finChip = getChip('topic', 'financial-markets');
  assert.ok(finChip, 'expected Financial Markets topic chip');
  assert.strictEqual(finChip.querySelector('.tag-option-count').textContent, '20');
});

test('multi-tag drill-down combines Jurisdiction + Topics with AND and prunes DORA folder tree', async () => {
  openPopover();

  // Select "Incident Reporting" (8 regulations across DORA + standalone acts)
  app.click(getChip('topic', 'incident-reporting'));
  await app.tick();

  assert.strictEqual(app.doc.getElementById('listMessage').textContent, '8 of 28 regulations');
  assert.strictEqual(app.doc.getElementById('tagFilterCount').textContent, '1');

  // DORA bundle stays in the sidebar, pruned down to matching DORA members only
  app.nav('#bundle:bundle_dora');
  await app.tick();
  const memberLinks = [...app.doc.querySelectorAll('.bundle-members .bundle-card-title')].map((el) => el.textContent.trim());
  assert.deepStrictEqual(memberLinks, ['DORA Regulation', 'RTS', 'ITS']);

  // Drill into DORA RTS sub-folder: only RTS 2 and RTS 3 relate to incident reporting
  app.nav('#bundle:bundle_dora_rts');
  await app.tick();
  const rtsLinks = [...app.doc.querySelectorAll('.bundle-members .bundle-card-title')].map((el) => el.textContent.trim());
  assert.deepStrictEqual(rtsLinks, ['RTS 2', 'RTS 3']);

  // Narrow further with Jurisdiction "DE": only BSIG matches both DE and Incident Reporting
  openPopover();
  app.click(getChip('jurisdiction', 'DE'));
  await app.tick();

  assert.strictEqual(app.doc.getElementById('listMessage').textContent, '1 of 28 regulations');
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

  // Act root header shows GDPR's Jurisdiction pill + topic chips; clicking "Data & Privacy" filters immediately
  const headerChips = [...app.doc.querySelectorAll('#actTopicTags .act-topic-tag')];
  assert.deepStrictEqual(headerChips.map((c) => c.textContent), ['EU', 'Data & Privacy', 'Incident Reporting']);

  app.click(headerChips[1]);
  await app.tick();

  assert.strictEqual(app.doc.getElementById('listMessage').textContent, '2 of 28 regulations');
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

test('legal entity chips and LE facet filter the sidebar to applicable regulations', async () => {
  await app.openAct('act_eu_emir_2012_0648');

  // Clicking an "Applies to" chip adds an LE filter: DORA family (12) + EMIR + GDPR apply to DBAG
  const dbagChip = () => [...app.doc.querySelectorAll('#legalEntityApplicability .legal-entity-chip')]
    .find((chip) => chip.textContent === 'DBAG');
  assert.strictEqual(dbagChip().title, 'Deutsche Boerse AG');
  app.click(dbagChip());
  await app.tick();

  assert.strictEqual(app.doc.getElementById('listMessage').textContent, '14 of 28 regulations');
  const pills = [...app.doc.querySelectorAll('#activeFilterPills .active-filter-pill')];
  assert.deepStrictEqual(pills.map((p) => p.querySelector('.active-filter-pill-label').textContent), ['LE: DBAG']);
  assert.strictEqual(dbagChip().classList.contains('is-active'), true);
  const titles = topSidebarTitles();
  assert.ok(titles.some((t) => t.includes('EMIR')) && titles.some((t) => t.includes('GDPR')));
  assert.ok(!titles.some((t) => t.includes('CSDR')), 'CSDR does not apply to DBAG');

  // The Tags popover lists the entity as a facet and it combines with topics (AND)
  openPopover();
  assert.strictEqual(getChip('legal-entity', 'DBAG').getAttribute('aria-pressed'), 'true');
  app.click(getChip('topic', 'data-privacy'));
  await app.tick();
  assert.strictEqual(app.doc.getElementById('listMessage').textContent, '1 of 28 regulations');

  // Clicking the facet again removes the LE filter
  openPopover();
  app.click(getChip('legal-entity', 'DBAG'));
  await app.tick();
  assert.strictEqual(app.doc.getElementById('listMessage').textContent, '2 of 28 regulations');
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

  // Direct act-level navigation (#act:...) to an excluded act also clears conflicting tag filters and highlights the act
  openPopover();
  app.click(getChip('topic', 'ai'));
  await app.tick();
  assert.strictEqual(app.doc.getElementById('tagFilterCount').textContent, '1');

  app.nav('#act:act_eu_emir_2012_0648');
  await app.tick();
  assert.strictEqual(app.doc.getElementById('tagFilterCount').hidden, true);
  assert.ok(app.doc.querySelector('#articleList .article-link.is-active'), 'EMIR should be visible and active in sidebar');
});

test('article pagination (Previous/Next) respects active tag filters and scoped act IDs', async () => {
  openPopover();
  app.click(getChip('topic', 'data-privacy')); // GDPR + Data Act
  await app.tick();

  // Open Data Act Article 1 (shares id "art_1" with GDPR); Next must go to Data Act Article 2, not GDPR Article 2
  app.nav('#a:act_eu_data_act_2023_2854:art_1');
  await app.tick();
  app.click(app.doc.getElementById('nextArticle'));
  await app.tick();
  assert.match(app.hash(), /act_eu_data_act_2023_2854:art_2$/);
});
