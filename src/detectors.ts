import type { Rule, SgNode } from '@ast-grep/napi';
import { features } from 'web-features';
import { isGlobalBinding, nodeAt, typeNames } from './typescript.js';
import type { TypeContext } from './typescript.js';

export const SYNTAX_RULES = new Map<string, Rule>([
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

export interface Detector {
  rule: Rule;
  visit(
    node: SgNode,
    emit: (featureId: string) => void,
    types: TypeContext | null,
  ): void;
}

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

function createDetectors(): Detector[] {
  const detectors: Detector[] = [];
  const globals = new Map<string, string>();
  const members = new Map<string, Map<string, string>>();

  for (const [featureId, feature] of Object.entries(features)) {
    if (feature.kind !== 'feature' || !feature.compat_features) continue;

    for (const compatPath of feature.compat_features) {
      const segments = compatPath.split('.');

      let leaf: string[] | null = null;
      if (segments[0] === 'api') {
        // api.* paths, e.g. `api.fetch`.
        leaf = segments.slice(1);
      } else if (segments[0] === 'javascript' && segments[1] === 'builtins') {
        // javascript.builtins.* paths, e.g. `javascript.builtins.Promise`.
        leaf = segments.slice(2);
      }

      if (leaf) {
        const [type, member, extra] = leaf;
        if (type && !member) {
          upsertMap(globals, type, featureId);
        } else if (type && member && !extra) {
          const memberMap = upsertMap(members, type, new Map());
          upsertMap(memberMap, member, featureId);
        }
        continue;
      }

      if (segments[0] === 'javascript') {
        const rule = SYNTAX_RULES.get(segments.slice(1).join('.'));
        if (rule)
          detectors.push({ rule, visit: (_node, emit) => emit(featureId) });
      }
    }
  }

  // find all identifiers that are globals matching features
  detectors.push({
    rule: { kind: 'identifier' },
    visit: (node, emit, types) => {
      const featureId = globals.get(node.text());
      if (featureId && (!types || isGlobalBinding(types, node))) {
        emit(featureId);
      }
    },
  });

  // find all member expressions that match features
  detectors.push({
    rule: { kind: 'member_expression' },
    visit: (node, emit, types) => {
      if (!types) return;
      const property = node.field('property');
      if (!property) return;

      const parent = nodeAt(
        types.sourceFile,
        property.range().start.index,
      ).parent;
      if (!parent || !types.ts.isPropertyAccessExpression(parent)) return;

      const type = types.checker.getTypeAtLocation(parent.expression);
      const member = property.text();
      for (const name of typeNames(types.checker, type)) {
        const featureId = members.get(name)?.get(member);
        if (featureId) {
          emit(featureId);
          return;
        }
      }
    },
  });

  return detectors;
}

export const detectors = createDetectors();
