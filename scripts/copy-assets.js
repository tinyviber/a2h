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

console.log('[@tinyviber/a2h] copied renderer assets to', outDir);
