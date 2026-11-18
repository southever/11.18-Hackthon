import { access, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { renderSpec, snapshot } from '../core/memory.mjs';
import { openStore } from '../core/store.mjs';

const { values } = parseArgs({ options: {
  workspace: { type: 'string' },
  destination: { type: 'string', default: 'demo/replay.json' },
  title: { type: 'string' },
} });
if (!values.workspace) throw new Error('Provide --workspace <root>.');

const store = openStore(values.workspace);
let replay;
try {
  replay = snapshot(store, { includeOpen: false });
} finally {
  store.db.close();
}
if (!replay.frames.length || replay.frames.some(frame => frame.state)) {
  throw new Error('Wait for finished rounds to be organized before exporting.');
}
if (values.title) replay.project.title = values.title;

function sourceExcerpt(source) {
  let text = source.text;
  for (const directory of [store.root, homedir(), process.env.LOCALAPPDATA].filter(Boolean)) {
    for (const spelling of [directory, directory.replaceAll('\\', '/'), directory.replaceAll('\\', '\\\\')]) {
      text = text.replaceAll(spelling, '〈本机目录〉');
    }
  }
  if (source.kind === 'tool' && text.length > 1300) {
    text = `${text.slice(0, 650)}\n\n〔中间内容略〕\n\n${text.slice(-600)}`;
  }
  return { ...source, text };
}

const destination = resolve(values.destination);
for (const [index, frame] of replay.frames.entries()) {
  frame.sources = frame.sources.map(sourceExcerpt);
  const paths = new Set(frame.sources.map(source => source.id));
  if ([...frame.nodes, ...frame.edges].some(item => item.sourceIds.some(id => !paths.has(id)))) {
    throw new Error(`Missing source for frame ${frame.id}.`);
  }
  const name = String(index + 1).padStart(2, '0');
  const files = [`${name}.png`, `${name}.html`];
  await Promise.all(files.map(file => access(join(dirname(destination), 'previews', file))));
  const [url, pageUrl] = files.map(file => `./demo/previews/${file}`);
  frame.preview = { url, pageUrl, title: `第 ${index + 1} 轮 · 网站作品` };
  frame.spec = renderSpec(replay.project, frame);
}
await writeFile(destination, JSON.stringify(replay, null, 2) + '\n');
console.log(`已导出 ${replay.frames.length} 轮真实会话至 ${basename(destination)}。`);
