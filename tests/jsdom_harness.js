// Shared harness that boots the static app (index.html + app.js) inside jsdom
// with a fetch shim that serves the workspace files, so runtime behaviour can be
// tested headlessly. app.js is not modular (module-scoped, no exports), so we
// exercise it *through the DOM* rather than importing functions.
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.dirname(__dirname); // repo root (tests/ is one level down)
const read = (p) => fs.readFileSync(path.join(ROOT, String(p).replace(/^\.?\//, '')), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bootApp() {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/scrollIntoView/.test(e.message)) console.error('JSDOM', e.message); });

  const dom = new JSDOM(read('index.html'), {
    runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc, url: 'http://localhost/',
  });
  const { window } = dom;
  let clipboardText = '';

  window.fetch = async (url) => {
    const rel = String(url).replace(/^https?:\/\/[^/]+\//, '').split('?')[0];
    const body = read(rel);
    return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body };
  };
  Object.defineProperty(window.navigator, 'clipboard', {
    value: {
      writeText: async (value) => {
        clipboardText = value;
      },
    },
  });
  window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = function () {}; // jsdom lacks it; let nav finish

  window.eval(read('app.js'));
  window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));

  // wait until the sidebar is populated (data loaded)
  for (let i = 0; i < 80; i++) { await sleep(60); if (window.document.querySelector('.article-link')) break; }

  const doc = window.document;
  const helpers = {
    doc,
    hash: () => window.location.hash,
    title: () => (doc.getElementById('articleTitle').textContent || '').trim(),
    nav: (h) => { window.location.hash = h; window.dispatchEvent(new window.Event('hashchange')); },
    async openAct(id) {
      helpers.nav(`#act:${id}`);
      for (let i = 0; i < 50; i++) { await sleep(50); if (doc.querySelector('a.ref')) break; }
    },
    click: (a) => { const e = new window.MouseEvent('click', { bubbles: true, cancelable: true }); a.dispatchEvent(e); return e; },
    tick: () => sleep(200),
    clipboard: () => clipboardText,
    registry: () => JSON.parse(read('data/index.json')),
  };
  return { window, ...helpers };
}

module.exports = { bootApp, read };
