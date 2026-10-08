import { Lang, type Rule } from '@ast-grep/napi';
import { createCssDetectors } from './detection/css.js';
import type { Detector, DetectorLang } from './detection/detector.js';
import { createJsDetectors } from './detection/javascript.js';
import { JAVASCRIPT_RULES } from './detection/javascript-rules.js';
import { CSS_RULES } from './detection/css-rules.js';
import { css, js, ruleFeatures } from './lookups.js';

export type { Detector, DetectorLang } from './detection/detector.js';

function getRulesForLang(lang: DetectorLang): Map<string, Rule> | null {
  switch (lang) {
    case 'css':
      return CSS_RULES;
    case 'js':
      return JAVASCRIPT_RULES;
    default:
      return null;
  }
}
function createDetectors(): Detector[] {
  const detectors: Detector[] = [];

  for (const [lang, compatPath, featureId] of ruleFeatures) {
    const rule = getRulesForLang(lang)?.get(compatPath);
    if (rule) {
      detectors.push({
        lang,
        rule,
        visit: (_node, emit) => emit(featureId),
      });
    }
  }

  detectors.push(...createJsDetectors(js), ...createCssDetectors(css));
  return detectors;
}

export const detectors = createDetectors();

export function detectorLang(lang: Lang): DetectorLang {
  return lang === Lang.Css ? 'css' : 'js';
}
