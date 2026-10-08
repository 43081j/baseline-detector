import type { Rule, SgNode } from '@ast-grep/napi';
import type { TypeContext } from '../typescript.js';

// Note that `js` means ts, js, tsx, jsx
export type DetectorLang = 'js' | 'css';

export interface Detector {
  lang: DetectorLang;
  rule: Rule;
  visit(
    node: SgNode,
    emit: (featureId: string) => void,
    types: TypeContext | null,
  ): void;
}
