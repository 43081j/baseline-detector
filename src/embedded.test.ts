import { Lang } from '@ast-grep/napi';
import { describe, expect, it } from 'vitest';
import { extractEmbedded } from './embedded.js';

describe('extractEmbedded', () => {
  it('extracts the contents of a script block', () => {
    const scripts = extractEmbedded('<script>const a = 1;</script>');
    expect(scripts).toEqual([
      {
        code: 'const a = 1;',
        lang: Lang.JavaScript,
        range: [8, 20],
      },
    ]);
  });

  it('defaults to JavaScript when no lang attribute is present', () => {
    const [script] = extractEmbedded('<script>const a = 1;</script>');
    expect(script?.lang).toBe(Lang.JavaScript);
  });

  it('defaults to JavaScript for an unrecognised lang', () => {
    const [script] = extractEmbedded('<script lang="coffee">a = 1</script>');
    expect(script?.lang).toBe(Lang.JavaScript);
  });

  it('detects lang="ts" as TypeScript', () => {
    const [script] = extractEmbedded(
      '<script lang="ts">const a: number = 1;</script>',
    );
    expect(script?.lang).toBe(Lang.TypeScript);
  });

  it('detects lang="tsx" as Tsx', () => {
    const [script] = extractEmbedded(
      '<script lang="tsx">const a = <div />;</script>',
    );
    expect(script?.lang).toBe(Lang.Tsx);
  });

  it('extracts multiple script blocks in document order', () => {
    const source = [
      '<script lang="ts">const setup = 1;</script>',
      '<script>const legacy = 2;</script>',
    ].join('\n');

    expect(extractEmbedded(source)).toEqual([
      { code: 'const setup = 1;', lang: Lang.TypeScript, range: [18, 34] },
      { code: 'const legacy = 2;', lang: Lang.JavaScript, range: [52, 69] },
    ]);
  });

  it('yields empty code for an empty script block', () => {
    expect(extractEmbedded('<script></script>')).toEqual([
      { code: '', lang: Lang.JavaScript, range: [8, 8] },
    ]);
  });

  it('returns an empty array when there are no script blocks', () => {
    expect(extractEmbedded('<template><div /></template>')).toEqual([]);
  });

  it('extracts scripts from surrounding markup', () => {
    const source = [
      '<template><ul><li /></ul></template>',
      '<script setup lang="ts">const items = [];</script>',
    ].join('\n');

    expect(extractEmbedded(source)).toEqual([
      { code: 'const items = [];', lang: Lang.TypeScript, range: [61, 78] },
    ]);
  });

  it('extracts style blocks as CSS', () => {
    const source = [
      '<style>a { color: red; }</style>',
      '<style lang="css">b { color: blue; }</style>',
    ].join('\n');

    expect(extractEmbedded(source)).toEqual([
      { code: 'a { color: red; }', lang: Lang.Css, range: [7, 24] },
      { code: 'b { color: blue; }', lang: Lang.Css, range: [51, 69] },
    ]);
  });

  it('skips style blocks in preprocessor languages', () => {
    expect(
      extractEmbedded('<style lang="scss">a { b { c: d; } }</style>'),
    ).toEqual([]);
  });

  it('extracts scripts and styles in document order', () => {
    const source = '<style>a {}</style><script>const a = 1;</script>';

    expect(extractEmbedded(source)).toEqual([
      { code: 'a {}', lang: Lang.Css, range: [7, 11] },
      { code: 'const a = 1;', lang: Lang.JavaScript, range: [27, 39] },
    ]);
  });
});
