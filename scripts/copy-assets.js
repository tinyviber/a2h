'use strict';

// Copies the renderer's static assets into the build output so the compiled
// CLI can serve them at runtime without a separate frontend build.
//
// The viewer is plain ES modules (see src/renderer/assets/js/), so this is a
// recursive copy — there is no bundling step to run.
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src', 'renderer', 'assets');
const outDir = path.join(__dirname, '..', 'dist', 'renderer', 'assets');

if (!fs.existsSync(srcDir)) {
  console.error('[@tinyviber/a2h] renderer assets not found:', srcDir);
  process.exit(1);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.cpSync(srcDir, outDir, { recursive: true });

// KaTeX is rendered on the server, but its output is styled by the browser.
// Keep the stylesheet and modern woff2 fonts local so the viewer remains
// usable under its self-only CSP and without a network connection.
const katexDir = path.join(outDir, 'katex');
const katexSourceDir = path.join(__dirname, '..', 'node_modules', 'katex', 'dist');
fs.mkdirSync(path.join(katexDir, 'fonts'), { recursive: true });
fs.copyFileSync(path.join(katexSourceDir, 'katex.min.css'), path.join(katexDir, 'katex.min.css'));
for (const file of fs.readdirSync(path.join(katexSourceDir, 'fonts'))) {
  if (/\.(woff2?|ttf)$/.test(file)) {
    fs.copyFileSync(
      path.join(katexSourceDir, 'fonts', file),
      path.join(katexDir, 'fonts', file),
    );
  }
}

console.log('[@tinyviber/a2h] copied renderer assets to', outDir);
