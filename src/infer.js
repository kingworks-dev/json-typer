'use strict';
// Type inference from a JSON value. Pure, no dependencies.
// IR: {k:'string'|'number'|'integer'|'boolean'|'null'|'any'}
//     {k:'array', of:T} | {k:'object', fields:[{key, type, optional}]} | {k:'union', of:[T...]}

function infer(v) {
  if (v === null) return { k: 'null' };
  if (Array.isArray(v)) {
    if (!v.length) return { k: 'array', of: { k: 'any' } };
    return { k: 'array', of: v.map(infer).reduce(merge) };
  }
  switch (typeof v) {
    case 'string': return { k: 'string' };
    case 'boolean': return { k: 'boolean' };
    case 'number': return { k: Number.isInteger(v) ? 'integer' : 'number' };
    case 'object': return { k: 'object', fields: Object.keys(v).map(key => ({ key, type: infer(v[key]), optional: false })) };
    default: return { k: 'any' };
  }
}

function members(t) { return t.k === 'union' ? t.of : [t]; }

function merge(a, b) {
  if (a.k === 'any') return a;
  if (b.k === 'any') return b;
  if (a.k === b.k) {
    if (a.k === 'array') return { k: 'array', of: merge(a.of, b.of) };
    if (a.k === 'object') {
      const out = [];
      const bm = new Map(b.fields.map(f => [f.key, f]));
      const seen = new Set();
      for (const f of a.fields) {
        const g = bm.get(f.key);
        seen.add(f.key);
        out.push(g ? { key: f.key, type: merge(f.type, g.type), optional: f.optional || g.optional }
                   : { key: f.key, type: f.type, optional: true });
      }
      for (const g of b.fields) if (!seen.has(g.key)) out.push({ key: g.key, type: g.type, optional: true });
      return { k: 'object', fields: out };
    }
    if (a.k !== 'union') return a;
  }
  if ((a.k === 'integer' && b.k === 'number') || (a.k === 'number' && b.k === 'integer')) return { k: 'number' };
  // general union: fold each member of b into a's members
  const list = members(a).slice();
  for (const m of members(b)) {
    const i = list.findIndex(x => x.k === m.k || (isNum(x) && isNum(m)));
    if (i >= 0) list[i] = merge(list[i], m); else list.push(m);
  }
  return list.length === 1 ? list[0] : { k: 'union', of: list };
}
function isNum(t) { return t.k === 'number' || t.k === 'integer'; }

// Split a union into its non-null part and a nullable flag.
function splitNull(t) {
  if (t.k === 'null') return { t: { k: 'any' }, nullable: true, onlyNull: true };
  if (t.k !== 'union') return { t, nullable: false };
  const rest = t.of.filter(x => x.k !== 'null');
  const nullable = rest.length !== t.of.length;
  if (!rest.length) return { t: { k: 'any' }, nullable: true, onlyNull: true };
  return { t: rest.length === 1 ? rest[0] : { k: 'union', of: rest }, nullable };
}

// ---- naming -------------------------------------------------------------
function words(s) {
  return String(s).replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean);
}
function pascal(s) {
  const w = words(s).map(x => x[0].toUpperCase() + x.slice(1));
  let r = w.join('');
  if (!r) r = 'Field';
  if (/^[0-9]/.test(r)) r = '_' + r;
  return r;
}
function camel(s) { const p = pascal(s); return p[0].toLowerCase() + p.slice(1); }
function snake(s) {
  let r = words(s).map(x => x.toLowerCase()).join('_');
  if (!r) r = 'field';
  if (/^[0-9]/.test(r)) r = '_' + r;
  return r;
}
function singular(s) {
  if (/ies$/i.test(s) && s.length > 3) return s.slice(0, -3) + 'y';
  if (/(ses|xes|ches|shes)$/i.test(s)) return s.slice(0, -2);
  if (/s$/i.test(s) && !/ss$/i.test(s) && s.length > 2) return s.slice(0, -1);
  return s;
}

// Replace every object with {k:'ref', name} and collect declarations in post-order.
// Returns {root:T', decls:[{name, fields:[{key, type, optional}]}]}
function nameTypes(rootType, rootName) {
  const decls = [];
  const used = new Set();
  const unique = (base) => {
    let n = base, i = 2;
    while (used.has(n)) n = base + (i++);
    used.add(n);
    return n;
  };
  const walk = (t, hint) => {
    switch (t.k) {
      case 'array': return { k: 'array', of: walk(t.of, singular(hint)) };
      case 'union': return { k: 'union', of: t.of.map(x => walk(x, hint)) };
      case 'object': {
        const name = unique(pascal(hint));
        used.add(name);
        const fields = t.fields.map(f => ({ key: f.key, optional: f.optional, type: walk(f.type, f.key) }));
        decls.push({ name, fields });
        return { k: 'ref', name };
      }
      default: return t;
    }
  };
  if (rootType.k !== 'object') used.add(pascal(rootName || 'Root'));
  const root = walk(rootType, rootName || 'Root');
  return { root, decls };
}

module.exports = { infer, merge, splitNull, nameTypes, pascal, camel, snake, words, singular };
