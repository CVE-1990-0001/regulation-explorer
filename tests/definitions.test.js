// Runtime integration tests for defined-term tooltips.
const { test, before } = require('node:test');
const assert = require('node:assert');
const { bootApp } = require('./jsdom_harness');

let app;
before(async () => { app = await bootApp(); });

const hover = (el) => {
  const ev = new app.window.MouseEvent('mouseover', { bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  return ev;
};

test('wraps every occurrence of defined terms outside the Definitions article and shows tooltip on hover', async () => {
  app.nav('#a:act_eu_gdpr_2016_0679:art_5');
  await app.tick();

  const container = app.doc.getElementById('paragraphsContainer');
  const terms = [...container.querySelectorAll('.defined-term')];
  const personalDataSpans = terms.filter((el) => el.textContent.toLowerCase() === 'personal data');

  // Article 5 of GDPR uses "personal data" multiple times; every occurrence must be wrapped.
  assert.ok(personalDataSpans.length >= 2, `expected multiple 'personal data' spans, got ${personalDataSpans.length}`);

  // Hovering displays the tooltip with term, source, and definition; clicking does not navigate.
  const hashBefore = app.hash();
  hover(personalDataSpans[0]);
  const tooltip = app.doc.querySelector('.legal-tooltip');
  assert.ok(tooltip && tooltip.classList.contains('is-visible'), 'tooltip should become visible on hover');
  assert.strictEqual(tooltip.querySelector('.legal-tooltip-term').textContent, 'personal data');
  assert.strictEqual(tooltip.querySelector('.legal-tooltip-source').textContent, 'Article 4(1)');
  assert.match(tooltip.querySelector('.legal-tooltip-body').textContent, /identified or identifiable natural person/);

  app.click(personalDataSpans[0]);
  await app.tick();
  assert.strictEqual(app.hash(), hashBefore, 'clicking a defined term must not navigate');
});

test('does not wrap defined terms inside the Definitions article itself (article view and act view)', async () => {
  // Single-article view of DORA Article 3 (Definitions)
  app.nav('#a:act_eu_dora_reg_2022_2554:art_3');
  await app.tick();
  const container = app.doc.getElementById('paragraphsContainer');
  assert.strictEqual(
    container.querySelectorAll('.defined-term').length,
    0,
    'Definitions article itself must not contain .defined-term wrappers',
  );

  // Full-act view of BSI C3A: section 1.5 paragraphs stay unwrapped while criterion sections get wrapped
  app.nav('#act:act_de_bsi_c3a_2026');
  await app.tick();
  const defPara = app.doc.getElementById('art_1_5__2');
  assert.ok(defPara, 'expected BSI C3A 1.5 definition paragraph');
  assert.strictEqual(defPara.querySelectorAll('.defined-term').length, 0);

  const otherTerms = [...container.querySelectorAll('.defined-term')];
  assert.ok(otherTerms.length > 0, 'expected defined terms in non-definition sections of BSI C3A');
});

test('does nothing on regulations without a definitions chapter', async () => {
  await app.openAct('act_eu_dora_rts_2024_1774'); // DORA RTS 1 has no Definitions article
  const container = app.doc.getElementById('paragraphsContainer');
  assert.strictEqual(container.querySelectorAll('.defined-term').length, 0);
});

test('never wraps inside a.ref links and keeps copied paragraph text clean', async () => {
  await app.openAct('act_eu_dora_reg_2022_2554');
  const container = app.doc.getElementById('paragraphsContainer');

  assert.strictEqual(
    container.querySelectorAll('a .defined-term').length,
    0,
    'must never inject .defined-term inside anchor links',
  );
  assert.strictEqual(
    container.querySelectorAll('.paragraph-tools .defined-term').length,
    0,
    'must never inject .defined-term inside paragraph tools',
  );

  // Copy paragraph text on a paragraph containing defined terms must remain verbatim.
  const paraWithTerm = [...container.querySelectorAll('.article-paragraph')]
    .find((p) => p.querySelector('.defined-term') && p.querySelector('.paragraph-tool-button'));
  assert.ok(paraWithTerm, 'expected a paragraph with both a defined term and copy tools');
  const copyTextBtn = paraWithTerm.querySelector(
    '.paragraph-tool-button[aria-label="Copy paragraph text to clipboard"]',
  );
  app.click(copyTextBtn);
  await app.tick();
  assert.ok(app.clipboard().length > 20);
  assert.doesNotMatch(app.clipboard(), /defined-term|Article 3\(/);
});

test('prefers longest defined term and coexists with live search highlighting', async () => {
  app.nav('#a:act_eu_dora_reg_2022_2554:art_28');
  await app.tick();

  const container = app.doc.getElementById('paragraphsContainer');
  const providerSpan = [...container.querySelectorAll('.defined-term')]
    .find((el) => /ICT third-party service providers?/i.test(el.textContent));
  assert.ok(providerSpan, 'expected full multi-word term to match rather than just ICT');

  const input = app.doc.getElementById('searchInput');
  input.value = 'third-party';
  input.dispatchEvent(new app.window.Event('input', { bubbles: true }));
  await app.tick();

  const activeContainer = app.doc.getElementById('paragraphsContainer');
  assert.ok(activeContainer.querySelector('.defined-term mark.search-hit'), 'search mark should render inside defined-term');

  // Test search + clear on a top-level act (GDPR Art. 5) so clearing search stays on the article.
  input.value = '';
  input.dispatchEvent(new app.window.Event('input', { bubbles: true }));
  await app.tick();

  app.nav('#a:act_eu_gdpr_2016_0679:art_5');
  await app.tick();
  input.value = 'personal';
  input.dispatchEvent(new app.window.Event('input', { bubbles: true }));
  await app.tick();
  assert.ok(activeContainer.querySelector('.defined-term mark.search-hit'));

  input.value = '';
  input.dispatchEvent(new app.window.Event('input', { bubbles: true }));
  await app.tick();
  assert.strictEqual(activeContainer.querySelectorAll('mark.search-hit').length, 0);
  assert.ok(activeContainer.querySelectorAll('.defined-term').length > 0);
});

test('cross-act pointer definitions show resolved definition, interactive ref links, and clickable source badge', async () => {
  // CSDR Article 3 mentions "financial instruments" and "central counterparty"/"CSD"
  // and CSDR Article 2(16) defines CCP by delegating to EMIR Article 2(1).
  app.nav('#a:act_eu_dora_reg_2022_2554:art_2');
  await app.tick();

  const container = app.doc.getElementById('paragraphsContainer');
  const ccpSpan = [...container.querySelectorAll('.defined-term')]
    .find((el) => /central counterpart(?:y|ies)/i.test(el.textContent));
  assert.ok(ccpSpan, 'expected "central counterparties" defined-term in DORA Article 2');

  hover(ccpSpan);
  const tooltip = app.doc.querySelector('.legal-tooltip');
  assert.ok(tooltip.classList.contains('is-visible'));

  // 1. Resolved EMIR definition block is displayed inline
  const resolved = tooltip.querySelector('.legal-tooltip-resolved');
  assert.ok(resolved, 'expected auto-resolved cross-act definition block');
  assert.match(resolved.querySelector('.is-resolved-source').textContent, /EMIR · Article 2\(1\)/);
  assert.match(resolved.querySelector('.legal-tooltip-resolved-body').textContent, /interposes itself between the counterparties/);

  // 2. Reference links inside the tooltip body are clickable and jump in-app
  const bodyRef = tooltip.querySelector('.legal-tooltip-body a.ref[data-ref="celex:32012R0648"]');
  assert.ok(bodyRef, 'expected interactive <a class="ref"> inside tooltip body');
  const clickEv = app.click(bodyRef);
  await app.tick();
  assert.strictEqual(clickEv.defaultPrevented, true, 'hosted cross-act link inside tooltip should navigate in-app');
  assert.match(app.hash(), /act_eu_emir_2012_0648/);
  assert.strictEqual(tooltip.classList.contains('is-visible'), false, 'tooltip hides after navigating');

  // 3. Clicking the top-right source badge jumps to the current act's definition
  app.nav('#a:act_eu_gdpr_2016_0679:art_5');
  await app.tick();
  const gdprTerm = app.doc.querySelector('#paragraphsContainer .defined-term');
  hover(gdprTerm);
  const sourceBadge = tooltip.querySelector('a.legal-tooltip-source');
  assert.ok(sourceBadge, 'expected clickable source badge');
  const badgeEv = app.click(sourceBadge);
  await app.tick();
  assert.strictEqual(badgeEv.defaultPrevented, true);
  assert.match(app.hash(), /act_eu_gdpr_2016_0679:art_4/);
});

