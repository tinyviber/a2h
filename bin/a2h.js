#!/usr/bin/env node
'use strict';

// Thin entry point: loads the compiled CLI and hands off control.
// Kept as plain JS so the shebang survives publishing regardless of
// how the TypeScript build emits its output.
require('../dist/cli/index.js').main(process.argv.slice(2));
