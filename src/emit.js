'use strict';
const { infer, splitNull, nameTypes, pascal, camel, snake } = require('./infer');

const FREE = ['typescript', 'go', 'jsonschema'];
const PRO = ['zod', 'python-dataclass', 'pydantic', 'rust', 'csharp', 'kotlin'];
const LABELS = {
  typescript: 'TypeScript', go: 'Go struct', jsonschema: 'JSON Schema',
  zod: 'Zod schema', 'python-dataclass': 'Python dataclass', pydantic: 'Python Pydantic',
  rust: 'Rust (serde)', csharp: 'C# class', kotlin: 'Kotlin (kotlinx.serialization)',
};
const EXT = { typescript: 'ts', go: 'go', jsonschema: 'json', zod: 'ts', 'python-dataclass': 'py', pydantic: 'py', rust: 'rs', csharp: 'cs', kotlin: 'kt' };
const LANGUAGE_ID = { typescript: 'typescript', go: 'go', jsonschema: 'json', zod: 'typescript', 'python-dataclass': 'python', pydantic: 'python', rust: 'rust', csharp: 'csharp', kotlin: 'kotlin' };

const isIdent = k => /^[A-Za-z_$][\w$]*$/.test(k);
const tsKey = k => (isIdent(k) ? k : JSON.stringify(k));
const arrOf = (inner, wrap) => wrap(inner);

// ---------------------------------------------------------------- TypeScript
function emitTypeScript({ root, decls }, o) {
  const ty = t => {
    switch (t.k) {
      case 'string': return 'string';
      case 'number': case 'integer': return 'number';
      case 'boolean': return 'boolean';
      case 'null': return 'null';
      case 'any': return 'unknown';
      case 'ref': return t.name;
      case 'array': { const e = ty(t.of); return t.of.k === 'union' ? `(${e})[]` : `${e}[]`; }
      case 'union': return t.of.map(ty).join(' | ');
      default: return 'unknown';
    }
  };
  const out = [];
  for (const d of decls) {
    const ro = o.readonly ? 'readonly ' : '';
    const body = d.fields.map(f => `  ${ro}${tsKey(f.key)}${f.optional ? '?' : ''}: ${ty(f.type)};`).join('\n');
    out.push(o.style === 'type'
      ? `export type ${d.name} = {\n${body}\n};`
      : `export interface ${d.name} {\n${body}\n}`);
  }
  if (root.k !== 'ref') out.push(`export type ${pascal(o.rootName)} = ${ty(root)};`);
  return out.join('\n\n') + '\n';
}

// ---------------------------------------------------------------------- Go
function emitGo({ root, decls }, o) {
  const prim = t => {
    switch (t.k) {
      case 'string': return 'string';
      case 'integer': return 'int64';
      case 'number': return 'float64';
      case 'boolean': return 'bool';
      case 'ref': return t.name;
      case 'array': return '[]' + goTy(t.of);
      default: return 'any';
    }
  };
  const goTy = t => {
    const { t: inner, nullable } = splitNull(t);
    const base = prim(inner);
    if (nullable && !['any'].includes(base) && !base.startsWith('[]')) return '*' + base;
    return base;
  };
  const out = [];
  for (const d of decls) {
    const names = new Set();
    const rows = d.fields.map(f => {
      let n = pascal(f.key);
      while (names.has(n)) n += '_';
      names.add(n);
      let ty = goTy(f.type);
      if (f.optional && !ty.startsWith('*') && !ty.startsWith('[]') && ty !== 'any') ty = '*' + ty;
      return [n, ty, `\`json:"${f.key.replace(/"/g, '\\"')}${f.optional ? ',omitempty' : ''}"\``];
    });
    const w1 = Math.max(0, ...rows.map(r => r[0].length)), w2 = Math.max(0, ...rows.map(r => r[1].length));
    out.push(`type ${d.name} struct {\n${rows.map(r => `\t${r[0].padEnd(w1)} ${r[1].padEnd(w2)} ${r[2]}`).join('\n')}\n}`);
  }
  if (root.k !== 'ref') out.push(`type ${pascal(o.rootName)} ${goTy(root)}`);
  return out.join('\n\n') + '\n';
}

