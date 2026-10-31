import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const buildDir = mkdtempSync(join(tmpdir(), 'capital-tracker-ui-build-'));
const binary = join(
  buildDir,
  process.platform === 'win32' ? 'capital-tracker.exe' : 'capital-tracker',
);
const outputRoot = join(root, 'test-results');
mkdirSync(outputRoot, { recursive: true });
const outputDir =
  process.env.CAPITAL_TRACKER_TEST_OUTPUT || join(outputRoot, 'latest');
let status = 1;
try {
  const build = spawnSync(
    'go',
    ['build', '-o', binary, './cmd/capital-tracker'],
    { cwd: root, stdio: 'inherit' },
  );
  if (build.error) throw build.error;
  if (build.status === 0) {
    const run = spawnSync(
      process.execPath,
      [
        resolve(root, 'node_modules/@playwright/test/cli.js'),
        'test',
        ...process.argv.slice(2),
      ],
      {
        cwd: root,
        stdio: 'inherit',
        env: {
          ...process.env,
          CAPITAL_TRACKER_TEST_BINARY: binary,
          CAPITAL_TRACKER_TEST_OUTPUT: outputDir,
        },
      },
    );
    if (run.error) throw run.error;
    status = run.status ?? 1;
  }
} finally {
  rmSync(buildDir, { recursive: true, force: true, maxRetries: 5 });
}
process.exitCode = status;
