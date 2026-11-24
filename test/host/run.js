// Runs test/host/suite.js inside a real VS Code (headless via xvfb-run). Usage: xvfb-run -a node test/host/run.js
// Needs @vscode/test-electron resolvable (npm i in a scratch dir and set NODE_PATH).
const path = require('path');
const os = require('os');
const fs = require('fs');
const { runTests } = require('@vscode/test-electron');
(async () => {
  const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
  const extensionTestsPath = path.resolve(__dirname, 'suite.js');
  const cachePath = process.env.VSCODE_TEST_CACHE || path.join(os.tmpdir(), 'jt-vscode-test');
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'jtud-'));
  await runTests({
    cachePath, timeout: 600000, extensionDevelopmentPath, extensionTestsPath,
    launchArgs: ['--user-data-dir=' + ud, '--disable-extensions', '--disable-gpu', '--no-sandbox'],
  });
})().catch(e => { console.error('Host tests failed:', e); process.exit(1); });
