import { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Command,
  ExternalLink,
  FileText,
  GitBranch,
  GitFork,
  History,
  Layers,
  ListTree,
  MessageSquare,
  Monitor,
  Pause,
  Play,
  RotateCcw,
  Terminal,
  Workflow,
  X,
} from 'lucide-react';
import { arrangeFrames, Canvas, kindIcons, kindLabels, statusLabels, type Selection } from './Canvas';
import { host, isReplay, type Frame, type HostEvent, type Replay, type Source } from './types';
import './style.css';

type Panel = 'canvas' | 'spec' | 'preview';
const compact = Boolean(host);
const playbackIntervalMs = 5600;
const sourceLabels: Record<Source['kind'], string> = {
  user: '用户原话',
  assistant: 'Codex 回复',
  tool: '工具结果',
};
const sourceIcons = { user: MessageSquare, assistant: Command, tool: Terminal };

function timeLabel(value: string) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '' : new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function ordinal(index: number) {
  return String(index + 1).padStart(2, '0');
}

function Brand({ title }: { title?: string }) {
  return (
    <div className="brand">
      <span className="brand-mark"><Workflow size={19} strokeWidth={2.1} /></span>
      <span className="brand-name">脉络</span>
      {title && <><span className="brand-divider" /><span className="brand-project" title={title}>{title}</span></>}
    </div>
  );
}

function SourceCard({ source, expanded }: { source: Source; expanded: boolean }) {
  const Icon = sourceIcons[source.kind];
  return (
    <details className="source-card" open={expanded}>
      <summary>
        <span className="source-icon"><Icon size={14} /></span>
        <span>{sourceLabels[source.kind]}</span>
        {source.timestamp && <time dateTime={source.timestamp}>{timeLabel(source.timestamp)}</time>}
        <ChevronDown className="source-chevron" size={14} />
      </summary>
      <div className="source-text">{source.text}</div>
    </details>
  );
}

function Evidence({
  frame, roundSources, selection, setSelection, openPreview,
}: {
  frame: Frame;
  roundSources: Source[];
  selection: Selection | null;
  setSelection: (value: Selection | null) => void;
  openPreview: () => void;
}) {
  const [showRound, setShowRound] = useState(Boolean(frame.state));
  const node = selection?.type === 'node' ? frame.nodes.find(item => item.id === selection.id) : undefined;
  const edge = selection?.type === 'edge' ? frame.edges.find(item => item.id === selection.id) : undefined;
  const selected = node ?? edge;
  const sources = selected ? frame.sources.filter(source => selected.sourceIds.includes(source.id)) : [];
  const Icon = node ? kindIcons[node.kind] : GitBranch;
  const origin = edge && frame.nodes.find(item => item.id === edge.from);
  const destination = edge && frame.nodes.find(item => item.id === edge.to);
  const related = node ? frame.edges.filter(item => item.from === node.id || item.to === node.id) : [];

  return (
    <aside className="evidence" aria-label="详情">
      <div className="panel-title"><ListTree size={16} /><h2>详情</h2>
        <button className="icon-button" aria-label="本轮记录" aria-pressed={showRound} title="本轮记录" onClick={() => setShowRound(value => !value)}><MessageSquare size={15}/></button>
        {selection && <button className="icon-button" onClick={() => setSelection(null)} title="清除选择" aria-label="清除选择"><X size={16}/></button>}
      </div>
      {showRound ? (
        <div className="evidence-scroll">
          <section className="evidence-section">
            <h4>本轮记录 <span>{roundSources.length}</span></h4>
            {roundSources.map((source, index) => <SourceCard key={source.id} source={source} expanded={index === 0} />)}
          </section>
        </div>
      ) : selected ? (
        <div className="evidence-scroll" key={selected.id}>
          <div className="evidence-lead">
            <div className="evidence-type">
              <span className="evidence-type-icon"><Icon size={16}/></span>
              <span>{node ? kindLabels[node.kind] : '关系'}</span>
              {node && <span className="status-tag" data-status={node.status}><Circle size={8} />{statusLabels[node.status]}</span>}
            </div>
            <h3>{node?.title ?? edge?.label}</h3>
            {node?.summary && <p>{node.summary}</p>}
            {edge && <div className="edge-detail">
              <button className="text-button" onClick={() => origin && setSelection({ type: 'node', id: origin.id })}>{origin?.title}</button>
              <ArrowRight size={14} />
              <button className="text-button" onClick={() => destination && setSelection({ type: 'node', id: destination.id })}>{destination?.title}</button>
            </div>}
          </div>
          <section className="evidence-section">
            <h4>来源记录 <span>{sources.length}</span></h4>
            {sources.length ? sources.map((source, index) => <SourceCard key={source.id} source={source} expanded={index === 0} />)
              : <p className="muted">这一项没有关联来源。</p>}
          </section>
          {related.length > 0 && <section className="evidence-section">
            <h4>关联想法 <span>{related.length}</span></h4>
            {related.map(item => {
              const other = frame.nodes.find(candidate => candidate.id === (item.from === node?.id ? item.to : item.from));
              return other && <button className="related-link" key={item.id} onClick={() => setSelection({ type: 'node', id: other.id })}>
                <span>{item.label}</span><strong>{other.title}</strong><ChevronRight size={14} />
              </button>;
            })}
          </section>}
          {frame.preview && <section className="evidence-section">
            <h4>这一轮的作品</h4>
            <button className="artefact-link" onClick={openPreview}>
              <span className="source-icon"><Monitor size={15} /></span>
              <span>{frame.preview.title}</span>
              <ArrowUpRight size={15} />
            </button>
          </section>}
        </div>
      ) : (
        <div className="evidence-placeholder">
          <GitFork size={26} />
          <p>选择卡片或关系查看来源</p>
          {frame.preview && <button className="text-button" onClick={openPreview}>打开这一轮的预览 <ArrowUpRight size={14}/></button>}
        </div>
      )}
    </aside>
  );
}

