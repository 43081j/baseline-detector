import { parse, Lang } from '@ast-grep/napi';
import type { Rule, SgNode } from '@ast-grep/napi';
import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import ignore from 'ignore';
import { features } from 'web-features';
import type * as TS from 'typescript';

export interface DetectOptions {
  cwd?: string;
}

type TypeScript = typeof import('typescript');

function loadTypeScript(cwd: string): TypeScript | null {
  try {
    const projectRequire = createRequire(path.join(cwd, 'package.json'));
    return projectRequire('typescript') as TypeScript;
  } catch {
    return null;
  }
}

const SYNTAX_RULES = new Map<string, Rule>([
  ['operators.optional_chaining', { kind: 'optional_chain' }],
  ['operators.nullish_coalescing', { pattern: '$A ?? $B' }],
  ['operators.nullish_coalescing_assignment', { pattern: '$A ??= $B' }],
  ['operators.logical_or_assignment', { pattern: '$A ||= $B' }],
  ['operators.logical_and_assignment', { pattern: '$A &&= $B' }],
  ['operators.exponentiation', { pattern: '$A ** $B' }],
  ['operators.spread', { kind: 'spread_element' }],
  [
    'operators.destructuring',
    { any: [{ kind: 'object_pattern' }, { kind: 'array_pattern' }] },
  ],
  ['operators.await', { kind: 'await_expression' }],
  ['functions.arrow_functions', { kind: 'arrow_function' }],
  ['classes.private_class_fields', { kind: 'private_property_identifier' }],
  ['grammar.template_literals', { kind: 'template_string' }],
  ['statements.for_await_of', { pattern: 'for await ($A of $B) $C' }],
  ['operators.exponentiation_assignment', { pattern: '$A **= $B' }],
  ['statements.generator_function', { pattern: 'function* $F($$$A) { $$$B }' }],
  ['operators.generator_function', { pattern: 'function* ($$$A) { $$$B }' }],
  [
    'statements.async_generator_function',
    { pattern: 'async function* $F($$$A) { $$$B }' },
  ],
  [
    'operators.async_generator_function',
    { pattern: 'async function* ($$$A) { $$$B }' },
  ],
  ['operators.import', { pattern: 'import($$$A)' }],
  ['operators.import_meta', { pattern: 'import.meta' }],
  ['operators.new_target', { pattern: 'new.target' }],
  [
    'statements.try_catch.optional_catch_binding',
    { pattern: 'try { $$$A } catch { $$$B }' },
  ],
  ['classes.static.initialization_blocks', { kind: 'class_static_block' }],
  [
    'classes.private_class_methods',
    {
      kind: 'method_definition',
      has: { field: 'name', kind: 'private_property_identifier' },
    },
  ],
  ['grammar.numeric_separators', { kind: 'number', regex: '_' }],
]);

interface TypeScriptContext {
  ts: TypeScript;
  program: TS.Program;
  checker: TS.TypeChecker;
}

interface TypeContext extends TypeScriptContext {
  sourceFile: TS.SourceFile;
}

