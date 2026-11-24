'use strict';
// Parse JSON, tolerating a leading "const x =" / trailing semicolon, comments and trailing commas (JSONC-ish).
function stripJsonc(s) {
  let out = '', i = 0, inStr = false;
  while (i < s.length) {
    const c = s[i], n = s[i + 1];
    if (inStr) {
      out += c;
      if (c === '\\') { out += n; i += 2; continue; }
      if (c === '"') inStr = false;
      i++; continue;
    }
    if (c === '"') { inStr = true; out += c; i++; continue; }
    if (c === '/' && n === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}
function parseJsonLoose(raw) {
  let s = String(raw || '').trim();
  if (!s) throw new Error('Nothing to convert: the selection or clipboard is empty.');
  const m = /^(?:export\s+)?(?:const|let|var)\s+\w+\s*(?::[^=]+)?=\s*([\s\S]*?);?\s*$/.exec(s);
  if (m) s = m[1];
  try { return JSON.parse(s); } catch (e1) {
    try { return JSON.parse(stripJsonc(s)); } catch (e2) {
      throw new Error('That is not valid JSON (' + e1.message + ').');
    }
  }
}
module.exports = { parseJsonLoose, stripJsonc };
