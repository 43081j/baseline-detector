import { parseArgs } from 'node:util';
import {
  detectFeatures,
  detectBaselineTarget,
  detectBaselineYear,
} from './main.js';
import type { DetectOptions } from './main.js';

const USAGE = `Usage: baseline-detector <command> [options]

Commands:
  target     Detect the overall baseline target (high, low or limited)
  year       Detect the baseline year the project targets
  features   List the detected features grouped by file

Options:
  -c, --cwd <dir>   Directory to analyse (default: current directory)
  -h, --help        Show this help
`;

async function runTarget(options: DetectOptions): Promise<void> {
  const { status, reason } = await detectBaselineTarget(options);
  const label = status === false ? 'limited' : status;
  console.log(reason === null ? label : `${label} (${reason})`);
}

async function runYear(options: DetectOptions): Promise<void> {
  const year = await detectBaselineYear(options);
  console.log(year === null ? 'unknown' : String(year));
}

async function runFeatures(options: DetectOptions): Promise<void> {
  const byFile = await detectFeatures(options);
  if (byFile.size === 0) {
    console.log('No features detected.');
    return;
  }
  for (const [file, ids] of byFile) {
    console.log(file);
    for (const id of ids) {
      console.log(`  ${id}`);
    }
  }
}

export async function run(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      cwd: { type: 'string', short: 'c' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  const command = positionals[0];

  if (values.help || command === undefined) {
    console.log(USAGE);
    return values.help ? 0 : 1;
  }

  const options: DetectOptions = {};
  if (values.cwd !== undefined) {
    options.cwd = values.cwd;
  }

  switch (command) {
    case 'target':
      await runTarget(options);
      return 0;
    case 'year':
      await runYear(options);
      return 0;
    case 'features':
      await runFeatures(options);
      return 0;
    default:
      console.error(`Unknown command: ${command}\n`);
      console.error(USAGE);
      return 1;
  }
}
