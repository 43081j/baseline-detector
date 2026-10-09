import type { TypeScriptContext } from './typescript.js';

export interface DetectOptions {
  cwd?: string;
}

export interface DetectSourceOptions {
  fileName?: string;
  typescriptContext?: TypeScriptContext;
}

// high = widely available, low = newly available, false = limited availability
export type BaselineStatus = 'high' | 'low' | false;

export interface BaselineTarget {
  status: BaselineStatus;
  // The feature that determined the status
  reason: string | null;
}

export type Range = [number, number];

export interface Feature {
  id: string;
  ranges: Set<Range>;
}

export type FeatureMap = Map<string, Set<Feature>>;
