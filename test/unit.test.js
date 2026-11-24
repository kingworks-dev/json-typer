'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { infer, merge, splitNull, nameTypes, pascal, singular } = require('../src/infer');
const { generate, FREE, PRO, isPro } = require('../src/emit');
const { validKey, makeKey } = require('../src/license');
const { parseJsonLoose } = require('../src/parse');

const sample = { id: 1, name: 'a', tags: ['x'], items: [{ sku: 'a', qty: 2, price: 1.5, note: null }, { sku: 'b', qty: 3, extra: true }], 'user-name': 'u', nested: { ok: true, class: 1 } };

test('infer primitives and ints vs floats', () => {
  assert.deepStrictEqual(infer(1), { k: 'integer' });
  assert.deepStrictEqual(infer(1.5), { k: 'number' });
  assert.deepStrictEqual(merge(infer(1), infer(1.5)), { k: 'number' });
  assert.deepStrictEqual(infer([]), { k: 'array', of: { k: 'any' } });
});
test('array of objects merges, missing keys optional', () => {
  const t = infer([{ a: 1, b: 'x' }, { a: 2 }, { c: true }]);
  const f = Object.fromEntries(t.of.fields.map(x => [x.key, x.optional]));
  assert.deepStrictEqual(f, { a: true, b: true, c: true });
  const t2 = infer([{ a: 1 }, { a: 2, b: 1 }]);
  assert.strictEqual(t2.of.fields.find(x => x.key === 'a').optional, false);
});
test('null merges into nullable union', () => {
  const t = merge(infer('x'), infer(null));
  const s = splitNull(t);
  assert.strictEqual(s.nullable, true);
  assert.deepStrictEqual(s.t, { k: 'string' });
});
test('mixed types give union', () => {
  const t = infer([1, 'a', true]);
  assert.strictEqual(t.of.k, 'union');
  assert.strictEqual(t.of.of.length, 3);
});
test('naming: singular, pascal, collisions', () => {
  assert.strictEqual(singular('categories'), 'category');
  assert.strictEqual(singular('boxes'), 'box');
  assert.strictEqual(pascal('user-name'), 'UserName');
  assert.strictEqual(pascal('123abc'), '_123abc');
  const n = nameTypes(infer({ a: { x: 1 }, b: { a: { y: 1 } } }), 'Root');
  const names = n.decls.map(d => d.name);
  assert.strictEqual(new Set(names).size, names.length);
});
test('root array of objects gets alias and no name clash', () => {
  const ts = generate([{ id: 1 }, { id: 2 }], 'typescript', { rootName: 'Root' });
  assert.match(ts, /export interface \w+ \{/);
  assert.match(ts, /export type Root = \w+\[\];/);
});
test('TypeScript output', () => {
  const ts = generate(sample, 'typescript', { rootName: 'Order' });
  assert.match(ts, /export interface Order \{/);
  assert.match(ts, /items: Item\[\];/);
  assert.match(ts, /"user-name": string;/);
  assert.match(ts, /price\?: number;/);
  assert.match(generate(sample, 'typescript', { rootName: 'Order', style: 'type', readonly: true }), /export type Order = \{\n {2}readonly id: number;/);
});
test('Go output', () => {
  const g = generate(sample, 'go', { rootName: 'Order' });
  assert.match(g, /UserName\s+string\s+`json:"user-name"`/);
  assert.match(g, /Price\s+\*float64\s+`json:"price,omitempty"`/);
  assert.match(g, /Items\s+\[\]Item/);
});
test('JSON Schema output is valid JSON with required', () => {
  const s = JSON.parse(generate(sample, 'jsonschema', { rootName: 'Order' }));
  assert.strictEqual(s.title, 'Order');
  assert.ok(s.required.includes('id'));
  assert.deepStrictEqual(s.properties.items.items.required, ['sku', 'qty']);
});
test('Zod output', () => {
  const z = generate(sample, 'zod', { rootName: 'Order' });
  assert.match(z, /import \{ z \} from 'zod';/);
  assert.match(z, /items: z\.array\(ItemSchema\),/);
  assert.match(z, /price: z\.number\(\)\.optional\(\),/);
  assert.match(z, /export type Order = z\.infer<typeof OrderSchema>;/);
});
test('Python dataclass: optional fields last, keyword and alias', () => {
  const p = generate(sample, 'python-dataclass', { rootName: 'Order' });
  assert.match(p, /class_: int {2}# JSON key: "class"/);
  assert.match(p, /user_name: str/);
  const item = /class Item:\n([\s\S]*?)\n\n\n/.exec(p)[1].split('\n');
  assert.ok(item.findIndex(l => /= None/.test(l)) > item.findIndex(l => /qty: int/.test(l)));
  const pd = generate(sample, 'pydantic', { rootName: 'Order' });
  assert.match(pd, /class_: int = Field\(alias="class"\)/);
});
test('Rust: rename, Option, keyword', () => {
  const r = generate({ type: 'x', 'a-b': 1, opt: [{ q: 1 }, {}] }, 'rust', { rootName: 'T' });
  assert.match(r, /#\[serde\(rename = "type"\)\]\n {4}pub r#type: String,/);
  assert.match(r, /rename = "a-b"\)\]\n {4}pub a_b: i64,/);
  assert.match(r, /pub struct T \{/);
  const r2 = generate(sample, 'rust', { rootName: 'Order' });
  assert.match(r2, /pub note: serde_json::Value,/);
  assert.doesNotMatch(r2, /skip_serializing_if = "Option::is_none"\)\]\n {4}pub note: serde_json::Value/);
});
test('C# and Kotlin', () => {
  const c = generate(sample, 'csharp', { rootName: 'Order' });
  assert.match(c, /\[JsonPropertyName\("user-name"\)\]\n {4}public string UserName \{ get; set; \}/);
  assert.match(c, /public List<Item> Items/);
  const k = generate(sample, 'kotlin', { rootName: 'Order' });
  assert.match(k, /@SerialName\("class"\) val `class`: Long,/);
  assert.match(k, /@SerialName\("price"\) val price: Double\? = null,/);
});
test('every language handles scalars, empty object, nested arrays', () => {
  for (const l of [...FREE, ...PRO]) {
    for (const v of [1, 'x', null, true, {}, [], [[1, 2], [3]], [{ a: [{ b: 1 }] }], { a: null }, { a: [1, 'x'] }]) {
      const out = generate(v, l, {});
      assert.ok(typeof out === 'string' && out.length > 0, l + ' ' + JSON.stringify(v));
    }
  }
});
test('free vs pro split', () => {
  assert.deepStrictEqual(FREE, ['typescript', 'go', 'jsonschema']);
  assert.ok(PRO.every(isPro) && !FREE.some(isPro));
});
test('license keys', () => {
  const k = makeKey('A7C3', '5E19');
  assert.strictEqual(validKey(k), true);
  assert.strictEqual(validKey(k.toLowerCase()), true);
  assert.strictEqual(validKey('  ' + k + ' '), true);
  assert.strictEqual(validKey('JTYP-A7C3-5E19-0000'), false);
  assert.strictEqual(validKey('SNIP-A7C3-5E19-9890'), false);
  assert.strictEqual(validKey(''), false);
  assert.strictEqual(validKey(null), false);
  assert.strictEqual(validKey(k.replace('A7C3', 'A7C4')), false);
});
test('the key sold on the Stripe confirmation page is valid', () => {
  const fs = require('fs');
  const keyFile = process.env.JT_SOLD_KEY_FILE;
  if (!keyFile || !fs.existsSync(keyFile)) return;
  assert.strictEqual(validKey(fs.readFileSync(keyFile, 'utf8').trim()), true);
});
test('loose JSON parsing', () => {
  assert.deepStrictEqual(parseJsonLoose('const x = {"a":1, // c\n"b":[1,2,],};'), { a: 1, b: [1, 2] });
  assert.deepStrictEqual(parseJsonLoose('{"url":"http://a//b,]"}'), { url: 'http://a//b,]' });
  assert.throws(() => parseJsonLoose('{bad'), /not valid JSON/);
  assert.throws(() => parseJsonLoose('   '), /empty/);
});
