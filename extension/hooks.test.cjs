const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { installHooks } = require('./hooks.cjs');

test('project hook registration preserves other handlers and forwards UTF-8 stdin from a spaced path', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'mindtrace hook '));
  try {
    const cli = path.join(workspace, 'record turn.mjs');
    await writeFile(cli, "import { readFileSync } from 'node:fs'; console.log(JSON.stringify({ args: process.argv.slice(2), event: JSON.parse(readFileSync(0, 'utf8')) }));");
    const existing = {
      description: 'Project configuration',
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'other-hook' }] }],
        SessionStart: [{ matcher: 'resume', hooks: [{ type: 'command', command: 'resume-hook' }] }],
      },
    };
    await mkdir(path.join(workspace, '.codex'));
    const file = path.join(workspace, '.codex', 'hooks.json');
    await writeFile(file, JSON.stringify(existing));
    const options = { node: process.execPath, cli };

    assert.equal((await installHooks(workspace, options)).changed, true);
    assert.equal((await installHooks(workspace, options)).changed, false);
    const config = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(config.description, existing.description);
    assert.deepEqual(config.hooks.SessionStart, existing.hooks.SessionStart);
    assert.deepEqual(config.hooks.Stop[0], existing.hooks.Stop[0]);
    assert.equal(config.hooks.Stop.length, 2);
    assert.equal(config.hooks.PostToolUse.length, 1);
    assert.equal(config.hooks.UserPromptSubmit.length, 1);

    const handler = config.hooks.Stop[1].hooks[0];
    const event = { prompt: '把首页换成场次表' };
    const child = process.platform === 'win32'
      ? spawnSync('cmd.exe', ['/D', '/C', `"${handler.commandWindows}"`], {
        input: JSON.stringify(event),
        encoding: 'utf8',
        windowsVerbatimArguments: true,
      })
      : spawnSync('/bin/sh', ['-c', handler.command], { input: JSON.stringify(event), encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), { args: ['hook', '--workspace', workspace], event });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
