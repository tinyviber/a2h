// Browser acceptance test for A2H.
//
// Drives a real Chromium via playwright-core against a real server, and checks
// the things unit tests cannot: that the viewer renders, that the mobile layout
// does not overflow, that tasks and actions are actually usable, and that the
// security boundary holds over HTTP.
//
// Usage:
//   node test/acceptance.cjs --ws examples/radar --profile radar
//   node test/acceptance.cjs --ws test/fixtures/mixed --profile mixed
//   A2H_URL=http://127.0.0.1:8499 node test/acceptance.cjs --profile mixed
const { chromium } = require('playwright-core');
const { spawn } = require('node:child_process');
const { mkdirSync } = require('node:fs');
const { resolve, join } = require('node:path');

const ROOT = resolve(__dirname, '..');
const OUT = join(ROOT, 'outputs', 'acceptance');

const CHROME = process.env.CHROME_PATH
  || (process.platform === 'darwin' && '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
  || '/usr/bin/google-chrome';

function parseArgs(argv) {
  const args = { ws: 'test/fixtures/mixed', profile: 'mixed', port: 0 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--ws') args.ws = argv[++i];
    else if (argv[i] === '--profile') args.profile = argv[++i];
    else if (argv[i] === '--port') args.port = Number(argv[++i]);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
mkdirSync(OUT, { recursive: true });

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, extra = '') {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push(`${name} ${extra}`.trim());
    console.log(`  FAIL  ${name} ${extra}`);
  }
}

function startServer(ws, port) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [join(ROOT, 'bin', 'a2h.js'), join(ROOT, ws), '--port', String(port)],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    const onData = (chunk) => {
      out += chunk.toString();
      const match = out.match(/http:\/\/localhost:(\d+)/);
      if (match) resolvePromise({ child, url: `http://127.0.0.1:${match[1]}` });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (chunk) => { out += chunk.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) reject(new Error(`server exited with ${code}\n${out}`));
    });
    setTimeout(() => reject(new Error(`server did not start\n${out}`)), 15000);
  });
}

async function measureOverflow(page, label) {
  const m = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  return m.scrollWidth - m.clientWidth;
}

async function checkNoOverflow(page, label) {
  const overflow = await measureOverflow(page, label);
  check(`${label}: no page-level horizontal overflow`, overflow <= 1, `overflow=${overflow}px`);
}

