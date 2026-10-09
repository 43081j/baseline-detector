import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { features } from 'web-features';
import { SYNTAX_RULES } from './detectors.js';
import {
  detectBaselineTarget,
  detectBaselineTargetForFeatures,
  detectBaselineTargetForSource,
  detectBaselineYear,
  detectBaselineYearForFeatures,
  detectBaselineYearForSource,
  detectFeatures,
  detectFeaturesForSource,
} from './main.js';

// Features we don't detect, usually because they don't have a baseline date
const KNOWN_UNDETECTED = new Set([
  'arguments-callee', // deprecated `arguments.callee`; no baseline
  'import-assertions', // deprecated `assert {}` syntax, superseded by `with`; no baseline
  'top-level-await', // needs "await outside any function" analysis; no baseline date
  'unicode-point-escapes', // lives inside string-literal contents
]);

function isDetected(compatFeatures: string[]): boolean {
  return compatFeatures.some(
    (compatPath) =>
      compatPath.startsWith('api.') ||
      compatPath.startsWith('javascript.builtins.') ||
      (compatPath.startsWith('javascript.') &&
        SYNTAX_RULES.has(compatPath.slice('javascript.'.length))),
  );
}

it('detects every JS-relevant web-feature except the known exceptions', () => {
  const undetected: string[] = [];
  for (const [id, feature] of Object.entries(features)) {
    if (feature.kind !== 'feature') continue;
    const compat = feature.compat_features;
    if (!compat) continue;
    const jsRelevant = compat.some(
      (compatPath: string) =>
        compatPath.startsWith('api.') || compatPath.startsWith('javascript.'),
    );
    if (jsRelevant && !isDetected(compat)) undetected.push(id);
  }

  expect(undetected.sort()).toEqual([...KNOWN_UNDETECTED].sort());
});

const FIXTURES = ['js', 'ts', 'vue', 'svelte'];
const fixturesDir = fileURLToPath(new URL('../test/fixtures', import.meta.url));

// Writes the given files (keyed by relative path) into a project directory.
async function writeProject(
  dir: string,
  files: Record<string, string>,
): Promise<void> {
  await Promise.all(
    Object.entries(files).map(([name, content]) =>
      writeFile(path.join(dir, name), content),
    ),
  );
}

// Reduces the file-keyed result to a basename -> sorted feature ids map so the
// absolute temp paths don't need to appear in assertions.
function byFile(result: Map<string, Set<string>>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [file, ids] of result) {
    out[path.basename(file)] = [...ids].sort();
  }
  return out;
}

function findGlobalFeature(
  baseline: 'low' | false,
): { id: string; global: string; year: number | null } | null {
  const globals = new Map<string, string>();
  for (const [id, feature] of Object.entries(features)) {
    if (feature.kind !== 'feature' || !feature.compat_features) continue;
    for (const compatPath of feature.compat_features) {
      const segments = compatPath.split('.');
      let name: string | undefined;
      if (segments[0] === 'api' && segments.length === 2) {
        name = segments[1];
      } else if (
        segments[0] === 'javascript' &&
        segments[1] === 'builtins' &&
        segments.length === 3
      ) {
        name = segments[2];
      }
      if (name && !globals.has(name)) globals.set(name, id);
    }
  }

  for (const [global, id] of globals) {
    const feature = features[id];
    if (!feature || feature.kind !== 'feature') continue;
    if (feature.status.baseline !== baseline) continue;
    const lowDate = feature.status.baseline_low_date;
    return { id, global, year: lowDate ? Number(lowDate.slice(0, 4)) : null };
  }
  return null;
}

const lowFeature = findGlobalFeature('low');
const limitedFeature = findGlobalFeature(false);

describe('detectFeatures', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'baseline-detector-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it.each(FIXTURES)('detects features in the %s fixture', async (name) => {
    const cwd = path.join(fixturesDir, name);
    const result = await detectFeatures({ cwd });

    const normalized = [...result]
      .map(([file, ids]): [string, string[]] => [
        path.relative(cwd, file),
        [...ids].sort(),
      ])
      .sort(([a], [b]) => a.localeCompare(b));

    expect(Object.fromEntries(normalized)).toMatchSnapshot();
  });

  it('keys results by absolute file path', async () => {
    const cwd = path.join(fixturesDir, 'js');
    const keys = [...(await detectFeatures({ cwd })).keys()];
    expect(keys).toEqual([path.join(cwd, 'index.js')]);
    expect(keys.every((key) => path.isAbsolute(key))).toBe(true);
  });

  it('omits files with no detected features', async () => {
    await writeProject(dir, { 'plain.js': 'var a = 1; a + b;' });
    expect((await detectFeatures({ cwd: dir })).size).toBe(0);
  });

  it('aggregates features from every source file', async () => {
    await writeProject(dir, {
      'a.js': 'fetch("/a");',
      'b.js': 'const x = a ?? b;',
    });
    expect(byFile(await detectFeatures({ cwd: dir }))).toEqual({
      'a.js': ['fetch'],
      'b.js': ['let-const', 'nullish-coalescing'],
    });
  });

  it('skips files matched by .gitignore', async () => {
    await writeProject(dir, {
      'used.js': 'fetch("/x");',
      'skip.js': 'structuredClone(x);',
      '.gitignore': 'skip.js\n',
    });
    expect(byFile(await detectFeatures({ cwd: dir }))).toEqual({
      'used.js': ['fetch'],
    });
  });
});

