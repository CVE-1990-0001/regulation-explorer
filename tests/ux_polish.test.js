// Runtime integration tests for UX & UI polish features:
// dossier metadata bar, internal vs external ref indicators, enriched bundle cards,
// search match stepper + sidebar hit badges, keyboard shortcuts, contextual Prev/Next cards, and copy toast.
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert');
const { bootApp } = require('./jsdom_harness');

let app;
before(async () => { app = await bootApp(); });

beforeEach(async () => {
  const input = app.doc.getElementById('searchInput');
  if (input.value) {
    input.value = '';
    input.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    await app.tick();
  }
});

test('act dossier bar shows article count, clickable defined-terms jump, and official source link', async () => {
  await app.openAct('act_eu_gdpr_2016_0679');
  const dossier = app.doc.getElementById('actDossierMeta');
  assert.strictEqual(dossier.hidden, false);
  assert.match(dossier.textContent, /99 articles/);
  assert.match(dossier.textContent, /27 defined terms/);
  assert.match(dossier.textContent, /EUR-Lex/);

  // Clicking "27 defined terms" jumps straight to GDPR Article 4 (Definitions)
  const defJumpBtn = [...dossier.querySelectorAll('button.dossier-stat-link')]
    .find((b) => /defined terms/.test(b.textContent));
  assert.ok(defJumpBtn, 'expected defined-terms quick-jump button');
  app.click(defJumpBtn);
  await app.tick();
  assert.match(app.hash(), /act_eu_gdpr_2016_0679:art_4$/);
  assert.strictEqual(app.title(), 'Definitions');
});

test('hosted cross-act refs omit .is-external-ref while unhosted EUR-Lex refs carry .is-external-ref', async () => {
  const hosted = new Set((app.registry().acts || []).map((e) => e.authId).filter(Boolean));
  await app.openAct('act_eu_csdr_2014_0909');
  const container = app.doc.getElementById('paragraphsContainer');

  const mifidRef = container.querySelector('a.ref[data-ref="celex:32014L0065"]');
  assert.ok(mifidRef, 'expected hosted MiFID II ref');
  assert.strictEqual(mifidRef.classList.contains('is-external-ref'), false, 'hosted act must not look external');

  const unhostedRef = [...container.querySelectorAll('a.ref[data-ref]')]
    .find((a) => !hosted.has(a.getAttribute('data-ref')));
  assert.ok(unhostedRef, 'expected an unhosted external EUR-Lex ref');
  assert.strictEqual(unhostedRef.classList.contains('is-external-ref'), true, 'unhosted act must be marked external');
});

test('bundle cards display member subtitles and article counts, and article headings in act view are clickable', async () => {
  app.nav('#bundle:bundle_dora_rts');
  await app.tick();

  const firstCard = app.doc.querySelector('.bundle-members a');
  assert.ok(firstCard);
  assert.strictEqual(firstCard.querySelector('.bundle-card-title').textContent, 'RTS 1');
  assert.match(firstCard.querySelector('.bundle-card-subtitle').textContent, /ICT risk management framework/);
  assert.match(firstCard.querySelector('.bundle-card-meta').textContent, /42 art\./);

  // Open DORA Regulation and click an article heading ("Article 3 — Definitions")
  await app.openAct('act_eu_dora_reg_2022_2554');
  const art3Btn = app.doc.querySelector('.act-article-title[data-article-id="art_3"] .act-article-title-link');
  assert.ok(art3Btn);
  assert.match(art3Btn.textContent, /Article 3.*Definitions/);
  app.click(art3Btn);
  await app.tick();
  assert.match(app.hash(), /act_eu_dora_reg_2022_2554:art_3$/);
});

test('search match stepper, Enter/Shift+Enter stepping, and sidebar hit-count badges work', async () => {
  app.nav('#a:act_eu_gdpr_2016_0679:art_5');
  await app.tick();

  const input = app.doc.getElementById('searchInput');
  input.value = 'personal data';
  input.dispatchEvent(new app.window.Event('input', { bubbles: true }));
  await app.tick();

  const stepper = app.doc.getElementById('searchMatchStepper');
  const counter = app.doc.getElementById('searchMatchCount');
  assert.strictEqual(stepper.hidden, false);
  assert.match(counter.textContent, /^1 \/ \d+$/);

  // Sidebar displays match count badges on matching acts and child articles
  const hitBadges = [...app.doc.querySelectorAll('#articleList .list-hit-badge')];
  assert.ok(hitBadges.length > 0, 'expected sidebar hit-count badges while searching');

  // Pressing Enter advances to match 2; Shift+Enter steps back to match 1
  input.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.match(counter.textContent, /^2 \/ \d+$/);

  input.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
  assert.match(counter.textContent, /^1 \/ \d+$/);
});

