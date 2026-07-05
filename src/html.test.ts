import { Lang } from '@ast-grep/napi';
import { describe, expect, it } from 'vitest';
import { extractScripts } from './html.js';

describe('extractScripts', () => {
  it('extracts the contents of a script block', () => {
    const scripts = extractScripts('<script>const a = 1;</script>');
    expect(scripts).toEqual([{ code: 'const a = 1;', lang: Lang.JavaScript }]);
  });

  it('defaults to JavaScript when no lang attribute is present', () => {
    const [script] = extractScripts('<script>const a = 1;</script>');
    expect(script?.lang).toBe(Lang.JavaScript);
  });

  it('defaults to JavaScript for an unrecognised lang', () => {
    const [script] = extractScripts('<script lang="coffee">a = 1</script>');
    expect(script?.lang).toBe(Lang.JavaScript);
  });

  it('detects lang="ts" as TypeScript', () => {
    const [script] = extractScripts(
      '<script lang="ts">const a: number = 1;</script>',
    );
    expect(script?.lang).toBe(Lang.TypeScript);
  });

  it('detects lang="tsx" as Tsx', () => {
    const [script] = extractScripts(
      '<script lang="tsx">const a = <div />;</script>',
    );
    expect(script?.lang).toBe(Lang.Tsx);
  });

  it('extracts multiple script blocks in document order', () => {
    const source = [
      '<script lang="ts">const setup = 1;</script>',
      '<script>const legacy = 2;</script>',
    ].join('\n');

    expect(extractScripts(source)).toEqual([
      { code: 'const setup = 1;', lang: Lang.TypeScript },
      { code: 'const legacy = 2;', lang: Lang.JavaScript },
    ]);
  });

  it('yields empty code for an empty script block', () => {
    expect(extractScripts('<script></script>')).toEqual([
      { code: '', lang: Lang.JavaScript },
    ]);
  });

  it('returns an empty array when there are no script blocks', () => {
    expect(extractScripts('<template><div /></template>')).toEqual([]);
  });

  it('extracts scripts from surrounding markup', () => {
    const source = [
      '<template><ul><li /></ul></template>',
      '<script setup lang="ts">const items = [];</script>',
    ].join('\n');

    expect(extractScripts(source)).toEqual([
      { code: 'const items = [];', lang: Lang.TypeScript },
    ]);
  });
});
