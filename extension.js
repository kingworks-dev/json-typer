'use strict';
const vscode = require('vscode');
const { generate, isPro, FREE, PRO, LABELS, EXT, LANGUAGE_ID } = require('./src/emit');
const { validKey } = require('./src/license');
const { parseJsonLoose } = require('./src/parse');

const BUY_URL = 'https://buy.stripe.com/28E3co6zt7Ssew2cmT0x53B';
const KEY_STATE = 'jsonTyper.proKey';

function isProActive(ctx) {
  return validKey(ctx.globalState.get(KEY_STATE));
}

function options() {
  const c = vscode.workspace.getConfiguration('jsonTyper');
  return { rootName: c.get('rootName') || 'Root', style: c.get('typescriptStyle') || 'interface', readonly: !!c.get('readonlyFields') };
}

async function pickLanguage(ctx, preset) {
  const pro = isProActive(ctx);
  if (preset) return preset;
  const items = [...FREE, ...PRO].map(l => ({
    label: LABELS[l] + (isPro(l) && !pro ? '  (Pro)' : ''),
    description: isPro(l) ? 'Pro' : 'Free',
    lang: l,
  }));
  const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Generate types as...' });
  return pick && pick.lang;
}

async function gate(ctx, lang) {
  if (!isPro(lang) || isProActive(ctx)) return true;
  const a = await vscode.window.showInformationMessage(
    `${LABELS[lang]} is a Pro language. Pro is a one-time $4.99 unlock; TypeScript, Go and JSON Schema stay free.`,
    'Get Pro key', 'I have a key');
  if (a === 'Get Pro key') vscode.env.openExternal(vscode.Uri.parse(BUY_URL));
  if (a === 'I have a key') return activate(ctx);
  return false;
}

async function activate(ctx) {
  const key = await vscode.window.showInputBox({ prompt: 'Paste your JSON Typer Pro key (JTYP-XXXX-XXXX-XXXX)', ignoreFocusOut: true });
  if (!key) return false;
  if (!validKey(key)) { vscode.window.showErrorMessage('That key is not valid. Check it for typos, or email hello@usekingai.com.'); return false; }
  await ctx.globalState.update(KEY_STATE, key.trim().toUpperCase());
  vscode.window.showInformationMessage('JSON Typer Pro unlocked. Thank you.');
  return true;
}

async function show(text, lang, ctx) {
  const where = vscode.workspace.getConfiguration('jsonTyper').get('output') || 'newTab';
  const ed = vscode.window.activeTextEditor;
  if (where === 'insert' && ed) {
    await ed.edit(b => b.replace(ed.selection, text));
    return;
  }
  const doc = await vscode.workspace.openTextDocument({ content: text, language: LANGUAGE_ID[lang] });
  await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
}

async function run(ctx, source, preset) {
  let raw;
  if (source === 'clipboard') raw = await vscode.env.clipboard.readText();
  else {
    const ed = vscode.window.activeTextEditor;
    if (!ed) { vscode.window.showWarningMessage('Open a JSON file or select some JSON first.'); return; }
    raw = ed.selection.isEmpty ? ed.document.getText() : ed.document.getText(ed.selection);
  }
  let value;
  try { value = parseJsonLoose(raw); } catch (e) { vscode.window.showErrorMessage('JSON Typer: ' + e.message); return; }
  const lang = await pickLanguage(ctx, preset);
  if (!lang) return;
  if (!(await gate(ctx, lang))) return;
  let text;
  try { text = generate(value, lang, options()); } catch (e) { vscode.window.showErrorMessage('JSON Typer: ' + e.message); return; }
  await show(text, lang, ctx);
  return text;
}

function activateExt(ctx) {
  const reg = (id, fn) => ctx.subscriptions.push(vscode.commands.registerCommand(id, fn));
  reg('jsonTyper.fromSelection', () => run(ctx, 'editor'));
  reg('jsonTyper.fromClipboard', () => run(ctx, 'clipboard'));
  reg('jsonTyper.toTypeScript', () => run(ctx, 'editor', 'typescript'));
  reg('jsonTyper.toGo', () => run(ctx, 'editor', 'go'));
  reg('jsonTyper.toZod', () => run(ctx, 'editor', 'zod'));
  reg('jsonTyper.activatePro', () => activate(ctx));
  reg('jsonTyper.buyPro', () => vscode.env.openExternal(vscode.Uri.parse(BUY_URL)));
  reg('jsonTyper.status', () => vscode.window.showInformationMessage(isProActive(ctx) ? 'JSON Typer: Pro active.' : 'JSON Typer: Free (TypeScript, Go, JSON Schema).'));
  reg('jsonTyper._generate', (value, lang, opts) => generate(value, lang, opts));
  reg('jsonTyper._isPro', () => isProActive(ctx));
  reg('jsonTyper._setKey', async (k) => { await ctx.globalState.update(KEY_STATE, k); return isProActive(ctx); });
}
function deactivate() {}
module.exports = { activate: activateExt, deactivate };
