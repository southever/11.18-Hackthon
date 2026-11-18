import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const extension = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(extension);
const manifest = JSON.parse(await readFile(path.join(extension, 'package.json'), 'utf8'));
const { scripts, devDependencies, ...packagedManifest } = manifest;
const output = path.join(root, 'artifacts', `${manifest.name}-${manifest.version}.vsix`);
const stage = await mkdtemp(path.join(tmpdir(), 'mindtrace-vsix-'));
const vsce = path.join(extension, 'node_modules', '@vscode', 'vsce', 'vsce');

try {
  await Promise.all([
    ...['extension.cjs', 'hooks.cjs', 'icon.svg', 'README.md'].map(name =>
      cp(path.join(extension, name), path.join(stage, name))),
    cp(path.join(root, 'scripts', 'browser-server.cjs'), path.join(stage, 'browser-server.cjs')),
    cp(path.join(root, 'core'), path.join(stage, 'core'), {
      recursive: true,
      filter: file => !/(?:^|[\\/])(?:node_modules|tests?)(?:[\\/]|$)|\.test\.mjs$/.test(file),
    }),
    cp(path.join(root, 'web', 'dist'), path.join(stage, 'web'), { recursive: true }),
    cp(path.join(root, 'demo', 'replay.json'), path.join(stage, 'demo', 'replay.json')),
    cp(path.join(root, 'demo', 'previews'), path.join(stage, 'demo', 'previews'), { recursive: true }),
    writeFile(path.join(stage, 'package.json'), JSON.stringify(packagedManifest, null, 2) + '\n'),
    mkdir(path.dirname(output), { recursive: true }),
  ]);
  const result = spawnSync(process.execPath, [
    vsce, 'package', '--no-dependencies', '--skip-license', '--out', output,
  ], { cwd: stage, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(stage, { recursive: true, force: true });
}
