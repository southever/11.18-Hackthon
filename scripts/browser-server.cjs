const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

const mime = new Map(Object.entries({
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}));

function isInside(directory, file) {
  const relative = path.relative(directory, file);
  return relative && !relative.startsWith('..' + path.sep) &&
    relative !== '..' && !path.isAbsolute(relative);
}

async function startBrowserServer({ webDirectory, demoDirectory }) {
  const webRoot = await fs.realpath(webDirectory);
  const demoRoot = await fs.realpath(demoDirectory);
  await fs.access(path.join(webRoot, 'index.html'));
  await fs.access(path.join(demoRoot, 'replay.json'));
  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      const pathname = decodeURIComponent(url.pathname);
      const inDemo = pathname.startsWith('/demo/');
      const root = inDemo ? demoRoot : webRoot;
      const filename = pathname === '/' ? 'index.html' : pathname.slice(inDemo ? 6 : 1);
      const file = path.resolve(root, filename);
      if (inDemo && filename !== 'replay.json' && !filename.startsWith('previews/')) {
        response.writeHead(404).end();
        return;
      }
      if (!isInside(root, file)) {
        response.writeHead(404).end();
        return;
      }
      const realFile = await fs.realpath(file);
      if (!isInside(root, realFile) || !(await fs.stat(realFile)).isFile()) {
        response.writeHead(404).end();
        return;
      }
      const body = await fs.readFile(realFile);
      response.writeHead(200, {
        'Content-Type': mime.get(path.extname(realFile).toLowerCase()) || 'application/octet-stream',
        'Content-Length': body.length,
      });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch {
      response.writeHead(404).end();
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

module.exports = { startBrowserServer };
