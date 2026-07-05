import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { expect, it } from 'vitest';
import { features } from 'web-features';
import { SYNTAX_RULES } from './detectors.js';
import { detectFeatures } from './main.js';

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