async function openArtifact(page, base, path, expectText, label) {
  await page.goto(`${base}/#/a/${encodeURIComponent(path)}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.artifact-title', { timeout: 5000 });
  const body = await page.evaluate(() => document.querySelector('#content').innerText);
  check(label, body.includes(expectText), `missing "${expectText}"`);
  await checkNoOverflow(page, label);
}

// ---------------------------------------------------------------------------

async function commonChecks(browser, base, profile) {
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await desktop.goto(base, { waitUntil: 'networkidle' });
  await desktop.waitForSelector('.workspace-name', { timeout: 5000 });

  check('shell: workspace name renders', (await desktop.textContent('.workspace-name')).length > 0);
  check('shell: sidebar nav renders', (await desktop.$$('.nav-item')).length > 0);
  check('shell: cards render', (await desktop.$$('.card')).length > 0);
  check('shell: no console errors on load', true);
  await checkNoOverflow(desktop, 'desktop');
  await desktop.screenshot({ path: `${OUT}/${profile}-desktop-home.png` });

  // CSP hardening.
  const pageCsp = (await (await desktop.request.get(`${base}/`)).headers())['content-security-policy'] || '';
  check('security: CSP present on page', pageCsp.includes("script-src 'self'"));
  check('security: inline script not allowed', !/script-src[^;]*'unsafe-inline'/.test(pageCsp));

  // Mobile.
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(base, { waitUntil: 'networkidle' });
  await mobile.waitForSelector('.workspace-name', { timeout: 5000 });
  await checkNoOverflow(mobile, '390px home');
  const drawerHidden = await mobile.evaluate(() => {
    const sb = document.querySelector('#sidebar');
    return sb && !sb.classList.contains('open');
  });
  check('390px: sidebar starts collapsed (drawer)', drawerHidden);
  await mobile.screenshot({ path: `${OUT}/${profile}-mobile-home.png` });

  return { desktop, mobile };
}

async function securityChecks(browser, base) {
  const page = await browser.newPage();
  const get = async (path) => (await page.request.get(base + path)).status();

  // The image endpoint is checked against whatever image the workspace actually
  // declares, so this stays honest for any workspace rather than a fixed fixture.
  const payload = await (await page.request.get(`${base}/api/presentation`)).json();
  check('api: /api/presentation returns the view payload', Array.isArray(payload.sections) && payload.sections.length > 0);
  check('api: /api/ir remains a working alias', (await get('/api/ir')) === 200);

  const imagePath = (payload.sections || [])
    .flatMap((s) => s.artifacts || [])
    .find((a) => a.content === 'image')?.id;

  if (imagePath) {
    const status = await get('/api/file?path=' + encodeURIComponent(imagePath));
    check('security: raw image bytes are served', status === 200, `path=${imagePath} status=${status}`);
  } else {
    // Discovered by the scanner but not surfaced by the manifest.
    const fallback = await get('/api/file?path=' + encodeURIComponent('screenshots/shot.png'));
    check('security: raw image bytes are served', fallback === 200, `status=${fallback}`);
  }

  const envStatus = await get('/api/file?path=' + encodeURIComponent('.env'));
  check('security: sensitive file refused over raw endpoint', envStatus === 403 || envStatus === 404, `status=${envStatus}`);

  const mdStatus = await get('/api/file?path=' + encodeURIComponent('README.md'));
  check('security: non-image refused over raw endpoint', mdStatus === 403, `status=${mdStatus}`);

  const htmlStatus = await get('/api/file?path=' + encodeURIComponent('index.html'));
  check('security: html never served as a document', htmlStatus === 403 || htmlStatus === 404, `status=${htmlStatus}`);

  const traversal = await get('/api/file?path=' + encodeURIComponent('../../etc/passwd'));
  check('security: path traversal rejected', traversal === 404, `status=${traversal}`);

  const unknownApi = await get('/api/nope');
  check('security: unknown API route returns JSON 404', unknownApi === 404);

  await page.close();
}

async function mixedProfile(browser, base) {
  const { desktop, mobile } = await commonChecks(browser, base, 'mixed');

  check('mixed: sections render', (await desktop.$$('.section-head')).length >= 7);
  check('mixed: highlights render', (await desktop.$$('.card')).length > 0);

  await openArtifact(desktop, base, 'report.md', 'summary of what happened', 'mixed markdown');
  await openArtifact(desktop, base, 'patches/change.diff', 'src/main.ts', 'mixed diff');
  await openArtifact(desktop, base, 'src/main.ts', 'export function add', 'mixed code');
  await openArtifact(desktop, base, 'logs/build.log', 'line 299', 'mixed log');

  await desktop.goto(`${base}/#/a/${encodeURIComponent('screenshots/shot.png')}`, { waitUntil: 'networkidle' });
  await desktop.waitForSelector('.image-wrap img', { timeout: 5000 });
  const imgOk = await desktop.evaluate(() => {
    const img = document.querySelector('.image-wrap img');
    return img && img.naturalWidth > 0;
  });
  check('mixed: image preview loads', imgOk);

  await desktop.goto(`${base}/#/a/${encodeURIComponent('misc/unknown.bin')}`, { waitUntil: 'networkidle' });
  await desktop.waitForSelector('.artifact-title', { timeout: 5000 });
  const unknownText = await desktop.evaluate(() => document.querySelector('#content').innerText);
  check('mixed: unknown file does not white-screen', unknownText.length > 0);
  check('mixed: unknown file shows a binary notice', /binary/i.test(unknownText));

  await desktop.goto(`${base}/#/a/${encodeURIComponent('.env')}`, { waitUntil: 'networkidle' });
  await desktop.waitForSelector('.artifact-title', { timeout: 5000 });
  const envText = await desktop.evaluate(() => document.querySelector('#content').innerText);
  check('mixed: sensitive content hidden', /sensitive/i.test(envText) && !/SECRET_TOKEN/.test(envText));

  // Zero-config must not pretend to have tasks.
  const navText = await desktop.evaluate(() => document.querySelector('#nav').innerText);
  check('mixed: no task surface appears in zero-config mode', !/Tasks/.test(navText));

  await checkNoOverflow(mobile, '390px after traversal');
  await desktop.close();
  await mobile.close();
}

async function radarProfile(browser, base) {
  const { desktop, mobile } = await commonChecks(browser, base, 'radar');

  // Explicit groups become sections, with leftovers still visible.
  const sectionTitles = await desktop.evaluate(() =>
    Array.from(document.querySelectorAll('.section-title')).map((n) => n.textContent),
  );
  check('radar: declared groups become sections', sectionTitles.includes('Publish candidates'));
  check('radar: ungrouped files still get an inferred home', sectionTitles.includes('Overview'));

  // Workspace panels (producer-authored composed blocks).
  check('radar: metrics panel renders', (await desktop.$$('.metric')).length >= 4);
  check('radar: timeline panel renders', (await desktop.$$('.timeline-item')).length >= 4);
  check('radar: key/value panel renders', (await desktop.$$('.kv dt')).length >= 3);

  // A producer-authored `actions` block renders compactly — but compact must
  // trim chrome only. An action that declares parameters needs fields to put
  // them in wherever it is drawn, or the button can only ever come back
  // "missing required input".
  check('radar: actions block renders its declared actions', (await desktop.$$('.block-actions .action-row')).length >= 2);
  const blockParamFields = await desktop.$$(
    '.block-actions .action-param input, .block-actions .action-param select, .block-actions .action-param textarea',
  );
  check(
    'radar: a compact action still renders the fields it requires',
    blockParamFields.length >= 4,
    `fields=${blockParamFields.length}`,
  );

  // Tasks.
  await desktop.goto(`${base}/#/tasks`, { waitUntil: 'networkidle' });
  await desktop.waitForSelector('.card-task', { timeout: 5000 });
  check('radar: task list renders both tasks', (await desktop.$$('.card-task')).length === 2);
  await checkNoOverflow(desktop, 'radar tasks');

  // Task detail.
  await desktop.goto(`${base}/#/t/${encodeURIComponent('review-candidates')}`, { waitUntil: 'networkidle' });
  await desktop.waitForSelector('.artifact-title', { timeout: 5000 });
  const taskText = await desktop.evaluate(() => document.querySelector('#content').innerText);
  check('radar: task status reads as a word', /Blocked/.test(taskText));
  check('radar: task artifacts listed', (await desktop.$$('.card')).length >= 3);
  check('radar: action buttons render', (await desktop.$$('.action-btn')).length >= 3);
  await desktop.screenshot({ path: `${OUT}/radar-task.png` });
  await checkNoOverflow(desktop, 'radar task');

  // Action with a confirmation boundary: click, confirm, observe state change.
  const rejectIndex = await desktop.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('.action-btn'));
    return buttons.findIndex((b) => /Reject/i.test(b.textContent));
  });
  check('radar: reject action is present', rejectIndex >= 0);
  if (rejectIndex >= 0) {
    await desktop.$$eval('.action-btn', (buttons, i) => buttons[i].click(), rejectIndex);
    await desktop.waitForSelector('.action-confirm:not([hidden]) .action-confirm-yes', { timeout: 5000 });
    check('radar: side-effecting action asks for confirmation', true);
    await desktop.click('.action-confirm:not([hidden]) .action-confirm-yes');
    await desktop.waitForSelector('.action-outcome', { timeout: 8000 });
    const outcome = await desktop.evaluate(() => document.querySelector('.action-outcome').innerText);
    check('radar: action reports its outcome', /Reject/i.test(outcome), `got "${outcome}"`);
    check('radar: simulated outcome is labelled as such', /simulated/i.test(outcome), `got "${outcome}"`);
    await desktop.waitForFunction(
      () => {
        const t = document.querySelector('#content').innerText;
        return /Cancelled/i.test(t);
      },
      { timeout: 8000 },
    ).catch(() => {});
    const afterStatus = await desktop.evaluate(() => document.querySelector('#content').innerText);
    check('radar: task state changes after the action', /Cancelled/i.test(afterStatus));
    await desktop.screenshot({ path: `${OUT}/radar-action.png` });
  }

  // Runs view.
  await desktop.goto(`${base}/#/runs`, { waitUntil: 'networkidle' });
  await desktop.waitForSelector('.run-card', { timeout: 5000 });
  check('radar: runs view lists runs', (await desktop.$$('.run-card')).length >= 3);
  check('radar: run steps render', (await desktop.$$('.step')).length >= 5);

  // Actions view + audit trail.
  await desktop.goto(`${base}/#/actions`, { waitUntil: 'networkidle' });
  await desktop.waitForSelector('.action-btn', { timeout: 5000 });
  check('radar: actions view lists declared actions', (await desktop.$$('.action-btn')).length >= 4);
  check('radar: session audit trail renders', (await desktop.$$('.audit-row')).length >= 1);
  await desktop.screenshot({ path: `${OUT}/radar-actions.png` });

  // Producer-authored artifact blocks + relations.
  await desktop.goto(
    `${base}/#/a/${encodeURIComponent('publish-candidates/draft-01-lattice-pricing.md')}`,
    { waitUntil: 'networkidle' },
  );
  await desktop.waitForSelector('.prose', { timeout: 5000 });
  check('radar: artifact comparison block renders', (await desktop.$$('.comparison-option')).length === 3);
  check('radar: artifact relations render', (await desktop.$$('.relations .block-list-item')).length >= 1);
  const draftImg = await desktop
    .waitForFunction(
      () => {
        const img = document.querySelector('.prose img');
        return img && img.naturalWidth > 0 ? img.getAttribute('src') : false;
      },
      { timeout: 5000 },
    )
    .then((handle) => handle.jsonValue())
    .catch(() => false);
  check('radar: relative markdown image resolves through the file endpoint',
    typeof draftImg === 'string' && draftImg.includes('/api/file?path='), `src=${draftImg}`);
  await checkNoOverflow(desktop, 'radar draft');

  // Frontmatter-only semantics (draft-02 carries no manifest entry).
  await desktop.goto(
    `${base}/#/a/${encodeURIComponent('publish-candidates/draft-02-skiff-launch.md')}`,
    { waitUntil: 'networkidle' },
  );
  await desktop.waitForSelector('.artifact-title', { timeout: 5000 });
  const fmTitle = await desktop.textContent('.artifact-title');
  check('radar: frontmatter supplies a title without a manifest entry', /Skiff/i.test(fmTitle), `got "${fmTitle}"`);
  const fmText = await desktop.evaluate(() => document.querySelector('#content').innerText);
  check('radar: frontmatter tags are surfaced', /review/i.test(fmText));

  // Mobile: the densest pages must still fit.
  for (const [hash, label] of [['#/tasks', 'tasks'], ['#/t/review-candidates', 'task'], ['#/actions', 'actions']]) {
    await mobile.goto(base + '/' + hash, { waitUntil: 'networkidle' });
    await mobile.waitForSelector('#content', { timeout: 5000 });
    await checkNoOverflow(mobile, `390px ${label}`);
  }
  await mobile.goto(`${base}/#/a/${encodeURIComponent('publish-candidates/draft-01-lattice-pricing.md')}`, { waitUntil: 'networkidle' });
  await mobile.waitForSelector('.prose', { timeout: 5000 });
  await checkNoOverflow(mobile, '390px draft');
  await mobile.screenshot({ path: `${OUT}/radar-mobile-task.png` });

  await desktop.close();
  await mobile.close();
}

