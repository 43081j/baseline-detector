import { isGlobalBinding, nodeAt, typeNames } from '../typescript.js';
import { rangeOf, type Detector } from './detector.js';

export interface JsLookups {
  // global name -> feature id
  globals: Map<string, string>;
  // type name -> member name -> feature id
  members: Map<string, Map<string, string>>;
}

export function createJsDetectors({ globals, members }: JsLookups): Detector[] {
  return [
    // find all identifiers that are globals matching features
    {
      lang: 'js',
      rule: { kind: 'identifier' },
      visit: (node, emit, types) => {
        const featureId = globals.get(node.text());
        if (featureId && (!types || isGlobalBinding(types, node))) {
          emit(featureId, rangeOf(node));
        }
      },
    },
    // find all member expressions that match features
    {
      lang: 'js',
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
            emit(featureId, rangeOf(property));
            return;
          }
        }
      },
    },
  ];
}