// --------------------------------------------------------------- JSON Schema
function emitJsonSchema({ root, decls }, o) {
  const byName = new Map(decls.map(d => [d.name, d]));
  const sc = t => {
    switch (t.k) {
      case 'string': return { type: 'string' };
      case 'integer': return { type: 'integer' };
      case 'number': return { type: 'number' };
      case 'boolean': return { type: 'boolean' };
      case 'null': return { type: 'null' };
      case 'any': return {};
      case 'array': return { type: 'array', items: sc(t.of) };
      case 'union': return { anyOf: t.of.map(sc) };
      case 'ref': {
        const d = byName.get(t.name);
        const properties = {};
        for (const f of d.fields) properties[f.key] = sc(f.type);
        const required = d.fields.filter(f => !f.optional).map(f => f.key);
        const r = { type: 'object', properties };
        if (required.length) r.required = required;
        return r;
      }
      default: return {};
    }
  };
  const body = sc(root);
  return JSON.stringify(Object.assign({ $schema: 'http://json-schema.org/draft-07/schema#', title: pascal(o.rootName) }, body), null, 2) + '\n';
}

// --------------------------------------------------------------------- Zod
function emitZod({ root, decls }, o) {
  const ex = t => {
    const { t: inner, nullable } = splitNull(t);
    let s;
    switch (inner.k) {
      case 'string': s = 'z.string()'; break;
      case 'integer': s = 'z.number().int()'; break;
      case 'number': s = 'z.number()'; break;
      case 'boolean': s = 'z.boolean()'; break;
      case 'null': s = 'z.null()'; break;
      case 'ref': s = inner.name + 'Schema'; break;
      case 'array': s = `z.array(${ex(inner.of)})`; break;
      case 'union': s = `z.union([${inner.of.map(ex).join(', ')}])`; break;
      default: s = 'z.unknown()';
    }
    return nullable && inner.k !== 'any' ? s + '.nullable()' : s;
  };
  const out = ["import { z } from 'zod';"];
  for (const d of decls) {
    const body = d.fields.map(f => `  ${tsKey(f.key)}: ${ex(f.type)}${f.optional ? '.optional()' : ''},`).join('\n');
    out.push(`export const ${d.name}Schema = z.object({\n${body}\n});\nexport type ${d.name} = z.infer<typeof ${d.name}Schema>;`);
  }
  if (root.k !== 'ref') {
    const n = pascal(o.rootName);
    out.push(`export const ${n}Schema = ${ex(root)};\nexport type ${n} = z.infer<typeof ${n}Schema>;`);
  }
  return out.join('\n\n') + '\n';
}

