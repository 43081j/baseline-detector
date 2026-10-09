import { parse, Lang } from '@ast-grep/napi';
import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import ignore from 'ignore';
import { createTypeScriptContext } from './typescript.js';
import type { TypeContext } from './typescript.js';
import { detectorLang, detectors } from './detectors.js';
import { type EmbeddedSource, extractEmbedded } from './embedded.js';
import { statuses } from './lookups.js';
import type {
  BaselineStatus,
  BaselineTarget,
  DetectOptions,
  DetectSourceOptions,
  Range,
  Feature,
  FeatureMap,
} from './types.js';
import type { Emitter } from './detection/detector.js';

export type * from './types.js';

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
  '**/*.html',
  '**/*.css',
];

// Files whose sources live inside `<script>` and `<style>` blocks rather than
// being the whole file. Their scripts aren't part of the TypeScript program, so
// they're analysed without type information.
const EMBEDDED_EXTENSIONS = new Set(['.vue', '.svelte', '.html']);

function isEmbedded(file: string): boolean {
  return EMBEDDED_EXTENSIONS.has(path.extname(file));
}

function langForFile(file: string): Lang {
  switch (path.extname(file)) {
    case '.ts':
    case '.mts':
    case '.cts':
      return Lang.TypeScript;
    case '.tsx':
      return Lang.Tsx;
    case '.css':
      return Lang.Css;
    default:
      return Lang.JavaScript;
  }
}

// Plain script files
function isScriptFile(file: string): boolean {
  return !isEmbedded(file) && langForFile(file) !== Lang.Css;
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
  lang: Lang,
  code: string,
  types: TypeContext | null,
  emit: Emitter,
): void {
  const root = parse(lang, code).root();
  const targetLang = detectorLang(lang);
  for (const detector of detectors) {
    if (detector.lang !== targetLang) continue;
    const { rule, visit } = detector;
    for (const node of root.findAll({ rule })) {
      visit(node, emit, types);
    }
  }
}

function emitEmbedded(embedded: EmbeddedSource, emit: Emitter): Emitter {
  return (featureId: string, range: Range): void => {
    const [start, end] = range;
    const [embeddedStart] = embedded.range;
    const adjustedRange: Range = [start + embeddedStart, end + embeddedStart];
    emit(featureId, adjustedRange);
  };
}

function detectInFile(
  file: string,
  source: string,
  types: TypeContext | null,
): Set<Feature> {
  const found = new Map<string, Map<string, Range>>();
  const emit: Emitter = (featureId, range) => {
    const rangeMap = found.get(featureId) ?? new Map<string, Range>();
    const rangeKey = `${range[0]}-${range[1]}`;
    rangeMap.set(rangeKey, range);
    found.set(featureId, rangeMap);
  };

  if (isEmbedded(file)) {
    for (const embedded of extractEmbedded(source)) {
      runDetectors(
        embedded.lang,
        embedded.code,
        null,
        emitEmbedded(embedded, emit),
      );
    }
  } else {
    runDetectors(langForFile(file), source, types, emit);
  }
  return new Set<Feature>(
    Array.from(found, ([id, rangeMap]) => ({
      id,
      ranges: new Set(
        [...rangeMap.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]),
      ),
    })),
  );
}

export function detectFeaturesForSource(
  source: string,
  options?: DetectSourceOptions,
): FeatureMap {
  const fileName = options?.fileName ?? '<source>';
  const context = options?.typescriptContext;
  const sourceFile = isScriptFile(fileName)
    ? context?.program.getSourceFile(fileName)
    : undefined;
  const types: TypeContext | null =
    context && sourceFile ? { ...context, sourceFile } : null;
  const found = detectInFile(fileName, source, types);
  return found.size > 0
    ? new Map<string, Set<Feature>>([[fileName, found]])
    : new Map();
}

export async function detectFeatures(
  options?: DetectOptions,
): Promise<FeatureMap> {
  const cwd = options?.cwd ?? process.cwd();
  const files = await getSourceFiles(cwd);

  const baseContext = createTypeScriptContext(cwd, files.filter(isScriptFile));

  const results = new Map<string, Set<Feature>>();
  for (const file of files) {
    // oxlint-disable-next-line no-await-in-loop
    const source = await readFile(file, 'utf8');

    const sourceFile = isScriptFile(file)
      ? baseContext?.program.getSourceFile(file)
      : undefined;
    const types: TypeContext | null =
      baseContext && sourceFile ? { ...baseContext, sourceFile } : null;
    const found = detectInFile(file, source, types);

    if (found.size > 0) {
      results.set(file, found);
    }
  }

  return results;
}

function collectFeatureIds(input: FeatureMap): Set<string> {
  const all = new Set<string>();
  for (const features of input.values()) {
    for (const feature of features) {
      all.add(feature.id);
    }
  }
  return all;
}

export function baselineStatusOf(featureId: string): BaselineStatus | null {
  return statuses.get(featureId)?.[0] ?? null;
}

export function yearOf(featureId: string): number | null {
  return statuses.get(featureId)?.[1] ?? null;
}

export function detectBaselineTargetForFeatures(
  input: FeatureMap,
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
  input: FeatureMap,
): number | null {
  const ids = collectFeatureIds(input);

  let year: number | null = null;
  for (const id of ids) {
    const featureYear = yearOf(id);
    if (!featureYear) return null;
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
