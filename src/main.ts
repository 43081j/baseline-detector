import { parse, Lang } from '@ast-grep/napi';
import type { SgNode } from '@ast-grep/napi';
import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import ignore from 'ignore';
import { features } from 'web-features';
import { createTypeScriptContext } from './typescript.js';
import type { TypeContext } from './typescript.js';
import { detectors } from './detectors.js';
import { extractScripts } from './html.js';

export interface DetectOptions {
  cwd?: string;
}

export interface DetectSourceOptions {
  fileName?: string;
}

// high = widely available, low = newly available, false = limited availability
export type BaselineStatus = 'high' | 'low' | false;

export interface BaselineTarget {
  status: BaselineStatus;
  // The feature that determined the status
  reason: string | null;
}

const SOURCE_GLOBS = [
  '**/*.js',
  '**/*.jsx',
  '**/*.mjs',
  '**/*.cjs',
  '**/*.ts',
  '**/*.mts',
  '**/*.cts',
  '**/*.tsx',
  '**/*.vue',
  '**/*.svelte',
];

// Files whose JavaScript lives inside `<script>` blocks rather than being the
// whole file. Their scripts aren't part of the TypeScript program, so they're
// analysed without type information.
const EMBEDDED_SCRIPT_EXTENSIONS = new Set(['.vue', '.svelte']);

function hasEmbeddedScripts(file: string): boolean {
  return EMBEDDED_SCRIPT_EXTENSIONS.has(path.extname(file));
}

function langForFile(file: string): Lang {
  switch (path.extname(file)) {
    case '.ts':
    case '.mts':
    case '.cts':
      return Lang.TypeScript;
    case '.tsx':
      return Lang.Tsx;
    default:
      return Lang.JavaScript;
  }
}

async function inferSourceDir(cwd: string): Promise<string> {
  try {
    const config: { compilerOptions?: { rootDir?: unknown } } = JSON.parse(
      await readFile(path.join(cwd, 'tsconfig.json'), 'utf8'),
    );
    const rootDir = config.compilerOptions?.rootDir;
    if (typeof rootDir === 'string') {
      return path.resolve(cwd, rootDir);
    }
  } catch {
    // couldn't find it, fall back to cwd
  }
  return cwd;
}

async function getSourceFiles(cwd: string): Promise<string[]> {
  const dir = await inferSourceDir(cwd);
  const ignorer = ignore().add(['node_modules', '.git']);

  try {
    ignorer.add(await readFile(path.join(cwd, '.gitignore'), 'utf8'));
  } catch {
    // no .gitignore, forget about it
  }

  const files: string[] = [];
  for await (const rel of glob(SOURCE_GLOBS, {
    cwd: dir,
    exclude: (name) =>
      ignorer.ignores(path.relative(cwd, path.resolve(dir, name))),
  })) {
    files.push(path.resolve(dir, rel));
  }
  return files;
}

function runDetectors(
  root: SgNode,
  types: TypeContext | null,
  emit: (featureId: string) => void,
): void {
  for (const { rule, visit } of detectors) {
    for (const node of root.findAll({ rule })) {
      visit(node, emit, types);
    }
  }
}

function detectInFile(
  file: string,
  source: string,
  types: TypeContext | null,
): Set<string> {
  const found = new Set<string>();
  const emit = (featureId: string): void => {
    found.add(featureId);
  };

  if (hasEmbeddedScripts(file)) {
    for (const script of extractScripts(source)) {
      runDetectors(parse(script.lang, script.code).root(), null, emit);
    }
  } else {
    runDetectors(parse(langForFile(file), source).root(), types, emit);
  }
  return found;
}

export function detectFeaturesForSource(
  source: string,
  options?: DetectSourceOptions,
): Map<string, Set<string>> {
  const fileName = options?.fileName ?? '<source>';
  const found = detectInFile(fileName, source, null);
  return found.size > 0 ? new Map([[fileName, found]]) : new Map();
}

export async function detectFeatures(
  options?: DetectOptions,
): Promise<Map<string, Set<string>>> {
  const cwd = options?.cwd ?? process.cwd();
  const files = await getSourceFiles(cwd);

  const baseContext = createTypeScriptContext(
    cwd,
    files.filter((file) => !hasEmbeddedScripts(file)),
  );

  const results = new Map<string, Set<string>>();
  for (const file of files) {
    // oxlint-disable-next-line no-await-in-loop
    const source = await readFile(file, 'utf8');

    const sourceFile = hasEmbeddedScripts(file)
      ? undefined
      : baseContext?.program.getSourceFile(file);
    const types: TypeContext | null =
      baseContext && sourceFile ? { ...baseContext, sourceFile } : null;
    const found = detectInFile(file, source, types);

    if (found.size > 0) {
      results.set(file, found);
    }
  }

  return results;
}

function collectFeatureIds(input: Map<string, Set<string>>): Set<string> {
  const all = new Set<string>();
  for (const ids of input.values()) {
    for (const id of ids) {
      all.add(id);
    }
  }
  return all;
}

function baselineStatusOf(featureId: string): BaselineStatus | null {
  const feature = features[featureId];
  if (!feature || feature.kind !== 'feature') return null;
  return feature.status.baseline;
}

export function detectBaselineTargetForFeatures(
  input: Map<string, Set<string>>,
): BaselineTarget {
  const ids = collectFeatureIds(input);

  let target: BaselineTarget = { status: 'high', reason: null };
  for (const id of ids) {
    const status = baselineStatusOf(id);
    if (status === false) return { status: false, reason: id };
    if (status === 'low') target = { status: 'low', reason: id };
  }
  return target;
}

export function detectBaselineTargetForSource(
  source: string,
  options?: DetectSourceOptions,
): BaselineTarget {
  const result = detectFeaturesForSource(source, options);
  const target = detectBaselineTargetForFeatures(result);
  return target;
}

export async function detectBaselineTarget(
  options?: DetectOptions,
): Promise<BaselineTarget> {
  const result = await detectFeatures(options);
  const target = detectBaselineTargetForFeatures(result);
  return target;
}

export function detectBaselineYearForFeatures(
  input: Map<string, Set<string>>,
): number | null {
  const ids = collectFeatureIds(input);

  let year: number | null = null;
  for (const id of ids) {
    const feature = features[id];
    const status =
      feature && feature.kind === 'feature' ? feature.status : undefined;
    if (!status || status.baseline === false || !status.baseline_low_date) {
      return null;
    }
    const featureYear = Number(status.baseline_low_date.slice(0, 4));
    if (year === null || featureYear > year) {
      year = featureYear;
    }
  }
  return year;
}

export function detectBaselineYearForSource(
  source: string,
  options?: DetectSourceOptions,
): number | null {
  const result = detectFeaturesForSource(source, options);
  const year = detectBaselineYearForFeatures(result);
  return year;
}

export async function detectBaselineYear(
  options?: DetectOptions,
): Promise<number | null> {
  const result = await detectFeatures(options);
  const year = detectBaselineYearForFeatures(result);
  return year;
}
