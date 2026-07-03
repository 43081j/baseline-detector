import { parse, Lang } from '@ast-grep/napi';
import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import ignore from 'ignore';

export interface DetectOptions {
  cwd?: string;
}

const SOURCE_GLOBS = [
  '**/*.js',
  '**/*.jsx',
  '**/*.mjs',
  '**/*.cjs',
  '**/*.ts',
  '**/*.mts',
  '**/*.cts',
  '**/*.tsx'
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
      await readFile(path.join(cwd, 'tsconfig.json'), 'utf8')
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
    exclude: (name) => ignorer.ignores(path.relative(cwd, path.resolve(dir, name)))
  })) {
    files.push(path.resolve(dir, rel));
  }
  return files;
}

export async function detect(options?: DetectOptions): Promise<void> {
  const cwd = options?.cwd ?? process.cwd();
  const files = await getSourceFiles(cwd);

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const root = parse(langForFile(file), source).root();

    // TODO: walk `root` to detect web-features usage in this file and
    // accumulate results per file for the final report.
    void root;
  }
}
