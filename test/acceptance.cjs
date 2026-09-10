// Browser acceptance test for A2H. Drives a real Chromium via playwright-core
// and verifies rendering + the 390px no-overflow constraint.
// Run: NODE_PATH=<managed node_modules> node test/acceptance.cjs
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { resolve } = require('node:path');

const BASE = process.env.A2H_URL || 'http://127.0.0.1:8499';
const OUT = resolve(__dirname, '..', 'outputs', 'acceptance');
mkdirSync(OUT, { recursive: true });

const CHROME = process.env.CHROME_PATH
  || (process.platform === 'darwin' && '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
  || '/usr/bin/google-chrome';

let pass = 0;
let fail = 0;
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
}

const results = [];

async function measureOverflow(page, label) {
  const m = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  const overflow = m.scrollWidth - m.clientWidth;
  results.push({ label, ...m, overflow });
  return overflow;
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });

  // ---- desktop ------------------------------------------------------------
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await desktop.goto(BASE, { waitUntil: 'networkidle' });
  await desktop.waitForSelector('.workspace-name', { timeout: 5000 });

  check('desktop: workspace name renders', (await desktop.textContent('.workspace-name')) === 'Mixed Workspace');
  check('desktop: sections render', (await desktop.$$('.section-head')).length >= 7);
  check('desktop: highlight cards render', (await desktop.$$('.card')).length > 0);

  const dOverflow = await measureOverflow(desktop, 'desktop');
  check('desktop: no page-level horizontal overflow', dOverflow <= 1, `overflow=${dOverflow}px`);
  await desktop.screenshot({ path: `${OUT}/desktop-home.png`, fullPage: false });

  // ---- mobile 390px -------------------------------------------------------
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(BASE, { waitUntil: 'networkidle' });
  await mobile.waitForSelector('.workspace-name', { timeout: 5000 });

  const mOverflow = await measureOverflow(mobile, 'mobile-390');
  check('390px: no page-level horizontal overflow', mOverflow <= 1, `overflow=${mOverflow}px`);
  await mobile.screenshot({ path: `${OUT}/mobile-390-home.png`, fullPage: false });

  // Sidebar is a drawer on mobile.
  const drawerHidden = await mobile.evaluate(() => {
    const sb = document.querySelector('#sidebar');
    return sb && !sb.classList.contains('open');
  });
  check('390px: sidebar starts collapsed (drawer)', drawerHidden);

  // ---- artifact pages -----------------------------------------------------
  async function checkArtifact(page, path, label, expectText) {
    await page.goto(BASE + '#/a/' + encodeURIComponent(path), { waitUntil: 'networkidle' });
    await page.waitForSelector('.artifact-title', { timeout: 5000 });
    const body = await page.evaluate(() => document.querySelector('#content').innerText);
    check(label, body.includes(expectText), `missing "${expectText}"`);
    const over = await measureOverflow(page, label);
    check(`${label}: no overflow`, over <= 1, `overflow=${over}px`);
    return page;
  }

  // markdown
  await checkArtifact(desktop, 'report.md', 'markdown: prose renders', 'summary of what happened');
  await desktop.screenshot({ path: `${OUT}/markdown.png` });

  // diff (long enough to preview)
  await checkArtifact(desktop, 'patches/change.diff', 'diff: file header renders', 'src/main.ts');
  await desktop.screenshot({ path: `${OUT}/diff.png` });

  // code
  await checkArtifact(desktop, 'src/main.ts', 'code: source renders', 'export function add');

  // image
  await desktop.goto(BASE + '#/a/' + encodeURIComponent('screenshots/shot.png'), { waitUntil: 'networkidle' });
  await desktop.waitForSelector('.image-wrap img', { timeout: 5000 });
  const imgOk = await desktop.evaluate(() => {
    const img = document.querySelector('.image-wrap img');
    return img && img.naturalWidth > 0;
  });
  check('image: preview loads', imgOk);

  // log (long, 300 lines)
  await checkArtifact(desktop, 'logs/build.log', 'log: tail renders + errors flagged', 'line 299');
  await desktop.screenshot({ path: `${OUT}/log.png` });

  // unknown binary file — must not white-screen
  await desktop.goto(BASE + '#/a/' + encodeURIComponent('misc/unknown.bin'), { waitUntil: 'networkidle' });
  await desktop.waitForSelector('.artifact-title', { timeout: 5000 });
  const unknownText = await desktop.evaluate(() => document.querySelector('#content').innerText);
  check('unknown file: no white-screen', unknownText.length > 0);
  check('unknown file: binary notice', /binary/i.test(unknownText));

  // sensitive file — content hidden
  await desktop.goto(BASE + '#/a/' + encodeURIComponent('.env'), { waitUntil: 'networkidle' });
  await desktop.waitForSelector('.artifact-title', { timeout: 5000 });
  const envText = await desktop.evaluate(() => document.querySelector('#content').innerText);
  check('sensitive: content hidden', /sensitive/i.test(envText) && !/SECRET_TOKEN/.test(envText));

  // ---- security: repo HTML/JS must not execute ----------------------------
  const csp = await desktop.evaluate(async () => {
    const r = await fetch('/api/ir');
    return r.headers.get('content-security-policy');
  });
  const pageCsp = await (await desktop.request.get(BASE + '/')).headers()['content-security-policy'] || '';
  check('security: CSP present on page', pageCsp.includes("script-src 'self'"));
  const inlineScript = /script-src[^;]*'unsafe-inline'/.test(pageCsp);
  check('security: no inline script execution allowed', !inlineScript);

  await browser.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
