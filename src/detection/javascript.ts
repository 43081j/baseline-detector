import { isGlobalBinding, nodeAt, typeNames } from '../typescript.js';
import { rangeOf, type Detector } from './detector.js';
import { isGuarded } from './guards/javascript.js';

export interface JsLookups {
  // global name -> feature id
  globals: Map<string, string>;
  // type name -> instance member name -> feature id
  members: Map<string, Map<string, string>>;
  // type name -> static member name -> feature id
  statics: Map<string, Map<string, string>>;
}

export function createJsDetectors({
  globals,
  members,
  statics,
}: JsLookups): Detector[] {
  return [
    // find all identifiers that are globals matching features
    {
      lang: 'js',
      rule: { kind: 'identifier' },
      visit: (node, emit, types) => {
        const nodeText = node.text();
        const featureId = globals.get(nodeText);
        if (
          featureId &&
          (!types || isGlobalBinding(types, node)) &&
          !isGuarded(node, nodeText)
        ) {
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

        const { checker } = types;
        const type = checker.getTypeAtLocation(parent.expression);
        // We have to check if the type is from the prototype or not since
        // the lookup distinguishes them
        const prototype = type.getConstructSignatures().length
          ? type.getProperty('prototype')
          : undefined;
        const lookup = prototype ? statics : members;
        const receiver = prototype ? checker.getTypeOfSymbol(prototype) : type;
        const member = property.text();
        for (const name of typeNames(checker, receiver)) {
          const featureId = lookup.get(name)?.get(member);
          if (featureId) {
            emit(featureId, rangeOf(property));
            return;
          }
        }
      },
    },
  ];
}