// ------------------------------------------------------------------ Python
const PY_KW = new Set('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case type'.split(' '));
function pyIdent(key, taken) {
  let n = snake(key);
  if (PY_KW.has(n)) n += '_';
  while (taken.has(n)) n += '_';
  taken.add(n);
  return n;
}
function pyTy(t) {
  const { t: inner, nullable } = splitNull(t);
  let s;
  switch (inner.k) {
    case 'string': s = 'str'; break;
    case 'integer': s = 'int'; break;
    case 'number': s = 'float'; break;
    case 'boolean': s = 'bool'; break;
    case 'ref': s = inner.name; break;
    case 'array': s = `List[${pyTy(inner.of)}]`; break;
    case 'union': s = `Union[${inner.of.map(pyTy).join(', ')}]`; break;
    default: s = 'Any';
  }
  return nullable && s !== 'Any' ? `Optional[${s}]` : s;
}
function emitPython({ root, decls }, o, pydantic) {
  const out = [];
  out.push(pydantic
    ? 'from typing import Any, List, Optional, Union\n\nfrom pydantic import BaseModel, Field'
    : 'from dataclasses import dataclass\nfrom typing import Any, List, Optional, Union');
  for (const d of decls) {
    const taken = new Set();
    const rows = d.fields.map(f => {
      const id = pyIdent(f.key, taken);
      let ty = pyTy(f.type);
      if (f.optional && !ty.startsWith('Optional[') && ty !== 'Any') ty = `Optional[${ty}]`;
      return { id, ty, key: f.key, optional: f.optional, renamed: id !== f.key };
    });
    rows.sort((a, b) => (a.optional ? 1 : 0) - (b.optional ? 1 : 0));
    const lines = rows.map(r => {
      if (pydantic) {
        const def = r.optional ? (r.renamed ? `Field(None, alias=${JSON.stringify(r.key)})` : 'None')
          : (r.renamed ? `Field(alias=${JSON.stringify(r.key)})` : null);
        return `    ${r.id}: ${r.ty}${def ? ' = ' + def : ''}`;
      }
      return `    ${r.id}: ${r.ty}${r.optional ? ' = None' : ''}${r.renamed ? `  # JSON key: ${JSON.stringify(r.key)}` : ''}`;
    });
    out.push(pydantic ? `class ${d.name}(BaseModel):\n${lines.join('\n') || '    pass'}`
      : `@dataclass\nclass ${d.name}:\n${lines.join('\n') || '    pass'}`);
  }
  if (root.k !== 'ref') out.push(`${pascal(o.rootName)} = ${pyTy(root)}`);
  return out.join('\n\n\n') + '\n';
}

// -------------------------------------------------------------------- Rust
const RS_KW = new Set('as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while abstract become box do final macro override priv try typeof unsized virtual yield'.split(' '));
function emitRust({ root, decls }, o) {
  const ty = t => {
    const { t: inner, nullable } = splitNull(t);
    let s;
    switch (inner.k) {
      case 'string': s = 'String'; break;
      case 'integer': s = 'i64'; break;
      case 'number': s = 'f64'; break;
      case 'boolean': s = 'bool'; break;
      case 'ref': s = inner.name; break;
      case 'array': s = `Vec<${ty(inner.of)}>`; break;
      default: s = 'serde_json::Value';
    }
    return nullable && s !== 'serde_json::Value' ? `Option<${s}>` : s;
  };
  const out = ['use serde::{Deserialize, Serialize};'];
  for (const d of decls) {
    const taken = new Set();
    const lines = d.fields.map(f => {
      let id = snake(f.key);
      const base = id;
      while (taken.has(id)) id += '_';
      taken.add(id);
      const safe = RS_KW.has(id) && !['self', 'Self', 'super', 'crate'].includes(id) ? 'r#' + id : (RS_KW.has(id) ? id + '_' : id);
      let t = ty(f.type);
      const attrs = [];
      if (f.key !== id || safe !== id) attrs.push(`rename = ${JSON.stringify(f.key)}`);
      if (f.optional) {
        if (t === 'serde_json::Value') attrs.push('default');
        else {
          if (!t.startsWith('Option<')) t = `Option<${t}>`;
          attrs.push('default', 'skip_serializing_if = "Option::is_none"');
        }
      }
      const a = attrs.length ? `    #[serde(${attrs.join(', ')})]\n` : '';
      return `${a}    pub ${safe}: ${t},`;
    });
    out.push(`#[derive(Debug, Clone, Serialize, Deserialize)]\npub struct ${d.name} {\n${lines.join('\n')}\n}`);
  }
  if (root.k !== 'ref') out.push(`pub type ${pascal(o.rootName)} = ${ty(root)};`);
  return out.join('\n\n') + '\n';
}

