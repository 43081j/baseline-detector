import type { Rule } from '@ast-grep/napi';

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
