const { execFile } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { existsSync } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const vscode = require('vscode');
const { installHooks } = require('./hooks.cjs');

const exec = promisify(execFile);
const packaged = existsSync(path.join(__dirname, 'web', 'index.html'));
const root = packaged ? __dirname : path.dirname(__dirname);
const webDirectory = packaged ? path.join(root, 'web') : path.join(root, 'web', 'dist');
const demoDirectory = path.join(root, 'demo');
const cli = path.join(root, 'core', 'cli.mjs');
const pollInterval = 2500;
let selectedNode;
const organizing = new Set();

function activeProject() {
  const document = vscode.window.activeTextEditor?.document;
  const activeFolder = document && vscode.workspace.getWorkspaceFolder(document.uri);
  const folder = activeFolder ?? vscode.workspace.workspaceFolders?.[0];
  return folder?.uri.scheme === 'file' ? folder.uri : undefined;
}

function requireProject() {
  const project = activeProject();
  if (!project) throw new Error('请先在 VS Code 中打开本地项目文件夹。');
  if (!vscode.workspace.isTrusted) throw new Error('请先在 VS Code 中信任当前工作区。');
  return project;
}

async function nodePath() {
  const requested = vscode.workspace.getConfiguration('mailuo').get('nodePath', 'node');
  if (selectedNode?.requested === requested) return selectedNode.executable;
  let stdout;
  try {
    ({ stdout } = await exec(requested, ['-p', 'JSON.stringify([process.execPath, process.versions.node])'], {
      windowsHide: true,
      timeout: 5000,
    }));
  } catch {
    throw new Error('找不到外部 Node.js。请安装 Node.js 24，或在设置中填写 mailuo.nodePath。');
  }
  const [executable, version] = JSON.parse(stdout);
  if (Number(version.split('.')[0]) < 24) {
    throw new Error(`检测到 Node.js ${version}。请选择 Node.js 24 或更新版本。`);
  }
  selectedNode = { requested, executable };
  return executable;
}

async function readSnapshot(project) {
  const node = await nodePath();
  try {
    const { stdout } = await exec(node, [cli, 'snapshot', '--workspace', project.fsPath], {
      cwd: project.fsPath,
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
      timeout: 10000,
    });
    const snapshot = JSON.parse(stdout);
    if (snapshot.frames.some(frame => frame.state === 'pending' || frame.state === 'processing')) {
      organizePendingTurns(node, project);
    }
    return snapshot;
  } catch (error) {
    throw new Error('读取项目记忆失败。' + String(error.stderr || error.message).trim());
  }
}

function organizePendingTurns(node, project) {
  const workspace = project.fsPath;
  if (organizing.has(workspace)) return;
  organizing.add(workspace);
  exec(node, [cli, 'process', '--workspace', workspace], {
    cwd: workspace,
    windowsHide: true,
  }).catch(() => {}).finally(() => organizing.delete(workspace));
}

async function saveMarkdown(project, markdown) {
  if (!markdown?.trim()) throw new Error('项目已有整理结果后即可导出说明。');
  const destination = await vscode.window.showSaveDialog({
    defaultUri: project ? vscode.Uri.joinPath(project, '项目说明.md') : undefined,
    filters: { Markdown: ['md'] },
  });
  if (!destination) return;
  await vscode.workspace.fs.writeFile(destination, Buffer.from(markdown, 'utf8'));
  await vscode.window.showInformationMessage(`已导出 ${path.basename(destination.fsPath)}`);
}

async function readDemo(webview) {
  const data = JSON.parse(await fs.readFile(path.join(demoDirectory, 'replay.json'), 'utf8'));
  for (const frame of data.frames) {
    const previewPath = frame.preview?.url.replace(/^\.?\//, '');
    if (previewPath?.startsWith('demo/previews/')) {
      const file = vscode.Uri.file(path.join(demoDirectory, previewPath.slice('demo/'.length)));
      frame.preview.url = webview.asWebviewUri(file).toString();
    }
  }
  return data;
}

async function renderWebview(webview) {
  const nonce = randomBytes(18).toString('base64');
  const policy = [
    "default-src 'none'",
    `script-src ${webview.cspSource} 'nonce-${nonce}'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `img-src ${webview.cspSource} data:`,
    `font-src ${webview.cspSource}`,
    `connect-src ${webview.cspSource}`,
  ].join('; ');
  const index = await fs.readFile(path.join(webDirectory, 'index.html'), 'utf8');
  return index
    .replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${policy}">`)
    .replace(/<script\b/g, `<script nonce="${nonce}"`)
    .replace(/(src|href)="(?:\.\/|\/)?(assets\/[^"]+)"/g, (_, attribute, asset) =>
      `${attribute}="${webview.asWebviewUri(vscode.Uri.file(path.join(webDirectory, asset)))}"`);
}

