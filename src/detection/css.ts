import type { Rule, SgNode } from '@ast-grep/napi';
import { rangeOf, type Detector } from './detector.js';

const AT_RULE: Rule = {
  any: [
    { kind: 'at_rule' },
    { kind: 'charset_statement' },
    { kind: 'import_statement' },
    { kind: 'keyframes_statement' },
    { kind: 'media_statement' },
    { kind: 'namespace_statement' },
    { kind: 'scope_statement' },
    { kind: 'supports_statement' },
  ],
};

// Grouping at-rules whose blocks hold rules and declarations rather than
// descriptors.
const GROUPING_AT_RULE: Rule = {
  any: [
    { kind: 'media_statement' },
    { kind: 'scope_statement' },
    { kind: 'supports_statement' },
    {
      kind: 'at_rule',
      has: {
        kind: 'at_keyword',
        regex: '(?i)^@(container|layer|starting-style)$',
      },
    },
  ],
};

// Declarations directly inside a non-grouping at-rule's block (e.g.
// `@font-face`) are descriptors rather than properties.
const DESCRIPTOR: Rule = {
  kind: 'declaration',
  inside: {
    kind: 'block',
    inside: { all: [AT_RULE, { not: GROUPING_AT_RULE }] },
  },
};

export interface CssLookups {
  // property name -> feature id
  properties: Map<string, string>;
  // property name -> value keyword -> feature id
  propertyKeywords: Map<string, Map<string, string>>;
  // keyword valid in any property -> feature id
  globalKeywords: Map<string, string>;
  // pseudo-class or pseudo-element name -> feature id
  selectors: Map<string, string>;
  // at-rule name -> feature id
  atRules: Map<string, string>;
  // at-rule name -> descriptor or media/container feature name -> feature id
  atRuleDescriptors: Map<string, Map<string, string>>;
  // function name -> feature id
  functions: Map<string, string>;
  // unit -> feature id
  units: Map<string, string>;
}

export function createCssLookups(): CssLookups {
  return {
    properties: new Map(),
    propertyKeywords: new Map(),
    globalKeywords: new Map(),
    selectors: new Map(),
    atRules: new Map(),
    atRuleDescriptors: new Map(),
    functions: new Map(),
    units: new Map(),
  };
}

// The text of a node in lower case, as lookup keys are case-insensitive.
function lowerText(node: SgNode): string {
  return node.text().toLowerCase();
}

// The name of an at-rule node without its `@`, e.g. `media`.
function atRuleName(node: SgNode): string | undefined {
  const keyword = node.child(0);
  return keyword ? lowerText(keyword).slice(1) : undefined;
}

// Detects nodes whose text is a key of `lookup`.
function lookupDetector(rule: Rule, lookup: Map<string, string>): Detector {
  return {
    lang: 'css',
    rule,
    visit: (node, emit) => {
      const featureId = lookup.get(lowerText(node));
      if (featureId) emit(featureId, rangeOf(node));
    },
  };
}

export function createCssDetectors(lookups: CssLookups): Detector[] {
  return [
    lookupDetector(
      {
        kind: 'property_name',
        inside: { kind: 'declaration', not: DESCRIPTOR },
      },
      lookups.properties,
    ),
    {
      lang: 'css',
      rule: { kind: 'declaration', not: DESCRIPTOR },
      visit: (node, emit) => {
        const property = node.child(0);
        if (property?.kind() !== 'property_name') return;

        const keywords = lookups.propertyKeywords.get(lowerText(property));
        // Property subfeatures may be keywords (`overflow: scroll`) or
        // functions (`animation-timeline: scroll()`).
        const values = node.findAll({
          rule: { any: [{ kind: 'plain_value' }, { kind: 'function_name' }] },
        });
        for (const value of values) {
          const text = lowerText(value);
          const featureId = keywords?.get(text);
          if (featureId) {
            emit(featureId, rangeOf(value));
          } else if (value.kind() === 'plain_value') {
            const globalFeatureId = lookups.globalKeywords.get(text);
            if (globalFeatureId) emit(globalFeatureId, rangeOf(value));
          }
        }
      },
    },
    {
      lang: 'css',
      rule: {
        any: [
          { kind: 'feature_name', inside: { ...AT_RULE, stopBy: 'end' } },
          { kind: 'property_name', inside: DESCRIPTOR },
        ],
      },
      visit: (node, emit) => {
        const atRule = node
          .ancestors()
          .find((ancestor) => ancestor.matches({ rule: AT_RULE }));
        if (!atRule) return;

        const name = atRuleName(atRule);
        if (!name) return;

        const descriptors = lookups.atRuleDescriptors.get(name);
        if (!descriptors) return;

        const text = lowerText(node);
        let featureId = descriptors.get(text);
        // Range media features such as `width` also accept `min-` and `max-`
        // prefixes, which have no compat keys of their own.
        if (!featureId && node.kind() === 'feature_name') {
          featureId = descriptors.get(text.replace(/^(min|max)-/, ''));
        }
        if (featureId) emit(featureId, rangeOf(node));
      },
    },
    lookupDetector(
      {
        any: [
          { kind: 'class_name', inside: { kind: 'pseudo_class_selector' } },
          {
            kind: 'tag_name',
            inside: { kind: 'pseudo_element_selector' },
            follows: { pattern: '::' },
          },
        ],
      },
      lookups.selectors,
    ),
    {
      lang: 'css',
      rule: AT_RULE,
      visit: (node, emit) => {
        const name = atRuleName(node);
        if (!name) return;

        const featureId = lookups.atRules.get(name);
        if (featureId) emit(featureId, rangeOf(node));
      },
    },
    lookupDetector({ kind: 'function_name' }, lookups.functions),
    lookupDetector({ kind: 'unit' }, lookups.units),
  ];
}
