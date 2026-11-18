const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const events = ['UserPromptSubmit', 'PostToolUse', 'Stop'];
const statusMessage = '脉络 MindTrace 正在记录';

function quoteShellArgument(value) {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

function createHandler(node, cli, workspace) {
  const args = [node, cli, 'hook', '--workspace', workspace];
  const command = args.map(quoteShellArgument).join(' ');
  const handler = { type: 'command', command, timeout: 15, statusMessage };

  if (process.platform === 'win32') {
    const quoted = args.map(value => "'" + value.replace(/'/g, "''") + "'");
    const script = '& ' + quoted.join(' ') + '; exit $LASTEXITCODE';
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    // Codex transports this command through cmd.exe /C. Keep its arguments
    // free of nested quotes, even when Windows paths contain spaces or %.
    handler.commandWindows = 'powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ' + encoded;
  }
  return handler;
}

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

async function installHooks(workspace, { node, cli }) {
  const directory = path.join(workspace, '.codex');
  const file = path.join(directory, 'hooks.json');
  let existing = '';
  try {
    existing = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  let config = {};
  if (existing) {
    try {
      config = JSON.parse(existing.replace(/^\uFEFF/, ''));
    } catch {
      throw new Error('.codex/hooks.json 包含无效的 JSON，请修正后重新启用记录。');
    }
  }
  if (!isObject(config) || (config.hooks !== undefined && !isObject(config.hooks))) {
    throw new Error('.codex/hooks.json 的 hooks 配置须为对象。');
  }
  config.hooks ??= {};
  const handler = createHandler(node, cli, workspace);
  let changed = false;

  for (const event of events) {
    const groups = config.hooks[event] ?? [];
    if (!Array.isArray(groups) || groups.some(group => !Array.isArray(group?.hooks))) {
      throw new Error(`.codex/hooks.json 的 ${event} 配置格式无效。`);
    }
    const registered = groups
      .flatMap(group => group.hooks)
      .filter(item => item?.statusMessage === statusMessage);
    if (registered.length === 1 && JSON.stringify(registered[0]) === JSON.stringify(handler)) {
      continue;
    }
    config.hooks[event] = groups.flatMap(group => {
      const hooks = group.hooks.filter(item => item?.statusMessage !== statusMessage);
      if (hooks.length === group.hooks.length) return [group];
      return hooks.length ? [{ ...group, hooks }] : [];
    });
    config.hooks[event].push({ hooks: [handler] });
    changed = true;
  }

  if (changed) {
    await fs.mkdir(directory, { recursive: true });
    const tempFile = path.join(directory, `hooks.${randomUUID()}.tmp`);
    try {
      await fs.writeFile(tempFile, JSON.stringify(config, null, 2) + '\n', { flag: 'wx' });
      await fs.rename(tempFile, file);
    } finally {
      await fs.rm(tempFile, { force: true });
    }
  }
  return { file, changed };
}

module.exports = { installHooks };

if (require.main === module) {
  const [, , workspace, cli = path.resolve(__dirname, '..', 'core', 'cli.mjs')] = process.argv;
  if (!workspace) {
    console.error('Usage: node extension/hooks.cjs WORKSPACE [PATH_TO_CORE_CLI]');
    process.exitCode = 2;
  } else {
    installHooks(path.resolve(workspace), { node: process.execPath, cli: path.resolve(cli) })
      .then(result => console.log(JSON.stringify(result)))
      .catch(error => {
        console.error(error.message);
        process.exitCode = 1;
      });
  }
}
