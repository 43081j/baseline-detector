import { Lang } from '@ast-grep/napi';
import { features } from 'web-features';
import {
  CSS_FUNCTION_GROUPS,
  CSS_NON_FUNCTION_TYPES,
  CSS_RULES,
  CSS_UNIT_GROUPS,
  createCssDetectors,
  createCssLookups,
} from './detection/css.js';
import type { CssLookups } from './detection/css.js';
import type { Detector, DetectorLang } from './detection/detector.js';
import { SYNTAX_RULES, createJsDetectors } from './detection/javascript.js';
import type { JsLookups } from './detection/javascript.js';

export type { Detector, DetectorLang } from './detection/detector.js';

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

// Compat keys which are real CSS identifiers, as opposed to descriptive
// subfeature keys such as `multicol_context`.
const CSS_IDENT = /^-?[a-zA-Z][a-zA-Z0-9-]*$/;

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

function createDetectors(): Detector[] {
  const detectors: Detector[] = [];
  const js: JsLookups = { globals: new Map(), members: new Map() };
  const css = createCssLookups();

  for (const [featureId, feature] of Object.entries(features)) {
    if (feature.kind !== 'feature' || !feature.compat_features) continue;

    for (const compatPath of feature.compat_features) {
      const segments = compatPath.split('.');

      if (segments[0] === 'api') {
        // api.* paths, e.g. `api.fetch`.
        addJsCompat(js, segments.slice(1), featureId);
      } else if (segments[0] === 'javascript' && segments[1] === 'builtins') {
        // javascript.builtins.* paths, e.g. `javascript.builtins.Promise`.
        addJsCompat(js, segments.slice(2), featureId);
      } else if (segments[0] === 'javascript') {
        const rule = SYNTAX_RULES.get(segments.slice(1).join('.'));
        if (rule)
          detectors.push({
            lang: 'js',
            rule,
            visit: (_node, emit) => emit(featureId),
          });
      } else if (segments[0] === 'css') {
        const rule = CSS_RULES.get(segments.slice(1).join('.'));
        if (rule) {
          detectors.push({
            lang: 'css',
            rule,
            visit: (_node, emit) => emit(featureId),
          });
        } else {
          addCssCompat(css, segments.slice(1), featureId);
        }
      }
    }
  }

  detectors.push(...createJsDetectors(js), ...createCssDetectors(css));
  return detectors;
}

export const detectors = createDetectors();

export function detectorLang(lang: Lang): DetectorLang {
  return lang === Lang.Css ? 'css' : 'js';
}
