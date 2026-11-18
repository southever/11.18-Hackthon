import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startBrowserServer } from './browser-server.cjs';

try {
  const { url } = await startBrowserServer({
    webDirectory: fileURLToPath(new URL('../web/dist/', import.meta.url)),
    demoDirectory: fileURLToPath(new URL('../demo/', import.meta.url)),
  });
  console.log(`脉络 MindTrace · ${url}`);
  if (process.argv.includes('--open')) {
    const [program, ...args] = process.platform === 'win32'
      ? ['rundll32.exe', 'url.dll,FileProtocolHandler', url]
      : [process.platform === 'darwin' ? 'open' : 'xdg-open', url];
    const browser = spawn(program, args, { detached: true, stdio: 'ignore', windowsHide: true });
    browser.on('error', error => console.error(`浏览器启动失败，请打开上面的地址。${error.message}`));
    browser.unref();
  }
} catch (error) {
  console.error(`演示启动失败。请确认 web/dist 和 demo/replay.json 已放好。\n${error.message}`);
  process.exitCode = 1;
}