// ---------------------------------------------------------------------- C#
function emitCSharp({ root, decls }, o) {
  const ty = t => {
    const { t: inner, nullable } = splitNull(t);
    let s;
    switch (inner.k) {
      case 'string': s = 'string'; break;
      case 'integer': s = 'long'; break;
      case 'number': s = 'double'; break;
      case 'boolean': s = 'bool'; break;
      case 'ref': s = inner.name; break;
      case 'array': s = `List<${ty(inner.of)}>`; break;
      default: s = 'object';
    }
    return nullable && s !== 'object' ? s + '?' : s;
  };
  const out = ['using System.Collections.Generic;\nusing System.Text.Json.Serialization;'];
  for (const d of decls) {
    const taken = new Set();
    const lines = d.fields.map(f => {
      let id = pascal(f.key);
      if (id === d.name) id += 'Value';
      while (taken.has(id)) id += '_';
      taken.add(id);
      let t = ty(f.type);
      if (f.optional && !t.endsWith('?') && t !== 'object') t += '?';
      return `    [JsonPropertyName(${JSON.stringify(f.key)})]\n    public ${t} ${id} { get; set; }`;
    });
    out.push(`public class ${d.name}\n{\n${lines.join('\n\n')}\n}`);
  }
  if (root.k !== 'ref') out.push(`// Root is ${ty(root)}`);
  return out.join('\n\n') + '\n';
}

// ------------------------------------------------------------------ Kotlin
const KT_KW = new Set('as break class continue do else false for fun if in interface is null object package return super this throw true try typealias typeof val var when while'.split(' '));
function emitKotlin({ root, decls }, o) {
  const ty = t => {
    const { t: inner, nullable } = splitNull(t);
    let s;
    switch (inner.k) {
      case 'string': s = 'String'; break;
      case 'integer': s = 'Long'; break;
      case 'number': s = 'Double'; break;
      case 'boolean': s = 'Boolean'; break;
      case 'ref': s = inner.name; break;
      case 'array': s = `List<${ty(inner.of)}>`; break;
      default: s = 'JsonElement';
    }
    return nullable && s !== 'JsonElement' ? s + '?' : s;
  };
  const out = ['import kotlinx.serialization.SerialName\nimport kotlinx.serialization.Serializable\nimport kotlinx.serialization.json.JsonElement'];
  for (const d of decls) {
    const taken = new Set();
    const rows = d.fields.map(f => {
      let id = camel(f.key);
      while (taken.has(id)) id += '_';
      taken.add(id);
      const shown = KT_KW.has(id) ? '`' + id + '`' : id;
      let t = ty(f.type);
      if (f.optional && !t.endsWith('?') && t !== 'JsonElement') t += '?';
      return { f, shown, t };
    });
    rows.sort((a, b) => (a.f.optional ? 1 : 0) - (b.f.optional ? 1 : 0));
    const lines = rows.map(r => `    @SerialName(${JSON.stringify(r.f.key)}) val ${r.shown}: ${r.t}${r.f.optional ? (r.t === 'JsonElement' ? ' = kotlinx.serialization.json.JsonNull' : ' = null') : ''},`);
    out.push(`@Serializable\ndata class ${d.name}(\n${lines.join('\n')}\n)`);
  }
  if (root.k !== 'ref') out.push(`typealias ${pascal(o.rootName)} = ${ty(root)}`);
  return out.join('\n\n') + '\n';
}

// ------------------------------------------------------------------ entry
function generate(value, lang, opts) {
  const o = Object.assign({ rootName: 'Root', style: 'interface', readonly: false }, opts || {});
  const named = nameTypes(infer(value), o.rootName);
  switch (lang) {
    case 'typescript': return emitTypeScript(named, o);
    case 'go': return emitGo(named, o);
    case 'jsonschema': return emitJsonSchema(named, o);
    case 'zod': return emitZod(named, o);
    case 'python-dataclass': return emitPython(named, o, false);
    case 'pydantic': return emitPython(named, o, true);
    case 'rust': return emitRust(named, o);
    case 'csharp': return emitCSharp(named, o);
    case 'kotlin': return emitKotlin(named, o);
    default: throw new Error('Unknown language: ' + lang);
  }
}
function isPro(lang) { return PRO.includes(lang); }

module.exports = { generate, isPro, FREE, PRO, LABELS, EXT, LANGUAGE_ID };