describe('detectFeaturesForSource', () => {
  it('detects features in an in-memory source', () => {
    const result = detectFeaturesForSource('x = a ?? b;');
    expect(byFile(result)).toEqual({
      '<source>': ['nullish-coalescing'],
    });
  });

  it('keys the result by the given file name', () => {
    const result = detectFeaturesForSource('x = a ?? b;', {
      fileName: 'bundle.js',
    });
    expect([...result.keys()]).toEqual(['bundle.js']);
  });

  it('parses using the language implied by the file name', () => {
    const result = detectFeaturesForSource('const x = a as string;', {
      fileName: 'input.ts',
    });
    expect(byFile(result)['input.ts']).toContain('let-const');
  });

  it('detects features in embedded scripts', () => {
    const result = detectFeaturesForSource('<script>x = a ?? b;</script>', {
      fileName: 'App.vue',
    });
    expect(byFile(result)).toEqual({ 'App.vue': ['nullish-coalescing'] });
  });

  it('returns an empty map when nothing is detected', () => {
    const result = detectFeaturesForSource('x = 1;');
    expect(result.size).toBe(0);
  });
});

describe('detectFeaturesForSource with typescriptContext', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'baseline-detector-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('detects member features using the given program', async () => {
    const source = 'export const v = Promise.withResolvers<number>();';
    const fileName = path.join(dir, 'b.ts');
    await writeFile(fileName, source);
    const program = ts.createProgram([fileName], {
      lib: ['lib.esnext.d.ts'],
      noEmit: true,
    });

    const typescriptContext = {
      ts,
      program,
      checker: program.getTypeChecker(),
    };

    const withTypes = detectFeaturesForSource(source, {
      fileName,
      typescriptContext,
    });
    const withoutTypes = detectFeaturesForSource(source, { fileName });

    expect(byFile(withTypes)['b.ts']).toContain('promise-withresolvers');
    expect(byFile(withoutTypes)['b.ts']).not.toContain('promise-withresolvers');
  });
});

describe('detectBaselineTarget', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'baseline-detector-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('is high with no reason when only widely available features are used', async () => {
    const cwd = path.join(fixturesDir, 'js');
    expect(await detectBaselineTarget({ cwd })).toEqual({
      status: 'high',
      reason: null,
    });
  });

  it('defaults to high when nothing is detected', async () => {
    await writeProject(dir, { 'plain.js': 'var a = 1;' });
    expect(await detectBaselineTarget({ cwd: dir })).toEqual({
      status: 'high',
      reason: null,
    });
  });

  it.skipIf(!lowFeature)(
    'is low with the responsible feature when a newly available feature is used',
    async () => {
      await writeProject(dir, { 'index.js': `${lowFeature!.global};` });
      expect(await detectBaselineTarget({ cwd: dir })).toEqual({
        status: 'low',
        reason: lowFeature!.id,
      });
    },
  );

  it.skipIf(!limitedFeature)(
    'is false with the responsible feature when a limited availability feature is used',
    async () => {
      await writeProject(dir, { 'index.js': `${limitedFeature!.global};` });
      expect(await detectBaselineTarget({ cwd: dir })).toEqual({
        status: false,
        reason: limitedFeature!.id,
      });
    },
  );
});

describe('detectBaselineYear', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'baseline-detector-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns the latest baseline year among detected features', async () => {
    const cwd = path.join(fixturesDir, 'js');
    expect(await detectBaselineYear({ cwd })).toBe(2020);
  });

  it('takes the maximum year across features', async () => {
    await writeProject(dir, {
      'old.js': 'const x = a ?? b;',
      'new.js': 'structuredClone(x);',
    });
    expect(await detectBaselineYear({ cwd: dir })).toBe(2022);
  });

  it.skipIf(!lowFeature)(
    'returns the year of a newly available feature',
    async () => {
      await writeProject(dir, { 'index.js': `${lowFeature!.global};` });
      expect(await detectBaselineYear({ cwd: dir })).toBe(lowFeature!.year);
    },
  );

  it('returns null when no features are detected', async () => {
    await writeProject(dir, { 'plain.js': 'var a = 1;' });
    expect(await detectBaselineYear({ cwd: dir })).toBeNull();
  });

  it.skipIf(!limitedFeature)(
    'returns null when a limited availability feature is used',
    async () => {
      await writeProject(dir, { 'index.js': `${limitedFeature!.global};` });
      expect(await detectBaselineYear({ cwd: dir })).toBeNull();
    },
  );
});

