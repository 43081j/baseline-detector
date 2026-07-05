import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { features } from 'web-features';
import { SYNTAX_RULES } from './detectors.js';
import {
  detectBaselineTarget,
  detectBaselineYear,
  detectFeatures,
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
