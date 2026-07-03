import { parse, Lang } from '@ast-grep/napi';
import type { Rule } from '@ast-grep/napi';
import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import ignore from 'ignore';
import { features } from 'web-features';

export interface DetectOptions {
  cwd?: string;
}

const SYNTAX_RULES: Record<string, Rule> = {
  'operators.optional_chaining': { kind: 'optional_chain' },
  'operators.nullish_coalescing': { pattern: '$A ?? $B' },
  'operators.nullish_coalescing_assignment': { pattern: '$A ??= $B' },
  'operators.logical_or_assignment': { pattern: '$A ||= $B' },
  'operators.logical_and_assignment': { pattern: '$A &&= $B' },
  'operators.exponentiation': { pattern: '$A ** $B' },
  'operators.spread': { kind: 'spread_element' },
  'operators.destructuring': {
    any: [{ kind: 'object_pattern' }, { kind: 'array_pattern' }],
  },
  'operators.await': { kind: 'await_expression' },
  'functions.arrow_functions': { kind: 'arrow_function' },
  'classes.private_class_fields': { kind: 'private_property_identifier' },
  'grammar.template_literals': { kind: 'template_string' },
  'statements.for_await_of': { pattern: 'for await ($A of $B) $C' },
};

interface DetectionMaps {
  globals: Map<string, string>;
  syntax: Map<string, Rule>;
  members: Map<string, Map<string, string>>;
}

const upsertMap = <TKey, TValue>(
  map: Map<TKey, TValue>,
  key: TKey,
  defaultValue: TValue,
): TValue => {
  let existing = map.get(key);
  if (!existing) {
    existing = defaultValue;
    map.set(key, existing);
  }
  return existing;
};

function mergeRules(existing: Rule, addition: Rule): Rule {
  const alternatives = existing.any ? [...existing.any] : [existing];
  alternatives.push(addition);
  return { any: alternatives };
}

export function buildDetectionMaps(): DetectionMaps {
  const globals = new Map<string, string>();
  const syntax = new Map<string, Rule>();
  const members = new Map<string, Map<string, string>>();

  const addMember = (
    receiverType: string,
    member: string,
    featureId: string,
  ): void => {
    upsertMap(upsertMap(members, receiverType, new Map()), member, featureId);
  };
  const addSyntax = (featureId: string, rule: Rule): void => {
    const existing = syntax.get(featureId);
    syntax.set(featureId, existing ? mergeRules(existing, rule) : rule);
  };

  for (const [featureId, feature] of Object.entries(features)) {
    if (!('compat_features' in feature) || !feature.compat_features) continue;

    for (const compatPath of feature.compat_features) {
      const segments = compatPath.split('.');
      const namespace = segments[0];

      // api.*, assume its a global API
      if (namespace === 'api' && segments.length === 2) {
        const globalName = segments[1];
        if (globalName) {
          upsertMap(globals, globalName, featureId);
        }
        continue;
      }

      // api.*.*, assume its a member of a global API
      if (namespace === 'api' && segments.length === 3) {
        const receiverType = segments[1];
        const member = segments[2];
        if (receiverType && member) addMember(receiverType, member, featureId);
        continue;
      }

      if (namespace === 'javascript' && segments[1] === 'builtins') {
        const builtin = segments[2];
        const member = segments[3];
        // javascript.builtins.*, assume its a global builtin
        if (builtin && segments.length === 3) {
          upsertMap(globals, builtin, featureId);
          // javascript.builtins.*.*, assume its a member of a builtin
        } else if (builtin && member) {
          addMember(builtin, member, featureId);
        }
        continue;
      }

      // javascript.<suffix>, probably a syntax feature
      if (namespace === 'javascript') {
        const rule = SYNTAX_RULES[segments.slice(1).join('.')];
        if (rule) addSyntax(featureId, rule);
      }
    }
  }

  return { globals, syntax, members };
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

export async function detect(options?: DetectOptions): Promise<void> {
  const cwd = options?.cwd ?? process.cwd();
  const files = await getSourceFiles(cwd);

  for (const file of files) {
    // oxlint-disable-next-line no-await-in-loop
    const source = await readFile(file, 'utf8');
    const root = parse(langForFile(file), source).root();

    // TODO: walk `root` to detect web-features usage in this file and
    // accumulate results per file for the final report.
    void root;
  }
}
