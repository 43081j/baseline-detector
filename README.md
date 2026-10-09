# baseline-detector

Detects the [Baseline](https://web.dev/baseline) target of a project based on its source code.

`baseline-detector` statically analyses the JavaScript/TypeScript sources in a project, maps the web platform features it uses to their [`web-features`](https://github.com/web-platform-dx/web-features) Baseline status, and reports the overall Baseline target the project requires.

## Install

```sh
npm install baseline-detector
```

TypeScript is an optional peer dependency. When it is available, type information is used to improve detection accuracy.

## Usage as a CLI

```sh
npx baseline-detector target
# high

npx baseline-detector year
# 2023

npx baseline-detector features
# /code/foo.ts
#   async-await
#   let-const
```

## Usage

```ts
import {
  detectFeatures,
  detectBaselineTarget,
  detectBaselineYear,
} from 'baseline-detector';

const target = await detectBaselineTarget();
console.log(target); // e.g. { status: 'low', reason: 'array-flat' }

// The Baseline year the project targets (newest feature it relies on),
// or null if any feature is not yet Baseline.
const year = await detectBaselineYear();
console.log(year); // e.g. 2023

// The raw features detected, grouped by file.
const features = await detectFeatures();
for (const [file, ids] of features) {
  console.log(file, [...ids]);
}
```

If you already have the result of `detectFeatures`, the `*ForFeatures` variants compute the target and year from it without analysing the sources again:

```ts
import {
  detectFeatures,
  detectBaselineTargetForFeatures,
  detectBaselineYearForFeatures,
} from 'baseline-detector';

const features = await detectFeatures();
const target = detectBaselineTargetForFeatures(features);
const year = detectBaselineYearForFeatures(features);
```

To analyse a single in-memory source instead of a project, use the `*ForSource` variants:

```ts
import {
  detectFeaturesForSource,
  detectBaselineTargetForSource,
  detectBaselineYearForSource,
} from 'baseline-detector';

const source = 'const x = a ?? b;';
const features = detectFeaturesForSource(source, { fileName: 'input.js' });
const target = detectBaselineTargetForSource(source);
const year = detectBaselineYearForSource(source);
```

These run without type information by default, so member usages like `arr.toSorted()` are not detected. If you already have a TypeScript program that contains the file (for example, inside a typed ESLint rule), pass it as `typescriptContext`:

```ts
const features = detectFeaturesForSource(source, {
  fileName: '/path/to/project/src/input.ts',
  typescriptContext: { ts, program, checker: program.getTypeChecker() },
});
```

The file is looked up in the program by `fileName`, so it must match the path the program uses.

By default the project in the current working directory is analysed. Pass a `cwd` to point elsewhere:

```ts
await detectBaselineTarget({ cwd: '/path/to/project' });
```

Source files are discovered from the directory's `tsconfig.json` `rootDir` (falling back to the `cwd`), respecting `.gitignore`.

### API

| Export | Description |
| --- | --- |
| `detectFeatures(options?)` | Resolves to a `Map<string, Set<string>>` of feature IDs detected per file. Pass `options.typescriptContext` (`{ ts, program, checker }`) to reuse an existing TypeScript program instead of creating one. |
| `detectFeaturesForSource(source, options?)` | As `detectFeatures`, but for a single in-memory source. `options.fileName` (default `'<source>'`) keys the result and picks the language by extension. `options.typescriptContext` (`{ ts, program, checker }`) enables type information for a file in that program; without it, member usages like `arr.toSorted()` are not detected. |
| `detectBaselineTarget(options?)` | Resolves to a `BaselineTarget`, `{ status, reason }`, where `status` is the project's overall `BaselineStatus` (`'high'`, `'low'`, or `false`) and `reason` is the feature ID that determined it (`null` when `status` is `'high'`). |
| `detectBaselineYear(options?)` | Resolves to the newest Baseline year the project targets, or `null`. |
| `detectBaselineTargetForFeatures(features)` | As `detectBaselineTarget`, but computed from an already detected `Map<string, Set<string>>` of features. |
| `detectBaselineYearForFeatures(features)` | As `detectBaselineYear`, but computed from an already detected `Map<string, Set<string>>` of features. |
| `detectBaselineTargetForSource(source, options?)` | As `detectBaselineTarget`, but computed from a single in-memory source. Takes the same options as `detectFeaturesForSource`. |
| `detectBaselineYearForSource(source, options?)` | As `detectBaselineYear`, but computed from a single in-memory source. Takes the same options as `detectFeaturesForSource`. |

## License

MIT
