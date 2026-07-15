// Runtime (integration) tests for cross-reference resolution.
//
// WHAT THIS COVERS
//   The click/hover behaviour in app.js: an anchor with data-ref="scheme:id"
//   resolves against the registry-derived authToActId map and either jumps
//   in-app (hosted) or lets the EUR-Lex href open (not hosted); same-act
//   anchors (no data-ref) navigate within the current act. This is the only
//   layer that tests the actual browser wiring end-to-end.
//
// HOW IT RUNS
//   Boots the real app.js in jsdom (see jsdom_harness.js) and drives it through
//   the DOM. Run with:  node --test tests/
const { test, before } = require('node:test');
const assert = require('node:assert');
const { bootApp } = require('./jsdom_harness');

let app;
before(async () => { app = await bootApp(); });

test('app loads and populates the sidebar', () => {
  assert.ok(app.doc.querySelector('.article-link'));
});

test('cross-act article ref jumps to the target act + article', async () => {
  await app.openAct('act_eu_dora_rts_2024_1774'); // RTS 1 cites DORA Regulation
  const a = app.doc.querySelector('a.ref[data-ref="celex:32022R2554"][data-article="9"]');
  assert.ok(a, 'expected a cross-act anchor to DORA reg art 9');

  const ev = app.click(a); await app.tick();
  assert.strictEqual(ev.defaultPrevented, true, 'should be intercepted (in-app)');
  assert.match(app.hash(), /act_eu_dora_reg_2022_2554:art_9/);
});

test('cross-act ref to a different hosted act resolves correctly', async () => {
  await app.openAct('act_eu_csdr_2014_0909');
  const m = app.doc.querySelector('a.ref[data-ref="celex:32014L0065"][data-article]');
  assert.ok(m, 'expected CSDR -> MiFID II cross ref');
  const art = m.getAttribute('data-article');
  const ev = app.click(m); await app.tick();
  assert.strictEqual(ev.defaultPrevented, true);
  assert.match(app.hash(), new RegExp(`act_eu_mifid2_2014_0065:art_${art}`));
});

test('non-hosted ref is NOT intercepted (EUR-Lex fallback opens)', async () => {
  const hosted = new Set((app.registry().acts || []).map((e) => e.authId).filter(Boolean));
  await app.openAct('act_eu_dora_reg_2022_2554');
  const ext = [...app.doc.querySelectorAll('a.ref[data-ref]')]
    .find((x) => !hosted.has(x.getAttribute('data-ref')));
  assert.ok(ext, 'expected at least one external ref');
  assert.match(ext.getAttribute('href'), /eur-lex\.europa\.eu.*CELEX:/);

  const ev = app.click(ext); await app.tick();
  assert.strictEqual(ev.defaultPrevented, false, 'external ref must use its href');
});

test('same-act (self) ref navigates within the act', async () => {
  await app.openAct('act_eu_dora_reg_2022_2554');
  const self = app.doc.querySelector('a.ref:not([data-ref])[href^="#a:act_eu_dora_reg_2022_2554:"]');
  assert.ok(self, 'expected a self reference');
  const ev = app.click(self); await app.tick();
  assert.strictEqual(ev.defaultPrevented, true);
  assert.match(app.hash(), /act_eu_dora_reg_2022_2554/);
});
