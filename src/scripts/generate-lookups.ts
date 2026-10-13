import { writeFile } from 'node:fs/promises';
import { features } from 'web-features';
import { createCssLookups } from '../detection/css.js';
import { CSS_RULES } from '../detection/css-rules.js';
import type { CssLookups } from '../detection/css.js';
import type { DetectorLang } from '../detection/detector.js';
import type { JsLookups } from '../detection/javascript.js';
import { JAVASCRIPT_RULES } from '../detection/javascript-rules.js';

const OUTPUT = new URL('../lookups.ts', import.meta.url);

// Groups in `css.types.<group>.<name>` paths where each `<name>` is a CSS
// function, e.g. `color-mix` in `css.types.color.color-mix`.
const CSS_FUNCTION_GROUPS = new Set([
  'basic-shape',
  'color',
  'easing-function',
  'filter-function',
  'gradient',
  'image',
  'transform-function',
]);

// Groups in `css.types.<group>.<name>` paths where each `<name>` is a unit,
// e.g. `rem` in `css.types.length.rem`.
const CSS_UNIT_GROUPS = new Set(['angle', 'length', 'resolution']);

// `css.types.<name>` paths which are value types rather than functions, but
// share their name with a function belonging to a different feature.
const CSS_NON_FUNCTION_TYPES = new Set(['shape', 'url']);

// Compat keys which are real CSS identifiers, as opposed to descriptive
// subfeature keys such as `multicol_context`.
const CSS_IDENT = /^-?[a-zA-Z][a-zA-Z0-9-]*$/;

const upsertMap = <TKey, TValue>(
  map: Map<TKey, TValue>,
  key: TKey,
  defaultValue: TValue,
): TValue => {
  let existing = map.get(key);
  if (!existing) {
    existing = defaultValue;
    map.set(key, existing);
  }
  return existing;
};

function addJsCompat(
  lookups: JsLookups,
  leaf: string[],
  featureId: string,
): void {
  const [type, member, extra] = leaf;
  if (type && !member) {
    upsertMap(lookups.globals, type, featureId);
  } else if (type && member && !extra) {
    const memberMap = upsertMap(
      lookups.members,
      type,
      new Map<string, string>(),
    );
    upsertMap(memberMap, member, featureId);
  }
}

function addCssCompat(
  lookups: CssLookups,
  path: string[],
  featureId: string,
): void {
  // CSS identifiers are ASCII case-insensitive, so lookups are keyed in lower
  // case, e.g. `currentColor` is stored as `currentcolor`.
  const [category, name, subfeature, extra] = path.map((segment) =>
    segment.toLowerCase(),
  );
  if (!name || extra) return;
  if (subfeature !== undefined && !CSS_IDENT.test(subfeature)) return;

  switch (category) {
    case 'properties':
      if (subfeature) {
        const keywords = upsertMap(
          lookups.propertyKeywords,
          name,
          new Map<string, string>(),
        );
        upsertMap(keywords, subfeature, featureId);
      } else {
        upsertMap(lookups.properties, name, featureId);
      }
      break;
    case 'selectors':
      if (!subfeature) upsertMap(lookups.selectors, name, featureId);
      break;
    case 'at-rules':
      if (subfeature) {
        const descriptors = upsertMap(
          lookups.atRuleDescriptors,
          name,
          new Map<string, string>(),
        );
        upsertMap(descriptors, subfeature, featureId);
      } else {
        upsertMap(lookups.atRules, name, featureId);
      }
      break;
    case 'types':
      if (!subfeature) {
        if (
          !CSS_FUNCTION_GROUPS.has(name) &&
          !CSS_NON_FUNCTION_TYPES.has(name)
        ) {
          upsertMap(lookups.functions, name, featureId);
        }
      } else if (name === 'global_keywords') {
        upsertMap(lookups.globalKeywords, subfeature, featureId);
      } else if (CSS_FUNCTION_GROUPS.has(name)) {
        upsertMap(lookups.functions, subfeature, featureId);
      } else if (CSS_UNIT_GROUPS.has(name)) {
        upsertMap(lookups.units, subfeature, featureId);
      }
      break;
  }
}

type BaselineStatus = 'high' | 'low' | false;

interface Lookups {
  js: JsLookups;
  css: CssLookups;
  // [lang, compat path, feature id] for compat paths with a hand-written rule
  ruleFeatures: [DetectorLang, string, string][];
  // feature id -> [baseline status, baseline low year]
  statuses: Map<string, [BaselineStatus, number | null]>;
}

function buildLookups(): Lookups {
  const lookups: Lookups = {
    js: { globals: new Map(), members: new Map() },
    css: createCssLookups(),
    ruleFeatures: [],
    statuses: new Map(),
  };

  for (const [featureId, feature] of Object.entries(features)) {
    if (feature.kind !== 'feature') continue;

    const { baseline, baseline_low_date } = feature.status;
    const year =
      baseline !== false && baseline_low_date
        ? Number(baseline_low_date.slice(0, 4))
        : null;
    lookups.statuses.set(featureId, [baseline as BaselineStatus, year]);

    if (!feature.compat_features) continue;

    for (const compatPath of feature.compat_features) {
      const segments = compatPath.split('.');
      const rest = segments.slice(1).join('.');

      if (segments[0] === 'api') {
        // api.* paths, e.g. `api.fetch`.
        addJsCompat(lookups.js, segments.slice(1), featureId);
      } else if (segments[0] === 'javascript' && segments[1] === 'builtins') {
        // javascript.builtins.* paths, e.g. `javascript.builtins.Promise`.
        addJsCompat(lookups.js, segments.slice(2), featureId);
      } else if (segments[0] === 'javascript') {
        if (JAVASCRIPT_RULES.has(rest)) {
          lookups.ruleFeatures.push(['js', rest, featureId]);
        }
      } else if (segments[0] === 'css') {
        if (CSS_RULES.has(rest)) {
          lookups.ruleFeatures.push(['css', rest, featureId]);
        } else {
          addCssCompat(lookups.css, segments.slice(1), featureId);
        }
      }
    }
  }

  return lookups;
}

function serialize(value: unknown): string {
  if (value instanceof Map) {
    const entries = [...value].map(
      ([key, entry]) => `[${serialize(key)}, ${serialize(entry)}]`,
    );
    return `new Map([${entries.join(', ')}])`;
  }
  if (Array.isArray(value)) {
    return `[${value.map(serialize).join(', ')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).map(
      ([key, entry]) => `${key}: ${serialize(entry)}`,
    );
    return `{ ${entries.join(', ')} }`;
  }
  return JSON.stringify(value);
}

const { js, css, ruleFeatures, statuses } = buildLookups();

const output = `// Generated by scripts/generate-lookups.ts from web-features. Do not edit.
// Regenerate with: npm run generate

import type { CssLookups } from './detection/css.js';
import type { DetectorLang } from './detection/detector.js';
import type { JsLookups } from './detection/javascript.js';
import type { BaselineStatus } from './types.js';

export const js: JsLookups = ${serialize(js)};

export const css: CssLookups = ${serialize(css)};

// [lang, compat path, feature id] for compat paths with a hand-written rule
export const ruleFeatures: [DetectorLang, string, string][] = ${serialize(ruleFeatures)};

// feature id -> [baseline status, baseline low year]
export const statuses = new Map<string, [BaselineStatus, number | null]>(${serialize([...statuses])});
`;

await writeFile(OUTPUT, output);
