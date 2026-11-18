export type NodeKind = 'goal' | 'idea' | 'attempt' | 'decision';
export type NodeStatus = 'proposed' | 'active' | 'done' | 'superseded';

export interface MemoryNode {
  id: string;
  title: string;
  summary: string;
  kind: NodeKind;
  status: NodeStatus;
  sourceIds: string[];
}

export interface Relationship {
  id: string;
  from: string;
  to: string;
  label: string;
  sourceIds: string[];
}

export interface Source {
  id: string;
  kind: 'user' | 'assistant' | 'tool';
  text: string;
  timestamp?: string;
}

export interface Frame {
  id: string;
  sessionId: string;
  title: string;
  timestamp: string;
  focusId: string | null;
  nodes: MemoryNode[];
  edges: Relationship[];
  sources: Source[];
  spec: string;
  preview?: { url: string; title: string; pageUrl?: string };
  state?: 'open' | 'pending' | 'processing' | 'failed';
}

export interface Replay {
  version: 1;
  project: { id: string; title: string };
  frames: Frame[];
}

type HostRequest =
  | { type: 'ready' | 'replay' | 'enable' }
  | { type: 'export'; markdown: string };

export type HostEvent = { type: 'snapshot'; data: Replay } | { type: 'error'; message: string };

declare global {
  interface Window {
    acquireVsCodeApi?: () => { postMessage: (message: HostRequest) => void };
  }
}

export const host = window.acquireVsCodeApi?.();

export function isReplay(value: unknown): value is Replay {
  if (typeof value !== 'object' || value === null) return false;
  const replay = value as Partial<Replay>;
  return replay.version === 1
    && typeof replay.project?.id === 'string'
    && typeof replay.project.title === 'string'
    && Array.isArray(replay.frames)
    && replay.frames.every(frame => typeof frame?.id === 'string'
      && typeof frame.spec === 'string'
      && Array.isArray(frame.nodes)
      && Array.isArray(frame.edges)
      && Array.isArray(frame.sources));
}