function activate(context) {
  let refresh = () => {};
  let replay;
  let settingUp;
  let showExample = false;

  function enable() {
    settingUp ??= (async () => {
      const project = requireProject();
      const node = await nodePath();
      await fs.access(cli);
      const result = await installHooks(project.fsPath, { node, cli });
      refresh();
      const message = result.changed
        ? '已写入项目记录 hooks。请启动或重开 Codex，在 /hooks 中审阅并信任三项记录 hooks。'
        : '项目记录 hooks 已配置。首次使用时，请在 Codex 的 /hooks 中审阅并信任。';
      const openTerminal = '打开项目终端';
      void vscode.window.showInformationMessage(message, openTerminal).then(action => {
        if (action === openTerminal) {
          vscode.window.createTerminal({ name: 'Codex 项目终端', cwd: project }).show();
        }
      });
    })().finally(() => { settingUp = undefined; });
    return settingUp;
  }

  async function openReplay() {
    if (!replay) {
      const modulePath = packaged ? './browser-server.cjs' : '../scripts/browser-server.cjs';
      replay = require(modulePath).startBrowserServer({ webDirectory, demoDirectory });
    }
    try {
      const { url } = await replay;
      await vscode.env.openExternal(vscode.Uri.parse(url));
    } catch (error) {
      replay = undefined;
      throw error;
    }
  }

  async function selectView(example) {
    showExample = example;
    await vscode.commands.executeCommand('mailuo.canvas.focus');
    refresh();
  }

  async function run(action) {
    try {
      await action();
    } catch (error) {
      void vscode.window.showErrorMessage(String(error.message ?? error));
    }
  }

  const provider = {
    async resolveWebviewView(view) {
      const webview = view.webview;
      webview.options = {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.file(webDirectory), vscode.Uri.file(path.join(demoDirectory, 'previews'))],
      };
      let ready = false;
      let disposed = false;
      let updating = false;
      let lastMessage;
      let demoSnapshot;

      async function update() {
        if (!ready || disposed || !view.visible || updating) return;
        updating = true;
        const example = showExample;
        const projectPath = activeProject()?.fsPath;
        view.title = example ? 'Pace your thought with agents · 路演示例' : 'Pace your thought with agents';
        try {
          let message;
          try {
            const data = example
              ? demoSnapshot ??= await readDemo(webview)
              : await readSnapshot(requireProject());
            message = { type: 'snapshot', data };
          } catch (error) {
            message = { type: 'error', message: String(error.message ?? error) };
          }
          if (disposed || example !== showExample || (!example && projectPath !== activeProject()?.fsPath)) return;
          const encoded = JSON.stringify(message);
          if (encoded !== lastMessage && await webview.postMessage(message)) {
            lastMessage = encoded;
          }
        } catch (error) {
          if (!disposed) console.error('画布 Webview 更新失败', error);
        } finally {
          updating = false;
        }
      }

      function refreshView() { void update(); }

      refresh = refreshView;
      const tick = setInterval(refreshView, pollInterval);
      const subscriptions = [
        view.onDidChangeVisibility(refreshView),
        vscode.window.onDidChangeActiveTextEditor(refreshView),
        vscode.workspace.onDidChangeWorkspaceFolders(refreshView),
        vscode.workspace.onDidGrantWorkspaceTrust(refreshView),
        webview.onDidReceiveMessage(message => {
          switch (message?.type) {
            case 'ready':
              ready = true;
              lastMessage = undefined;
              refreshView();
              break;
            case 'enable':
              void run(enable);
              break;
            case 'replay':
              void run(openReplay);
              break;
            case 'export':
              if (typeof message.markdown === 'string') {
                void run(() => saveMarkdown(showExample ? undefined : requireProject(), message.markdown));
              }
              break;
          }
        }),
      ];
      view.onDidDispose(() => {
        disposed = true;
        clearInterval(tick);
        subscriptions.forEach(subscription => subscription.dispose());
        if (refresh === refreshView) refresh = () => {};
      });

      try {
        webview.html = await renderWebview(webview);
      } catch {
        webview.html = '<!doctype html><p>画布资源缺失。请重新安装 VSIX。</p>';
      }
    },
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('mailuo.canvas', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('mailuo.enable', () => run(enable)),
    vscode.commands.registerCommand('mailuo.export', () => run(async () => {
      const project = requireProject();
      const snapshot = await readSnapshot(project);
      await saveMarkdown(project, snapshot.frames.at(-1)?.spec);
    })),
    vscode.commands.registerCommand('mailuo.replay', () => run(openReplay)),
    vscode.commands.registerCommand('mailuo.example', () => run(() => selectView(true))),
    vscode.commands.registerCommand('mailuo.project', () => run(() => selectView(false))),
    {
      dispose: () => {
        void replay?.then(({ server }) => {
          server.close();
          server.closeAllConnections();
        }).catch(() => {});
      },
    },
  );
}

module.exports = { activate };