test('keyboard shortcuts (/ to focus search, [ and ] for article pagination), contextual Prev/Next cards, and copy toast work', async () => {
  app.nav('#a:act_eu_gdpr_2016_0679:art_5');
  await app.tick();

  // Contextual Prev/Next cards show adjacent article titles
  const prevBtn = app.doc.getElementById('prevArticle');
  const nextBtn = app.doc.getElementById('nextArticle');
  assert.match(prevBtn.textContent, /Article 4 · Definitions/);
  assert.match(nextBtn.textContent, /Article 6 · Lawfulness of processing/);

  // ']' advances to Article 6; '[' returns to Article 5
  app.doc.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: ']', bubbles: true, cancelable: true }));
  await app.tick();
  assert.match(app.hash(), /act_eu_gdpr_2016_0679:art_6$/);

  app.doc.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: '[', bubbles: true, cancelable: true }));
  await app.tick();
  assert.match(app.hash(), /act_eu_gdpr_2016_0679:art_5$/);

  // '/' focuses the search input
  app.doc.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }));
  assert.strictEqual(app.doc.activeElement, app.doc.getElementById('searchInput'));
  app.doc.getElementById('searchInput').blur();

  // Copy citation displays a labeled confirmation toast
  const citeBtn = app.doc.querySelector('.paragraph-tool-button[aria-label="Copy citation for this paragraph"]');
  app.click(citeBtn);
  await app.tick();
  const toast = app.doc.getElementById('copyToast');
  assert.strictEqual(toast.hidden, false);
  assert.match(toast.textContent, /Copied citation: GDPR Article 5/);

  // Structural paragraph IDs yield exact legal citations (e.g. GDPR Art. 6(1)(b) -> "paragraph 1 (b)")
  app.nav('#a:act_eu_gdpr_2016_0679:art_6');
  await app.tick();
  const pointBPara = app.doc.getElementById('art_6__1_b');
  assert.ok(pointBPara, 'expected structural paragraph id art_6__1_b');
  assert.ok(pointBPara.querySelector('.list-item-marker'), 'expected hanging list-item-marker span');
  assert.strictEqual(pointBPara.querySelector('.list-item-marker').textContent, '(b)');

  const pointBCiteBtn = pointBPara.querySelector('.paragraph-tool-button[aria-label="Copy citation for this paragraph"]');
  app.click(pointBCiteBtn);
  await app.tick();
  assert.strictEqual(app.clipboard(), 'GDPR Article 6, paragraph 1 (b)');

  // Legacy positional hash (#a:act_eu_gdpr_2016_0679:art_6__7, where no paragraph 7 exists on Art. 6)
  // falls back to highlighting the 7th rendered row of Article 6 (point (f)).
  app.nav('#a:act_eu_gdpr_2016_0679:art_6__7');
  await app.tick();
  const pointFPara = app.doc.getElementById('art_6__1_f');
  assert.ok(pointFPara && pointFPara.classList.contains('is-highlighted'), 'legacy positional hash should highlight matching paragraph');

  // Article ordering is strictly deterministic (sidebar tree order: DORA folder -> ITS 2 last -> AI Act first),
  // never affected by async fetch race timing.
  app.nav('#a:act_eu_ai_act_2024_1689:art_7');
  await app.tick();
  app.click(app.doc.getElementById('prevArticle'));
  await app.tick();
  assert.match(app.hash(), /act_eu_ai_act_2024_1689:art_6$/);

  app.nav('#a:act_eu_ai_act_2024_1689:art_1');
  await app.tick();
  assert.match(app.doc.getElementById('prevArticle').textContent, /ITS 2 — Article 7/);
  app.click(app.doc.getElementById('prevArticle'));
  await app.tick();
  assert.match(app.hash(), /act_eu_dora_its_2024_2956:art_7$/);
});
