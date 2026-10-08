import type { Rule, SgNode } from '@ast-grep/napi';
import type { Detector } from './detector.js';

// These are rules whose name alone doesn't detect their syntax.
// e.g. `selectors.nesting` doesn't match `nesting` as a keyword, but needs
// a special case rule to detect it.
export const CSS_RULES = new Map<string, Rule>([
  [
    'selectors.nesting',
    {
      any: [
        { kind: 'nesting_selector' },
        {
          kind: 'rule_set',
          inside: { kind: 'block', inside: { kind: 'rule_set' } },
        },
      ],
    },
  ],
  ['selectors.attribute', { kind: 'attribute_selector' }],
  ['selectors.child', { kind: 'child_selector' }],
  ['selectors.class', { kind: 'class_selector' }],
  ['selectors.descendant', { kind: 'descendant_selector' }],
  ['selectors.id', { kind: 'id_selector' }],
  ['selectors.next-sibling', { kind: 'adjacent_sibling_selector' }],
  ['selectors.subsequent-sibling', { kind: 'sibling_selector' }],
  ['selectors.universal', { kind: 'universal_selector' }],
  ['properties.custom-property', { kind: 'property_name', regex: '^--' }],
  [
    'types.color.rgb_hexadecimal_notation',
    { kind: 'color_value', regex: '^#' },
  ],
  [
    'types.color.rgb_hexadecimal_notation.alpha_hexadecimal_notation',
    { kind: 'color_value', regex: '^#([0-9a-fA-F]{4}|[0-9a-fA-F]{8})$' },
  ],
  [
    'types.length.container_query_length_units',
    { kind: 'unit', regex: '^cq(w|h|i|b|min|max)$' },
  ],
  [
    'types.length.viewport_percentage_units_dynamic',
    { kind: 'unit', regex: '^dv(w|h|i|b|min|max)$' },
  ],
  [
    'types.length.viewport_percentage_units_large',
    { kind: 'unit', regex: '^lv(w|h|i|b|min|max)$' },
  ],
  [
    'types.length.viewport_percentage_units_small',
    { kind: 'unit', regex: '^sv(w|h|i|b|min|max)$' },
  ],
]);

// Groups in `css.types.<group>.<name>` paths where each `<name>` is a CSS
// function, e.g. `color-mix` in `css.types.color.color-mix`.
export const CSS_FUNCTION_GROUPS = new Set([
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
export const CSS_UNIT_GROUPS = new Set(['angle', 'length', 'resolution']);

// `css.types.<name>` paths which are value types rather than functions, but
// share their name with a function belonging to a different feature.
export const CSS_NON_FUNCTION_TYPES = new Set(['shape', 'url']);

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
      if (featureId) emit(featureId);
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
            emit(featureId);
          } else if (value.kind() === 'plain_value') {
            const globalFeatureId = lookups.globalKeywords.get(text);
            if (globalFeatureId) emit(globalFeatureId);
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
        if (featureId) emit(featureId);
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
        if (featureId) emit(featureId);
      },
    },
    lookupDetector({ kind: 'function_name' }, lookups.functions),
    lookupDetector({ kind: 'unit' }, lookups.units),
  ];
}
