import path from 'node:path';
import { createRequire } from 'node:module';
import type { SgNode } from '@ast-grep/napi';
import type * as TS from 'typescript';

type TypeScript = typeof import('typescript');

export interface TypeScriptContext {
  ts: TypeScript;
  program: TS.Program;
  checker: TS.TypeChecker;
}

export interface TypeContext extends TypeScriptContext {
  sourceFile: TS.SourceFile;
}

function loadTypeScript(cwd: string): TypeScript | null {
  try {
    const projectRequire = createRequire(path.join(cwd, 'package.json'));
    return projectRequire('typescript') as TypeScript;
  } catch {
    return null;
  }
}

export function typeNames(checker: TS.TypeChecker, type: TS.Type): Set<string> {
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

export function nodeAt(sourceFile: TS.SourceFile, pos: number): TS.Node {
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

export function isGlobalBinding(types: TypeContext, node: SgNode): boolean {
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

export function createTypeScriptContext(
  cwd: string,
  files: string[],
): TypeScriptContext | null {
  const ts = loadTypeScript(cwd);
  if (!ts) return null;
  const program = createProgram(ts, cwd, files);
  return { ts, program, checker: program.getTypeChecker() };
}
