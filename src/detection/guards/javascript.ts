import type { SgNode, NapiConfig, Rule } from '@ast-grep/napi';

const GLOBAL_OBJECTS = '^(globalThis|window|self)$';

const guardRule: Rule = {
  any: [
    { pattern: '$TARGET.$NAME' },
    { pattern: '$TARGET?.$NAME' },
    { pattern: '$NAME in $TARGET' },
    { pattern: 'Object.hasOwn($TARGET, $NAME)' },
    { pattern: 'Object.prototype.hasOwnProperty.apply($TARGET, [$NAME])' },
    { pattern: 'Object.prototype.hasOwnProperty.call($TARGET, $NAME)' },
  ],
};

const isGuardRule = (name: string): NapiConfig => ({
  rule: guardRule,
  constraints: {
    TARGET: { kind: 'identifier', regex: GLOBAL_OBJECTS },
    NAME: {
      any: [
        { kind: 'property_identifier', regex: `^${name}$` },
        {
          kind: 'string',
          has: { kind: 'string_fragment', regex: `^${name}$` },
        },
      ],
    },
  },
});

// True if `node`'s truthiness carries up to `root` unchanged
function isTruthyCheck(node: SgNode, root: SgNode): boolean {
  // The node itself is the condition, so it is truthy
  if (node.id() === root.id()) return true;
  for (const ancestor of node.ancestors()) {
    if (
      ancestor.is('unary_expression') ||
      ancestor.is('ternary_expression') ||
      ancestor.is('call_expression') ||
      (ancestor.is('binary_expression') &&
        ancestor.field('operator')?.text() !== '&&')
    ) {
      return false;
    }
    if (ancestor.id() === root.id()) return true;
  }
  return false;
}

export function isGuarded(node: SgNode, name: string): boolean {
  const rule = isGuardRule(name);
  let child = node;
  for (const ancestor of node.ancestors()) {
    // if (guard) { node }
    if (
      ancestor.is('if_statement') &&
      ancestor.field('consequence')?.id() === child.id()
    ) {
      const condition = ancestor.field('condition');
      // If the condition contains a guard for this name that ends up
      // truthy, then the node is guarded by that condition.
      if (
        condition
          ?.findAll(rule)
          .some((guard) => isTruthyCheck(guard, condition))
      ) {
        return true;
      }
    }
    // `guard && node`
    if (
      ancestor.is('binary_expression') &&
      ancestor.field('operator')?.text() === '&&' &&
      ancestor.field('right')?.id() === child.id()
    ) {
      const left = ancestor.field('left');
      if (left?.findAll(rule).some((guard) => isTruthyCheck(guard, left))) {
        return true;
      }
    }
    child = ancestor;
  }
  return false;
}