function HistoryRail({
  replay, frame, index, goTo, onSelect,
}: {
  replay: Replay;
  frame: Frame;
  index: number;
  goTo: (index: number) => void;
  onSelect: (selection: Selection) => void;
}) {
  const [indexOpen, setIndexOpen] = useState(false);
  return (
    <aside className="history-rail" aria-label="项目历史">
      <div className="panel-title"><History size={16} /><h2>会话历史</h2></div>
      <div className="history-list">
        {replay.frames.map((item, step) => {
          const sessionStart = step === 0 || item.sessionId !== replay.frames[step - 1]?.sessionId;
          return (
            <div key={item.id}>
              {sessionStart && <div className="session-label"><MessageSquare size={12} /> 会话 {new Set(replay.frames.slice(0, step + 1).map(entry => entry.sessionId)).size}</div>}
              <button type="button" className="history-item" aria-current={index === step ? 'step' : undefined} onClick={() => goTo(step)}>
                <span className="history-dot" />
                <span className="history-item-text"><strong>{item.title}</strong><small>第 {step + 1} 轮 {timeLabel(item.timestamp) && `· ${timeLabel(item.timestamp)}`}</small></span>
                <ChevronRight size={14} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="node-index">
        <button className="index-toggle" onClick={() => setIndexOpen(open => !open)} aria-expanded={indexOpen}>
          <Layers size={15} /><span>想法索引</span><span className="muted">{frame.nodes.length}</span><ChevronDown size={14} />
        </button>
        {indexOpen && <div className="node-index-list">
          {frame.nodes.map(item => {
            const Icon = kindIcons[item.kind];
            return <button className="index-item" key={item.id} onClick={() => onSelect({ type: 'node', id: item.id })}>
              <Icon size={13} /><span>{item.title}</span><ChevronRight size={13} />
            </button>;
          })}
        </div>}
      </div>
    </aside>
  );
}

function Timeline({
  frames, index, playing, goTo, togglePlaying,
}: {
  frames: Frame[];
  index: number;
  playing: boolean;
  goTo: (index: number) => void;
  togglePlaying: () => void;
}) {
  const final = index === frames.length - 1;
  return (
    <section className="timeline" aria-label="回放时间轴">
      <div className="timeline-top">
        <div className="timeline-label"><AudioLines size={16} /><strong>回放</strong></div>
        <div className="transport">
          <button type="button" className="icon-button" aria-label="上一轮" title="上一轮 (←)" disabled={index === 0} onClick={() => goTo(index - 1)}><ChevronLeft size={17} /></button>
          <button type="button" className="play-button" aria-label={playing ? '暂停' : '播放'} title={playing ? '暂停 (空格)' : '播放 (空格)'} onClick={togglePlaying} disabled={frames.length < 2}>
            {playing ? <Pause size={15} fill="currentColor" /> : final ? <RotateCcw size={15} /> : <Play size={14} fill="currentColor" />}
            <span>{playing ? '暂停' : final ? '重新播放' : '播放'}</span>
          </button>
          <button type="button" className="icon-button" aria-label="下一轮" title="下一轮 (→)" disabled={final} onClick={() => goTo(index + 1)}><ChevronRight size={17} /></button>
        </div>
        <span className="timeline-count">{ordinal(index)} / {String(frames.length).padStart(2, '0')}</span>
      </div>
      <div className="timeline-track" role="group" aria-label="跳转轮次">
        {frames.map((frame, step) => (
          <button type="button" key={frame.id} className="timeline-step" data-completed={step <= index} aria-current={step === index ? 'step' : undefined} onClick={() => goTo(step)} title={frame.title}>
            <span className="timeline-progress" /><span className="timeline-step-title"><span>{ordinal(step)}</span>{frame.title}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Spec({ frame, title, onBack }: { frame: Frame; title: string; onBack: () => void }) {
  const [exported, setExported] = useState(false);
  useEffect(() => { setExported(false); }, [frame.id]);
  function exportMarkdown() {
    if (host) {
      host.postMessage({ type: 'export', markdown: frame.spec });
      return;
    }
    const url = URL.createObjectURL(new Blob([frame.spec], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${title.replace(/[<>:"/\\|?*]/g, '-')}-项目说明.md`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExported(true);
  }
  return (
    <section className="document-panel">
      <div className="document-toolbar">
        <button className="text-button" onClick={onBack}><ArrowLeft size={15} />返回画布</button>
        <button className="primary-button" onClick={exportMarkdown} disabled={!frame.spec}>
          {exported ? <Check size={16} /> : <ArrowDownToLine size={16} />}{exported ? '已导出 Markdown' : '导出 Markdown'}
        </button>
      </div>
      <article className="markdown-body">
        <div className="document-kicker"><FileText size={14} /> {frame.title}</div>
        {frame.spec ? <ReactMarkdown>{frame.spec}</ReactMarkdown> : <p className="muted">这一轮还没有项目说明。</p>}
      </article>
    </section>
  );
}

function Preview({ preview, onBack }: { preview: NonNullable<Frame['preview']>; onBack: () => void }) {
  const isImage = /\.(avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(preview.url);
  const isVideo = /\.(mp4|webm)(?:[?#].*)?$/i.test(preview.url);
  return (
    <section className="document-panel preview-panel">
      <div className="document-toolbar">
        <button className="text-button" onClick={onBack}><ArrowLeft size={15} />返回画布</button>
        <a className="text-button" href={preview.pageUrl ?? preview.url} target="_blank" rel="noreferrer">{preview.pageUrl ? '打开作品' : '在新窗口打开'} <ExternalLink size={14} /></a>
      </div>
      <div className="preview-content">
        <div className="preview-bar"><span /><span /><span /><strong>{preview.title}</strong></div>
        {isImage ? <img src={preview.url} alt={preview.title} />
          : isVideo ? <video src={preview.url} controls aria-label={preview.title} />
          : <iframe src={preview.url} title={preview.title} sandbox="" />}
      </div>
    </section>
  );
}

function EmptyState({ error }: { error: string }) {
  return <main className={compact ? 'empty-screen compact-empty' : 'empty-screen'}>
    <div className="empty-brand"><Brand /></div>
    <div className="empty-card">
      <span className="empty-icon"><GitFork size={25} /></span>
      <h1>{error ? '暂时无法加载项目' : compact ? '开始记录项目' : '等待项目回放'}</h1>
      <p>{error || (compact ? '启用后，Codex 的对话和尝试会按轮次进入画布。' : '回放加载后，这里会显示项目的想法与决定。')}</p>
      {compact
        ? <button className="primary-button" onClick={() => host?.postMessage({ type: 'enable' })}><GitBranch size={16} />启用记录</button>
        : error && <button className="primary-button" onClick={() => window.location.reload()}><RotateCcw size={15} />重新加载</button>}
    </div>
  </main>;
}

function Workspace({ replay, error }: { replay: Replay; error: string }) {
  const [manualIndex, setManualIndex] = useState<number | null>(null);
  const [selection, setSelection] = useState<Selection | null | undefined>(undefined);
  const [playing, setPlaying] = useState(false);
  const [panel, setPanel] = useState<Panel>('canvas');
  const [allNodes, setAllNodes] = useState(false);
  const [compactHistory, setCompactHistory] = useState(false);
  const lastIndex = replay.frames.length - 1;
  const index = manualIndex === null ? lastIndex : Math.min(manualIndex, lastIndex);
  const frame = replay.frames[index];
  const currentSelection = selection === undefined
    ? frame.focusId && frame.nodes.some(node => node.id === frame.focusId) ? { type: 'node', id: frame.focusId } as const : null
    : selection;
  const positions = useMemo(() => arrangeFrames(replay.frames), [replay.frames]);
  const pickSelection = useCallback((item: Selection | null) => {
    setSelection(item);
    setPanel('canvas');
    setCompactHistory(false);
  }, []);

  const goTo = useCallback((step: number) => {
    setManualIndex(step >= lastIndex ? null : Math.max(step, 0));
    setSelection(undefined);
    setPlaying(false);
  }, [lastIndex]);

  const togglePlaying = useCallback(() => {
    if (lastIndex < 1) return;
    if (playing) {
      setPlaying(false);
      return;
    }
    setPanel('canvas');
    if (index === lastIndex) {
      setManualIndex(0);
      setSelection(undefined);
    }
    setPlaying(true);
  }, [index, lastIndex, playing]);

  useEffect(() => {
    if (!playing) return;
    const tick = window.setTimeout(() => {
      if (index + 1 >= lastIndex) {
        setManualIndex(null);
        setPlaying(false);
      } else {
        setManualIndex(index + 1);
      }
      setSelection(undefined);
    }, playbackIntervalMs);
    return () => window.clearTimeout(tick);
  }, [index, lastIndex, playing]);

  useEffect(() => {
    if (compact) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
      if (!(event.target instanceof HTMLElement) || event.target.closest('button, a, input, textarea, summary, [contenteditable], .react-flow')) return;
      if (event.code === 'Space') {
        event.preventDefault();
        togglePlaying();
      } else if (event.key === 'ArrowLeft') {
        goTo(index - 1);
      } else if (event.key === 'ArrowRight') {
        goTo(index + 1);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [goTo, index, togglePlaying]);

  function openPanel(next: Panel) {
    setPanel(next);
    setCompactHistory(false);
    if (next !== 'canvas') setPlaying(false);
  }

  const activePanel = panel === 'preview' && !frame.preview ? 'canvas' : panel;

  return (
    <main className={compact ? 'app-shell compact' : 'app-shell'}>
      <header className="app-header">
        <Brand title={replay.project.title} />
        <nav className="top-nav" aria-label="项目视图">
          <button type="button" aria-current={activePanel === 'canvas' ? 'page' : undefined} onClick={() => openPanel('canvas')}><GitFork size={15} />画布</button>
          <button type="button" aria-current={activePanel === 'spec' ? 'page' : undefined} onClick={() => openPanel('spec')}><FileText size={15} />项目说明</button>
          {!compact && frame.preview && <button type="button" aria-current={activePanel === 'preview' ? 'page' : undefined} onClick={() => openPanel('preview')}><Monitor size={15} />网站预览</button>}
        </nav>
        {compact ? <button className="icon-button header-action" onClick={() => host?.postMessage({ type: 'replay' })} title="打开浏览器回放" aria-label="打开浏览器回放"><ExternalLink size={16} /></button>
          : <div className="header-mode"><Circle size={8} fill="currentColor" />本地回放</div>}
      </header>
      {error && <div className="error-banner" role="status">{error}</div>}
      <div className="workspace">
        <div className={compactHistory ? 'history-container history-open' : 'history-container'}>
          <HistoryRail replay={replay} frame={frame} index={index} goTo={goTo} onSelect={pickSelection} />
        </div>
        <div className="center-column">
          {activePanel === 'canvas' ? <>
            <section className="canvas-section" aria-label="想法画布">
              <Canvas frame={frame} positions={positions} selection={currentSelection} allNodes={allNodes} compact={compact} onSelect={pickSelection} />
              <div className="canvas-toolbar">
                <div className="canvas-heading">
                  <div className="canvas-kicker"><span className="kicker-dot" />第 {index + 1} 轮</div>
                  <h1>{frame.title}</h1>
                </div>
                <div className="canvas-actions">
                  <button type="button" aria-pressed={allNodes} title={allNodes ? '只看当前关联' : '显示全部想法'} onClick={() => setAllNodes(value => !value)}><Layers size={16} /><span>{allNodes ? '全部想法' : '当前关联'}</span><ChevronDown size={13} /></button>
                  <button type="button" className="mobile-history" aria-label="会话历史" aria-expanded={compactHistory} title="会话历史" onClick={() => setCompactHistory(value => !value)}><History size={17} /></button>
                </div>
              </div>
              {frame.nodes.length === 0 && <div className="canvas-empty">这一轮的想法正在整理。</div>}
            </section>
          </> : activePanel === 'spec' ? <Spec frame={frame} title={replay.project.title} onBack={() => openPanel('canvas')} />
            : frame.preview && <Preview preview={frame.preview} onBack={() => openPanel('canvas')} />}
          {!compact && <Timeline frames={replay.frames} index={index} playing={playing} goTo={goTo} togglePlaying={togglePlaying} />}
        </div>
        {activePanel === 'canvas' && <Evidence key={frame.id} frame={frame}
          roundSources={frame.sources.slice(replay.frames[index - 1]?.sources.length ?? 0)}
          selection={currentSelection} setSelection={pickSelection} openPreview={() => openPanel('preview')} />}
      </div>
      {!compact && <footer className="app-footer">
        <span><GitBranch size={13} />{replay.project.title}</span>
        <span>{frame.nodes.length} 张卡片 <span className="footer-divider" /> {frame.edges.length} 条关系</span>
      </footer>}
    </main>
  );
}

function App() {
  const [replay, setReplay] = useState<Replay | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (host) {
      const receive = (event: MessageEvent<HostEvent>) => {
        if (event.data?.type === 'snapshot' && isReplay(event.data.data)) {
          setReplay(event.data.data);
          setError('');
        } else if (event.data?.type === 'error') {
          setError(event.data.message);
        }
      };
      window.addEventListener('message', receive);
      host.postMessage({ type: 'ready' });
      return () => window.removeEventListener('message', receive);
    }
    const controller = new AbortController();
    fetch('./demo/replay.json', { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error('本地回放文件无法读取。');
        return response.json();
      })
      .then(data => {
        if (!isReplay(data)) throw new Error('回放文件的格式不受支持。');
        if (!data.frames.length) throw new Error('回放文件里没有已记录的轮次。');
        setReplay(data);
      })
      .catch(cause => {
        if (!controller.signal.aborted) setError(cause instanceof SyntaxError ? '本地回放文件无法读取。' : cause.message);
      });
    return () => controller.abort();
  }, []);
  return replay?.frames.length
    ? <Workspace key={replay.project.id} replay={replay} error={error} />
    : <EmptyState error={error} />;
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
