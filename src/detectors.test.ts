import { parse, Lang } from '@ast-grep/napi';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectors } from './detectors.js';
import { createTypeScriptContext } from './typescript.js';
import type { TypeContext } from './typescript.js';

function detect(
  source: string,
  lang: Lang,
  types: TypeContext | null,
): string[] {
  const root = parse(lang, source).root();
  const found = new Set<string>();
  for (const { rule, visit } of detectors) {
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
});
