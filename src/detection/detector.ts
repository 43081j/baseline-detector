import type { Rule, SgNode } from '@ast-grep/napi';
import type { TypeContext } from '../typescript.js';
import type { Range } from '../types.js';

// Note that `js` means ts, js, tsx, jsx
export type DetectorLang = 'js' | 'css';

export type Emitter = (featureId: string, range: Range) => void;

export interface Detector {
  lang: DetectorLang;
  rule: Rule;
  visit(node: SgNode, emit: Emitter, types: TypeContext | null): void;
}

export function rangeOf(node: SgNode): Range {
  const r = node.range();
  return [r.start.index, r.end.index];
}
