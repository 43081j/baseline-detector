import { parse, Lang } from '@ast-grep/napi';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectorLang, detectors } from './detectors.js';
import { createTypeScriptContext } from './typescript.js';
import type { TypeContext } from './typescript.js';

function detect(
  source: string,
  lang: Lang,
  types: TypeContext | null,
): string[] {
  const root = parse(lang, source).root();
  const found = new Set<string>();
  const targetLang = detectorLang(lang);
  for (const detector of detectors) {
    if (detector.lang !== targetLang) continue;
    const { rule, visit } = detector;
    for (const node of root.findAll({ rule })) {
      visit(node, (id) => found.add(id), types);
    }
  }
  return [...found].sort();
}

// Builds a type context for an inline TypeScript snippet by compiling it as a
// throwaway file. The parsed source stays in the program, so the file can be
// removed straight away.
function makeTypeContext(source: string): TypeContext {
  const dir = mkdtempSync(path.join(tmpdir(), 'baseline-detector-'));
  const file = path.join(dir, 'input.ts');
  writeFileSync(file, source);
  try {
    const base = createTypeScriptContext(process.cwd(), [file]);
    const sourceFile = base?.program.getSourceFile(file);
    if (!base || !sourceFile) {
      throw new Error('failed to create type context');
    }
    return { ...base, sourceFile };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const cases: Array<{ name: string; code: string; expected: string[] }> = [
  { name: 'optional chaining', code: 'a?.b;', expected: ['object-object'] },
  {
    name: 'nullish coalescing',
    code: 'x = a ?? b;',
    expected: ['nullish-coalescing'],
  },
  {
    name: 'nullish coalescing assignment',
    code: 'a ??= b;',
    expected: ['nullish-coalescing'],
  },
  {
    name: 'logical assignment',
    code: 'a ||= b; a &&= b;',
    expected: ['logical-assignments'],
  },
  {
    name: 'exponentiation',
    code: 'x = a ** b; a **= b;',
    expected: ['exponentiation'],
  },
  { name: 'spread', code: 'foo(...a);', expected: ['spread'] },
  {
    name: 'destructuring',
    code: 'foo(({ a }) => a);',
    expected: ['destructuring', 'functions'],
  },
  {
    name: 'async/await',
    code: 'async function f() { await g(); }',
    expected: ['async-await'],
  },
  { name: 'arrow function', code: 'foo(() => 1);', expected: ['functions'] },
  {
    name: 'private class fields',
    code: 'class A { #x = 1; }',
    expected: ['class-syntax'],
  },
  {
    name: 'template literals',
    code: 'foo(`hi`);',
    expected: ['template-literals'],
  },
  { name: 'generator', code: 'function* g() {}', expected: ['generators'] },
  {
    name: 'async generator',
    code: 'async function* g() {}',
    expected: ['async-generators', 'generators'],
  },
  { name: 'dynamic import', code: 'import("x");', expected: ['js-modules'] },
  { name: 'import.meta', code: 'import.meta.url;', expected: ['js-modules'] },
  {
    name: 'optional catch binding',
    code: 'try { a(); } catch { b(); }',
    expected: ['optional-catch-binding'],
  },
  {
    name: 'static initialization block',
    code: 'class A { static { x = 1; } }',
    expected: ['class-syntax'],
  },
  {
    name: 'numeric separators',
    code: 'foo(1_000);',
    expected: ['numeric-separators'],
  },
  {
    name: 'hashbang comment',
    code: '#!/usr/bin/env node\nfoo();',
    expected: ['hashbang-comments'],
  },
  { name: 'const declaration', code: 'const a = 1;', expected: ['let-const'] },
  { name: 'fetch global', code: 'fetch("/x");', expected: ['fetch'] },
  { name: 'Promise global', code: 'Promise.resolve();', expected: ['promise'] },
  {
    name: 'structuredClone global',
    code: 'structuredClone(x);',
    expected: ['structured-clone'],
  },
  { name: 'plain code emits nothing', code: 'var a = 1; a + b;', expected: [] },
];

const typedCases: Array<{ name: string; code: string; expected: string[] }> = [
  {
    name: 'Array.prototype.find',
    code: 'const a: number[] = []; a.find((x) => x === 1);',
    expected: ['array-find', 'functions', 'let-const'],
  },
  {
    name: 'Array.prototype.flat',
    code: 'const a: number[][] = []; a.flat();',
    expected: ['array-flat', 'let-const'],
  },
  {
    name: 'String.prototype.replaceAll',
    code: 'const s = "x"; s.replaceAll("a", "b");',
    expected: ['let-const', 'string-replaceall'],
  },
  {
    name: 'a type-checked global',
    code: 'fetch("/x");',
    expected: ['fetch'],
  },
  {
    name: 'a shadowed global is ignored',
    code: 'const fetch = 1; fetch;',
    expected: ['let-const'],
  },
];

const cssCases: Array<{ name: string; code: string; expected: string[] }> = [
  {
    name: 'a property',
    code: 'a { accent-color: red; }',
    expected: ['accent-color'],
  },
  {
    name: 'a property keyword',
    code: 'a { display: grid; }',
    expected: ['display', 'grid'],
  },
  {
    name: 'a global keyword',
    code: 'a { margin: revert-layer; }',
    expected: ['cascade-layers', 'margin'],
  },
  {
    name: 'a pseudo-class',
    code: 'a:focus-visible {}',
    expected: ['focus-visible'],
  },
  {
    name: 'a functional pseudo-class',
    code: 'a:has(b) {}',
    expected: ['has'],
  },
  {
    name: 'a functional pseudo-element',
    code: '::view-transition-old(root) {}',
    expected: ['view-transitions'],
  },
  {
    name: 'an at-rule',
    code: '@layer base;',
    expected: ['cascade-layers'],
  },
  {
    name: 'a media feature',
    code: '@media (prefers-color-scheme: dark) {}',
    expected: ['media-queries', 'prefers-color-scheme'],
  },
  {
    name: 'a prefixed range media feature',
    code: '@media (min-device-width: 600px) {}',
    expected: ['device-queries', 'media-queries'],
  },
  {
    name: 'a declaration nested in @container',
    code: '.a { @container (width > 1px) { accent-color: red; } }',
    expected: ['accent-color', 'container-queries', 'selectors'],
  },
  {
    name: 'a declaration nested in @layer',
    code: '.a { @layer x { accent-color: red; } }',
    expected: ['accent-color', 'cascade-layers', 'selectors'],
  },
  {
    name: 'a declaration nested in @media',
    code: '.a { @media print { accent-color: red; } }',
    expected: ['accent-color', 'media-queries', 'selectors'],
  },
  {
    name: 'a declaration nested in @scope',
    code: '.a { @scope (.b) { accent-color: red; } }',
    expected: ['accent-color', 'scope', 'selectors'],
  },
  {
    name: 'a declaration nested in @starting-style',
    code: '.a { @starting-style { accent-color: red; } }',
    expected: ['accent-color', 'selectors', 'starting-style'],
  },
  {
    name: 'a declaration nested in @supports',
    code: '.a { @supports (display: grid) { accent-color: red; } }',
    expected: ['accent-color', 'selectors', 'supports'],
  },
  {
    name: 'an at-rule descriptor',
    code: '@font-face { font-display: swap; }',
    expected: ['font-display', 'font-face'],
  },
  {
    name: 'a function',
    code: 'a { color: color-mix(in srgb, red, blue); }',
    expected: ['color', 'color-mix'],
  },
  {
    name: 'identifiers case-insensitively',
    code: 'A { COLOR: currentcolor; transform: TRANSLATEX(1PX); }',
    expected: ['color', 'currentcolor', 'transforms2d'],
  },
  {
    name: 'a function-valued property subfeature',
    code: 'a { animation-timeline: scroll(); }',
    expected: ['scroll-driven-animations'],
  },
  {
    name: 'the shape() function',
    code: 'a { clip-path: shape(from 0 0, line to 10px 10px); }',
    expected: ['clip-path', 'shape-function'],
  },
  {
    name: 'a unit',
    code: 'a { width: 1cap; }',
    expected: ['cap', 'width-height'],
  },
  {
    name: 'a dynamic viewport unit',
    code: 'a { width: 1dvh; }',
    expected: ['viewport-unit-variants', 'width-height'],
  },
  {
    name: 'a custom property',
    code: 'a { --x: 1px; }',
    expected: ['custom-properties'],
  },
  {
    name: 'nesting',
    code: 'a { &:hover {} b {} }',
    expected: ['nesting', 'user-action-pseudos'],
  },
];

describe('detectors', () => {
  it.each(cases)('detects $name', ({ code, expected }) => {
    expect(detect(code, Lang.JavaScript, null)).toEqual(expected);
  });

  it('collects every feature used in a snippet', () => {
    const code = 'const merge = (a, b) => ({ ...a, ...b });';
    expect(detect(code, Lang.JavaScript, null)).toEqual([
      'functions',
      'let-const',
      'spread',
    ]);
  });

  it.each(typedCases)('detects $name with types', ({ code, expected }) => {
    const types = makeTypeContext(code);
    expect(detect(code, Lang.TypeScript, types)).toEqual(expected);
  });

  it.each(cssCases)('detects CSS $name', ({ code, expected }) => {
    expect(detect(code, Lang.Css, null)).toEqual(expected);
  });

  it('does not run JS detectors on CSS', () => {
    expect(detect('a { content: "fetch"; }', Lang.Css, null)).toEqual([
      'content',
    ]);
  });
});
