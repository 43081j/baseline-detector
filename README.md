# baseline-detector

Detects the [Baseline](https://web.dev/baseline) target of a project based on its source code.

`baseline-detector` statically analyses the JavaScript/TypeScript sources in a project, maps the web platform features it uses to their [`web-features`](https://github.com/web-platform-dx/web-features) Baseline status, and reports the overall Baseline target the project requires.

## Install

```sh
npm install baseline-detector
```

TypeScript is an optional peer dependency. When it is available, type information is used to improve detection accuracy.

## Usage

```ts
import {
  detectFeatures,
  detectBaselineTarget,
  detectBaselineYear,
} from 'baseline-detector';

const target = await detectBaselineTarget();
console.log(target); // e.g. 'low'

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

By default the project in the current working directory is analysed. Pass a `cwd` to point elsewhere:

```ts
await detectBaselineTarget({ cwd: '/path/to/project' });
```

Source files are discovered from the directory's `tsconfig.json` `rootDir` (falling back to the `cwd`), respecting `.gitignore`.

### API

| Export | Description |
| --- | --- |
| `detectFeatures(options?)` | Resolves to a `Map<string, Set<string>>` of feature IDs detected per file. |
| `detectBaselineTarget(options?)` | Resolves to the project's overall `BaselineStatus` (`'high'`, `'low'`, or `false`). |
| `detectBaselineYear(options?)` | Resolves to the newest Baseline year the project targets, or `null`. |

## License

MIT
