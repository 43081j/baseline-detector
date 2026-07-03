import { parse, Lang } from '@ast-grep/napi';
import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import ignore from 'ignore';
import { features } from 'web-features';
import { createTypeScriptContext } from './typescript.js';
import type { TypeContext } from './typescript.js';
import { detectors } from './detectors.js';

export interface DetectOptions {
  cwd?: string;
}

// high = widely available, low = newly available, false = limited availability
export type BaselineStatus = 'high' | 'low' | false;

const SOURCE_GLOBS = [
  '**/*.js',
  '**/*.jsx',
  '**/*.mjs',
  '**/*.cjs',
  '**/*.ts',
  '**/*.mts',
  '**/*.cts',
  '**/*.tsx',
];

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

export async function detectFeatures(
  options?: DetectOptions,
): Promise<Map<string, Set<string>>> {
  const cwd = options?.cwd ?? process.cwd();
  const files = await getSourceFiles(cwd);

  const baseContext = createTypeScriptContext(cwd, files);

  const results = new Map<string, Set<string>>();
  for (const file of files) {
    // oxlint-disable-next-line no-await-in-loop
    const source = await readFile(file, 'utf8');
    const root = parse(langForFile(file), source).root();

    const sourceFile = baseContext?.program.getSourceFile(file);
    const types: TypeContext | null =
      baseContext && sourceFile ? { ...baseContext, sourceFile } : null;

    const found = new Set<string>();
    const emit = (featureId: string): void => {
      found.add(featureId);
    };
    for (const { rule, visit } of detectors) {
      for (const node of root.findAll({ rule })) {
        visit(node, emit, types);
      }
    }

    if (found.size > 0) {
      results.set(file, found);
    }
  }

  return results;
}

async function collectFeatureIds(
  options?: DetectOptions,
): Promise<Set<string>> {
  const byFile = await detectFeatures(options);
  const all = new Set<string>();
  for (const ids of byFile.values()) {
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

export async function detectBaselineTarget(
  options?: DetectOptions,
): Promise<BaselineStatus> {
  const ids = await collectFeatureIds(options);

  let target: BaselineStatus = 'high';
  for (const id of ids) {
    const status = baselineStatusOf(id);
    if (status === false) return false;
    if (status === 'low') target = 'low';
  }
  return target;
}

export async function detectBaselineYear(
  options?: DetectOptions,
): Promise<number | null> {
  const ids = await collectFeatureIds(options);

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
