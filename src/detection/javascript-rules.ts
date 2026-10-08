import type { Rule } from '@ast-grep/napi';

export const JAVASCRIPT_RULES = new Map<string, Rule>([
  ['operators.optional_chaining', { kind: 'optional_chain' }],
  ['operators.nullish_coalescing', { pattern: '$A ?? $B' }],
  ['operators.nullish_coalescing_assignment', { pattern: '$A ??= $B' }],
  ['operators.logical_or_assignment', { pattern: '$A ||= $B' }],
  ['operators.logical_and_assignment', { pattern: '$A &&= $B' }],
  ['operators.exponentiation', { pattern: '$A ** $B' }],
  ['operators.spread', { kind: 'spread_element' }],
  [
    'operators.destructuring',
    { any: [{ kind: 'object_pattern' }, { kind: 'array_pattern' }] },
  ],
  ['operators.await', { kind: 'await_expression' }],
  ['functions.arrow_functions', { kind: 'arrow_function' }],
  ['classes.private_class_fields', { kind: 'private_property_identifier' }],
  ['grammar.template_literals', { kind: 'template_string' }],
  ['statements.for_await_of', { pattern: 'for await ($A of $B) $C' }],
  ['operators.exponentiation_assignment', { pattern: '$A **= $B' }],
  ['statements.generator_function', { pattern: 'function* $F($$$A) { $$$B }' }],
  ['operators.generator_function', { pattern: 'function* ($$$A) { $$$B }' }],
  [
    'statements.async_generator_function',
    { pattern: 'async function* $F($$$A) { $$$B }' },
  ],
  [
    'operators.async_generator_function',
    { pattern: 'async function* ($$$A) { $$$B }' },
  ],
  ['operators.import', { pattern: 'import($$$A)' }],
  ['operators.import_meta', { pattern: 'import.meta' }],
  ['operators.new_target', { pattern: 'new.target' }],
  [
    'statements.try_catch.optional_catch_binding',
    { pattern: 'try { $$$A } catch { $$$B }' },
  ],
  ['classes.static.initialization_blocks', { kind: 'class_static_block' }],
  [
    'classes.private_class_methods',
    {
      kind: 'method_definition',
      has: { field: 'name', kind: 'private_property_identifier' },
    },
  ],
  ['grammar.numeric_separators', { kind: 'number', regex: '_' }],
  ['grammar.hashbang_comments', { kind: 'hash_bang_line' }],
  ['statements.const', { kind: 'lexical_declaration' }],
  [
    'statements.import.import_attributes.type_json',
    { kind: 'import_attribute', regex: 'json' },
  ],
  [
    'statements.import.import_attributes.type_css',
    { kind: 'import_attribute', regex: 'css' },
  ],
  [
    'statements.import.import_attributes.type_text',
    { kind: 'import_attribute', regex: 'text' },
  ],
]);