describe('detectBaselineTargetForFeatures', () => {
  it('defaults to high when given no features', () => {
    expect(detectBaselineTargetForFeatures(new Map())).toEqual({
      status: 'high',
      reason: null,
    });
  });

  it('is high with no reason when every feature is widely available', () => {
    const input = new Map([
      ['a.js', new Set(['fetch'])],
      ['b.js', new Set(['nullish-coalescing', 'structured-clone'])],
    ]);
    expect(detectBaselineTargetForFeatures(input)).toEqual({
      status: 'high',
      reason: null,
    });
  });

  it('ignores unknown feature ids', () => {
    const input = new Map([['a.js', new Set(['fetch', 'not-a-real-feature'])]]);
    expect(detectBaselineTargetForFeatures(input)).toEqual({
      status: 'high',
      reason: null,
    });
  });

  it.skipIf(!lowFeature)(
    'is low with the responsible feature when a newly available feature is present',
    () => {
      const input = new Map([['a.js', new Set(['fetch', lowFeature!.id])]]);
      expect(detectBaselineTargetForFeatures(input)).toEqual({
        status: 'low',
        reason: lowFeature!.id,
      });
    },
  );

  it.skipIf(!limitedFeature)(
    'is false with the responsible feature when a limited availability feature is present',
    () => {
      const input = new Map([['a.js', new Set(['fetch', limitedFeature!.id])]]);
      expect(detectBaselineTargetForFeatures(input)).toEqual({
        status: false,
        reason: limitedFeature!.id,
      });
    },
  );

  it.skipIf(!lowFeature || !limitedFeature)(
    'prefers limited availability over newly available',
    () => {
      const input = new Map([
        ['a.js', new Set([lowFeature!.id])],
        ['b.js', new Set([limitedFeature!.id])],
      ]);
      expect(detectBaselineTargetForFeatures(input)).toEqual({
        status: false,
        reason: limitedFeature!.id,
      });
    },
  );
});

describe('detectBaselineYearForFeatures', () => {
  it('returns null when given no features', () => {
    expect(detectBaselineYearForFeatures(new Map())).toBeNull();
  });

  it('takes the maximum year across files', () => {
    const input = new Map([
      ['old.js', new Set(['nullish-coalescing'])],
      ['new.js', new Set(['structured-clone'])],
    ]);
    expect(detectBaselineYearForFeatures(input)).toBe(2022);
  });

  it('deduplicates features seen in multiple files', () => {
    const input = new Map([
      ['a.js', new Set(['nullish-coalescing'])],
      ['b.js', new Set(['nullish-coalescing'])],
    ]);
    expect(detectBaselineYearForFeatures(input)).toBe(2020);
  });

  it('returns null when a feature id is unknown', () => {
    const input = new Map([['a.js', new Set(['fetch', 'not-a-real-feature'])]]);
    expect(detectBaselineYearForFeatures(input)).toBeNull();
  });

  it.skipIf(!lowFeature)(
    'returns the year of a newly available feature',
    () => {
      const input = new Map([['a.js', new Set(['fetch', lowFeature!.id])]]);
      expect(detectBaselineYearForFeatures(input)).toBe(lowFeature!.year);
    },
  );

  it.skipIf(!limitedFeature)(
    'returns null when a limited availability feature is present',
    () => {
      const input = new Map([['a.js', new Set(['fetch', limitedFeature!.id])]]);
      expect(detectBaselineYearForFeatures(input)).toBeNull();
    },
  );
});

describe('detectBaselineTargetForSource', () => {
  it('defaults to high when nothing is detected', () => {
    expect(detectBaselineTargetForSource('x = 1;')).toEqual({
      status: 'high',
      reason: null,
    });
  });

  it.skipIf(!lowFeature)(
    'is low with the responsible feature when a newly available feature is used',
    () => {
      expect(detectBaselineTargetForSource(`${lowFeature!.global};`)).toEqual({
        status: 'low',
        reason: lowFeature!.id,
      });
    },
  );

  it.skipIf(!limitedFeature)(
    'is false with the responsible feature when a limited availability feature is used',
    () => {
      expect(
        detectBaselineTargetForSource(`${limitedFeature!.global};`),
      ).toEqual({
        status: false,
        reason: limitedFeature!.id,
      });
    },
  );

  it('respects the language implied by the file name', () => {
    expect(
      detectBaselineTargetForSource('<script>x = a ?? b;</script>', {
        fileName: 'App.vue',
      }),
    ).toEqual({ status: 'high', reason: null });
  });
});

describe('detectBaselineYearForSource', () => {
  it('returns the latest baseline year among detected features', () => {
    expect(detectBaselineYearForSource('x = a ?? b; structuredClone(x);')).toBe(
      2022,
    );
  });

  it('returns null when nothing is detected', () => {
    expect(detectBaselineYearForSource('x = 1;')).toBeNull();
  });

  it.skipIf(!limitedFeature)(
    'returns null when a limited availability feature is used',
    () => {
      expect(
        detectBaselineYearForSource(`${limitedFeature!.global};`),
      ).toBeNull();
    },
  );

  it('respects the language implied by the file name', () => {
    expect(
      detectBaselineYearForSource('<script>x = a ?? b;</script>', {
        fileName: 'App.vue',
      }),
    ).toBe(2020);
  });
});