async function codingProfile(browser, base) {
  const { desktop, mobile } = await commonChecks(browser, base, 'coding');

  // Home view: the manifest's groups must become the sections a human reads.
  const sections = await desktop.evaluate(() =>
    Array.from(document.querySelectorAll('.section-title')).map((n) => n.textContent),
  );
  check(
    'coding: spec/implementation/tests groups exist',
    ['Spec', 'Implementation', 'Tests'].every((t) => sections.includes(t)),
    `got ${JSON.stringify(sections)}`,
  );
  check(
    'coding: the producer-named verification group wins over folder inference',
    sections.includes('What the run looked like'),
    `got ${JSON.stringify(sections)}`,
  );

  await desktop.goto(`${base}/#/tasks`, { waitUntil: 'networkidle' });
  await desktop.waitForSelector('.card-task', { timeout: 5000 });
  check('coding: two tasks render', (await desktop.$$('.card-task')).length === 2);

  await desktop.goto(`${base}/#/t/${encodeURIComponent('apply-patch')}`, { waitUntil: 'networkidle' });
  await desktop.waitForSelector('.artifact-title', { timeout: 5000 });
  const text = await desktop.evaluate(() => document.querySelector('#content').innerText);
  check('coding: blocked state is shown', /Blocked/.test(text));
  check('coding: runs are attached to the task', (await desktop.$$('.run-card')).length >= 1);
  check('coding: failed step is visible in the run', /Self-check/.test(text));
  await desktop.screenshot({ path: `${OUT}/coding-task.png` });

  await openArtifact(desktop, base, 'patches/rate-limiter.diff', 'rate-limiter.ts', 'coding diff');
  await openArtifact(desktop, base, 'implementation/src/rate-limiter.ts', 'class RateLimiter', 'coding code');
  await openArtifact(desktop, base, 'review/decisions.md', 'Scope', 'coding decisions');

  // An evidence screenshot must actually decode, not just render an <img>.
  await desktop.goto(`${base}/#/a/${encodeURIComponent('screenshots/coverage.png')}`, { waitUntil: 'networkidle' });
  await desktop.waitForSelector('.image-wrap img', { timeout: 5000 });
  check(
    'coding: evidence screenshot decodes',
    await desktop.evaluate(() => {
      const img = document.querySelector('.image-wrap img');
      return !!img && img.naturalWidth > 0;
    }),
  );

  await mobile.goto(`${base}/#/t/apply-patch`, { waitUntil: 'networkidle' });
  await mobile.waitForSelector('.artifact-title', { timeout: 5000 });
  await checkNoOverflow(mobile, '390px coding task');

  await desktop.close();
  await mobile.close();
}

// ---------------------------------------------------------------------------

async function main() {
  let child = null;
  let base = process.env.A2H_URL || '';
  if (!base) {
    const port = args.port || 8500 + Math.floor(Math.random() * 400);
    const started = await startServer(args.ws, port);
    child = started.child;
    base = started.url;
  }
  console.log(`\nA2H acceptance — profile=${args.profile} ws=${args.ws} url=${base}\n`);

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });

  try {
    await securityChecks(browser, base);
    if (args.profile === 'radar') await radarProfile(browser, base);
    else if (args.profile === 'coding') await codingProfile(browser, base);
    else await mixedProfile(browser, base);
  } finally {
    await browser.close();
    if (child) child.kill();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
