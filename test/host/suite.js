// Executed inside the VS Code extension host.
const assert = require('assert');
const vscode = require('vscode');
exports.run = async function run() {
  const ext = vscode.extensions.getExtension('kingaikits.json-typer');
  assert.ok(ext, 'extension found');
  await ext.activate();
  assert.ok(ext.isActive, 'extension active');
  const cmds = await vscode.commands.getCommands(true);
  for (const c of ['jsonTyper.fromSelection', 'jsonTyper.fromClipboard', 'jsonTyper.toTypeScript', 'jsonTyper.toGo', 'jsonTyper.toZod', 'jsonTyper.activatePro', 'jsonTyper.buyPro', 'jsonTyper.status']) {
    assert.ok(cmds.includes(c), 'command registered: ' + c);
  }
  const sample = { id: 1, items: [{ a: 1 }, { a: 2, b: 'x' }] };
  const ts = await vscode.commands.executeCommand('jsonTyper._generate', sample, 'typescript', { rootName: 'Root' });
  assert.ok(/export interface Root/.test(ts) && /b\?: string;/.test(ts), 'typescript generated in host');
  // Free tier by default
  assert.strictEqual(await vscode.commands.executeCommand('jsonTyper._isPro'), false);
  // Wrong key stays free, right key unlocks
  assert.strictEqual(await vscode.commands.executeCommand('jsonTyper._setKey', 'JTYP-0000-0000-0000'), false);
  const { makeKey } = require('../../src/license');
  assert.strictEqual(await vscode.commands.executeCommand('jsonTyper._setKey', makeKey('A7C3', '5E19')), true);
  // End-to-end: open a JSON doc, run the TypeScript command, a new tab with generated types appears
  const doc = await vscode.workspace.openTextDocument({ content: '{"name":"x","tags":["a"],"n":null}', language: 'json' });
  await vscode.window.showTextDocument(doc);
  await vscode.commands.executeCommand('jsonTyper.toTypeScript');
  await new Promise(r => setTimeout(r, 500));
  const out = vscode.window.activeTextEditor.document;
  assert.strictEqual(out.languageId, 'typescript');
  assert.ok(/export interface Root/.test(out.getText()) && /tags: string\[\];/.test(out.getText()), 'output document has the types: ' + out.getText());
  await vscode.commands.executeCommand('jsonTyper._setKey', undefined);
  console.log('JSON_TYPER_HOST_TESTS_PASSED');
  if (process.env.JT_FORCE_FAIL) assert.fail('forced failure to prove the suite executes');
};