interface Detector {
  rule: Rule;
  visit(
    node: SgNode,
    emit: (featureId: string) => void,
    types: TypeContext | null,
  ): void;
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

function typeNames(checker: TS.TypeChecker, type: TS.Type): Set<string> {
  const names = new Set<string>();
  const add = (name: string | undefined): void => {
    if (!name) return;
    names.add(name);
    if (name.endsWith('Constructor')) {
      names.add(name.slice(0, -'Constructor'.length));
    }
  };

  const constituents = type.isUnionOrIntersection() ? type.types : [type];
  for (const constituent of constituents) {
    add((constituent.getSymbol() ?? constituent.aliasSymbol)?.getName());
    const baseTypes = (
      constituent as Partial<TS.InterfaceType>
    ).getBaseTypes?.();
    for (const base of baseTypes ?? []) {
      add((base.getSymbol() ?? base.aliasSymbol)?.getName());
    }
    const apparent = checker.getApparentType(constituent);
    if (apparent !== constituent) {
      add((apparent.getSymbol() ?? apparent.aliasSymbol)?.getName());
    }
  }
  return names;
}

function nodeAt(sourceFile: TS.SourceFile, pos: number): TS.Node {
  let deepest: TS.Node = sourceFile;
  const visit = (node: TS.Node): void => {
    if (pos >= node.getStart(sourceFile) && pos < node.getEnd()) {
      deepest = node;
      node.forEachChild(visit);
    }
  };
  sourceFile.forEachChild(visit);
  return deepest;
}

function isGlobalBinding(types: TypeContext, node: SgNode): boolean {
  const target = nodeAt(types.sourceFile, node.range().start.index);
  const declarations =
    types.checker.getSymbolAtLocation(target)?.getDeclarations() ?? [];
  if (declarations.length === 0) return true;
  return declarations.some((declaration) => {
    const declaredIn = declaration.getSourceFile();
    return (
      declaredIn.isDeclarationFile && !types.ts.isExternalModule(declaredIn)
    );
  });
}

function createDetectors(): Detector[] {
  const detectors: Detector[] = [];
  const globals = new Map<string, string>();
  const members = new Map<string, Map<string, string>>();

  for (const [featureId, feature] of Object.entries(features)) {
    if (!feature.compat_features) continue;

    for (const compatPath of feature.compat_features) {
      const segments = compatPath.split('.');

      let leaf: string[] | null = null;
      if (segments[0] === 'api') {
        // api.* paths, e.g. `api.fetch`.
        leaf = segments.slice(1);
      } else if (segments[0] === 'javascript' && segments[1] === 'builtins') {
        // javascript.builtins.* paths, e.g. `javascript.builtins.Promise`.
        leaf = segments.slice(2);
      }

      if (leaf) {
        const [type, member, extra] = leaf;
        if (type && !member) {
          upsertMap(globals, type, featureId);
        } else if (type && member && !extra) {
          const memberMap = upsertMap(members, type, new Map());
          upsertMap(memberMap, member, featureId);
        }
        continue;
      }

      if (segments[0] === 'javascript') {
        const rule = SYNTAX_RULES.get(segments.slice(1).join('.'));
        if (rule)
          detectors.push({ rule, visit: (_node, emit) => emit(featureId) });
      }
    }
  }

  // find all identifiers that are globals matching features
  detectors.push({
    rule: { kind: 'identifier' },
    visit: (node, emit, types) => {
      const featureId = globals.get(node.text());
      if (featureId && (!types || isGlobalBinding(types, node))) {
        emit(featureId);
      }
    },
  });

  // find all member expressions that match features
  detectors.push({
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
          emit(featureId);
          return;
        }
      }
    },
  });

  return detectors;
}

const detectors = createDetectors();

function createProgram(
  ts: TypeScript,
  cwd: string,
  files: string[],
): TS.Program {
  let options: TS.CompilerOptions = {
    allowJs: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.esnext.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    skipLibCheck: true,
    noEmit: true,
    allowNonTsExtensions: true,
  };

  const configPath = ts.findConfigFile(cwd, ts.sys.fileExists, 'tsconfig.json');
  if (configPath) {
    const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(
      config,
      ts.sys,
      path.dirname(configPath),
      undefined,
      configPath,
    );
    options = {
      ...parsed.options,
      allowJs: true,
      noEmit: true,
      skipLibCheck: true,
    };
  }

  return ts.createProgram(files, options);
}

function createTypeScriptContext(
  cwd: string,
  files: string[],
): TypeScriptContext | null {
  const ts = loadTypeScript(cwd);
  if (!ts) return null;
  const program = createProgram(ts, cwd, files);
  return { ts, program, checker: program.getTypeChecker() };
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

export async function detect(
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

  // TODO: turn the per-file feature map into the final baseline report.
  return results;
}
