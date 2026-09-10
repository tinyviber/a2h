// Renders the verification screenshots used by examples/coding-task.
//
// These are real renders, not placeholder gradients: a coding-agent task should
// show what the agent actually looked at — the test run and the coverage report.
// Regenerate with:  node scripts/make-example-screenshots.mjs
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'examples', 'coding-task', 'screenshots');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

mkdirSync(OUT, { recursive: true });

const PALETTE = {
  paper: '#FAF8F4',
  ink: '#1A1916',
  muted: '#6E6A61',
  line: '#E4DFD5',
  good: '#3F6B4A',
  warn: '#8A6A2F',
};

function page(body, extraCss = '') {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    background: ${PALETTE.paper}; color: ${PALETTE.ink};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    padding: 28px 32px; font-size: 15px; line-height: 1.55;
  }
  .win { border: 1px solid ${PALETTE.line}; border-radius: 10px; overflow: hidden; background: #fff; }
  .bar {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 14px; background: #F2EEE6; border-bottom: 1px solid ${PALETTE.line};
  }
  .dot { width: 11px; height: 11px; border-radius: 50%; background: #D8D2C6; }
  .title { margin-left: 8px; font-size: 13px; color: ${PALETTE.muted}; letter-spacing: 0.01em; }
  pre {
    margin: 0; padding: 20px 22px; font-size: 13.5px; line-height: 1.7;
    font-family: "SF Mono", ui-monospace, Menlo, monospace; white-space: pre;
  }
  .g { color: ${PALETTE.good}; font-weight: 600; }
  .m { color: ${PALETTE.muted}; }
  .w { color: ${PALETTE.warn}; }
  ${extraCss}
  </style></head><body>${body}</body></html>`;
}

const testRun = page(`
<div class="win">
  <div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span>
    <span class="title">npx vitest run src/rate-limiter.test.ts — feat/rate-limiter</span></div>
<pre><span class="m">$</span> npx vitest run src/rate-limiter.test.ts

 <span class="m">RUN</span>  v2.1.9 <span class="m">/workspace</span>

 <span class="g">✓</span> src/rate-limiter.test.ts <span class="m">(9 tests) 6ms</span>
   <span class="g">✓</span> allows a burst up to capacity
   <span class="g">✓</span> rejects the request past capacity
   <span class="g">✓</span> refills proportionally to elapsed time
   <span class="g">✓</span> never refills past capacity after a long idle
   <span class="g">✓</span> isolates buckets per caller id
   <span class="g">✓</span> treats a missing caller id as a single anonymous bucket
   <span class="g">✓</span> reports retryAfterMs rounded up to the next second
   <span class="g">✓</span> tolerates a clock that moves backwards
   <span class="g">✓</span> does not allocate a timer per key

 <span class="m">Test Files</span>  <span class="g">1 passed</span> (1)
      <span class="m">Tests</span>  <span class="g">9 passed</span> (9)
   <span class="m">Duration</span>  412ms
</pre>
</div>`);

const coverage = page(
  `
<div class="win">
  <div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span>
    <span class="title">coverage — src/rate-limiter.ts</span></div>
  <div style="padding: 18px 22px 4px;">
    <table style="width:100%; border-collapse: collapse; font-size: 14px;">
      <thead>
        <tr style="text-align:left; color:${PALETTE.muted}; font-size:12px; text-transform:uppercase; letter-spacing:0.06em;">
          <th style="padding:0 0 8px; font-weight:600;">File</th>
          <th style="padding:0 0 8px; font-weight:600; text-align:right;">Statements</th>
          <th style="padding:0 0 8px; font-weight:600; text-align:right;">Branches</th>
          <th style="padding:0 0 8px; font-weight:600; text-align:right;">Functions</th>
        </tr>
      </thead>
      <tbody>
        <tr style="border-top:1px solid ${PALETTE.line};">
          <td style="padding:9px 0;"><code style="font-family:'SF Mono',ui-monospace,Menlo,monospace; font-size:13px;">rate-limiter.ts</code></td>
          <td style="padding:9px 0; text-align:right;"><span class="g">96.4%</span></td>
          <td style="padding:9px 0; text-align:right;"><span class="g">91.7%</span></td>
          <td style="padding:9px 0; text-align:right;"><span class="g">100%</span></td>
        </tr>
        <tr style="border-top:1px solid ${PALETTE.line};">
          <td style="padding:9px 0;"><code style="font-family:'SF Mono',ui-monospace,Menlo,monospace; font-size:13px;">http/middleware.ts</code>
            <span style="color:${PALETTE.warn}; font-size:12px;"> ◂ not in spec</span></td>
          <td style="padding:9px 0; text-align:right;"><span class="w">0%</span></td>
          <td style="padding:9px 0; text-align:right;"><span class="w">0%</span></td>
          <td style="padding:9px 0; text-align:right;"><span class="w">0%</span></td>
        </tr>
      </tbody>
    </table>
  </div>
  <div style="margin: 14px 22px 0; padding: 12px 14px; background:#FBF6E9; border:1px solid #EADFC4; border-radius:8px; font-size:13px; color:#6B5A31;">
    <strong style="font-weight:600;">3 branches uncovered</strong> — all inside <code style="font-family:'SF Mono',ui-monospace,Menlo,monospace;">rateLimit()</code>,
    the middleware the spec puts out of scope. The limiter itself is fully exercised.
  </div>
  <pre style="font-size:12.5px; color:${PALETTE.muted}; padding-top: 12px;">coverage written to ./coverage/index.html</pre>
</div>`,
);

async function shoot(name, html, height) {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({
    viewport: { width: 1000, height },
    deviceScaleFactor: 2,
  });
  await page.setContent(html, { waitUntil: 'load' });
  const file = join(OUT, name);
  await page.screenshot({ path: file, fullPage: true });
  await browser.close();
  const kb = (readFileSync(file).length / 1024).toFixed(1);
  console.log(`  wrote ${name} (${kb} KB)`);
}

console.log('rendering example screenshots…');
await shoot('test-run.png', testRun, 470);
await shoot('coverage.png', coverage, 420);
console.log('done.');
