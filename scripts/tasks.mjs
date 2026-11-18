import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const npm = process.env.npm_execpath;

function run(packageName, ...args) {
  const result = spawnSync(process.execPath, [npm, '--prefix', packageName, ...args], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

switch (process.argv[2]) {
  case 'setup':
    run('web', 'ci');
    run('extension', 'ci');
    break;
  case 'build':
    run('web', 'run', 'build');
    break;
  case 'package':
    run('web', 'run', 'build');
    run('extension', 'run', 'package');
    break;
  default:
    throw new Error('Use npm run setup, npm run build or npm run package.');
}
