import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  getViewportForBounds,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type Rect,
  type Viewport,
  type XYPosition,
} from '@xyflow/react';
import {
  ArrowDownLeft,
  Check,
  Circle,
  Flag,
  Focus,
  Lightbulb,
  Minus,
  Plus,
  Terminal,
} from 'lucide-react';
import type { Frame, MemoryNode, NodeKind, NodeStatus, Relationship } from './types';
import '@xyflow/react/dist/style.css';
import './graph.css';

export const kindLabels: Record<NodeKind, string> = {
  goal: '项目目标',
  idea: '想法',
  attempt: '尝试',
  decision: '决定',
};

export const statusLabels: Record<NodeStatus, string> = {
  proposed: '已提议',
  active: '进行中',
  done: '已完成',
  superseded: '已取代',
};

export const kindIcons = {
  goal: Flag,
  idea: Lightbulb,
  attempt: Terminal,
  decision: Check,
};

export type Selection = { type: 'node' | 'edge'; id: string };
type CardData = { item: MemoryNode; focused: boolean };
type CanvasNode = Node<CardData, 'memory'>;
type Point = XYPosition;
type Segment = { start: Point; end: Point };
type Route = {
  points: Point[];
  label: Point;
  sourceSide: Position;
  targetSide: Position;
};
type RelationData = {
  label: string;
  route: Route;
  tone: 'replace' | 'reuse' | 'primary' | 'quiet';
  onSelect: (selection: Selection) => void;
};
type CanvasEdge = Edge<RelationData, 'relationship'>;

const cardSize = { width: 198, height: 132 };
const compactCardSize = { width: 136, height: 108 };
const spacing = { x: 282, y: 193 };
const compactSpacing = { x: 195, y: 155 };
const sides = [Position.Left, Position.Right, Position.Top, Position.Bottom];
const colors = {
  replace: '#97684e',
  reuse: '#5a765c',
  primary: '#788b75',
  quiet: '#a6ada0',
};

export function arrangeFrames(frames: Frame[]): Map<string, number> {
  const order = new Map<string, number>();
  for (const frame of frames) {
    for (const node of frame.nodes) {
      if (!order.has(node.id)) order.set(node.id, order.size);
    }
  }
  return order;
}

function getLayout(frame: Frame, order: Map<string, number>, narrow: boolean) {
  const grid = new Map<string, Point>();
  const occupied = new Set<string>();
  const ordered = [...frame.nodes].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const byId = new Map(ordered.map(node => [node.id, node]));
  const focus = (frame.focusId && byId.get(frame.focusId)) || ordered[0];
  const connections = new Map(ordered.map(node => [node.id, new Set<string>()]));
  for (const edge of frame.edges) {
    connections.get(edge.from)?.add(edge.to);
    connections.get(edge.to)?.add(edge.from);
  }
  const neighbors = (focus && connections.get(focus.id)) ?? new Set<string>();
  const place = (id: string | undefined, column: number, row: number) => {
    const key = `${column},${row}`;
    if (!id || !byId.has(id) || grid.has(id) || occupied.has(key)) return;
    grid.set(id, { x: column, y: row });
    occupied.add(key);
  };

  if (focus) {
    const previous = frame.edges.find(edge => edge.from === focus.id && edge.label === '取代')?.to;
    const reuse = frame.edges.find(edge => edge.label === '沿用' && (neighbors.has(edge.from) || edge.from === focus.id));
    const continuation = reuse?.from === focus.id ? reuse.to : reuse?.from;
    const goal = ordered.find(node => node.kind === 'goal' && neighbors.has(node.id));
    const check = ordered.find(node => node.kind === 'attempt' && neighbors.has(node.id));
    const alternate = ordered.find(node => neighbors.has(node.id) && node.id !== goal?.id
      && node.id !== check?.id && node.id !== continuation);
    place(focus.id, 1, 0);
    place(goal?.id, 0, 0);
    place(previous ?? alternate?.id, 2, 0);
    place(continuation, 1, 1);
    place(reuse?.to, 2, 1);
    place(check?.id, 0, 1);
  }

  // Keep adjacent cards close. Adding other cards preserves the main composition.
  const columns = narrow || ordered.length <= 15 ? [1, 0, 2] : [1, 0, 2, 3, 4];
  const vacant = new Map<string, Point>();
  for (let row = 0; row < Math.ceil(ordered.length / columns.length) + 2; row++) {
    for (const column of columns) {
      const key = `${column},${row}`;
      if (!occupied.has(key)) vacant.set(key, { x: column, y: row });
    }
  }
  const remaining = [...ordered.filter(node => neighbors.has(node.id)), ...ordered.filter(node => !neighbors.has(node.id))];
  for (const node of remaining) {
    if (grid.has(node.id)) continue;
    const linked = [...(connections.get(node.id) ?? [])].map(id => grid.get(id)).filter(point => point !== undefined);
    let closest: Point | undefined;
    let best = Infinity;
    let considered = 0;
    for (const slot of vacant.values()) {
      const proximity = linked.length
        ? linked.reduce((sum, point) => sum + distance(point, slot), 0) / linked.length
        : Math.abs(1 - slot.x) + slot.y;
      const score = proximity + (slot.y + Math.abs(1 - slot.x)) * 0.18;
      if (score < best) {
        closest = slot;
        best = score;
      }
      if (++considered === 12) break;
    }
    if (closest) {
      place(node.id, closest.x, closest.y);
      vacant.delete(`${closest.x},${closest.y}`);
    }
  }

  const gap = narrow ? compactSpacing : spacing;
  return new Map([...grid].map(([id, { x, y }]) => {
    if (narrow) {
      const column = y % 2;
      const row = x + (y - column) * 1.5;
      return [id, { x: column * gap.x, y: row * gap.y }];
    }
    return [id, { x: x * gap.x, y: y * gap.y }];
  }));
}

function getVisibleIds(frame: Frame, selection: Selection | null, allNodes: boolean) {
  if (allNodes || !frame.focusId || !frame.nodes.some(node => node.id === frame.focusId)) {
    return new Set(frame.nodes.map(node => node.id));
  }
  const visible = new Set([frame.focusId]);
  for (const edge of frame.edges) {
    if (edge.from === frame.focusId) visible.add(edge.to);
    if (edge.to === frame.focusId) visible.add(edge.from);
    if (selection?.type === 'edge' && edge.id === selection.id) {
      visible.add(edge.from);
      visible.add(edge.to);
    }
  }
  // Retained material can be another hop away from the current decision.
  for (const edge of frame.edges) {
    if (edge.label === '沿用' && visible.has(edge.from)) visible.add(edge.to);
  }
  if (selection?.type === 'node') visible.add(selection.id);
  return visible;
}

function port(rect: Rect, side: Position): Point {
  const x = side === Position.Left ? rect.x
    : side === Position.Right ? rect.x + rect.width : rect.x + rect.width / 2;
  const y = side === Position.Top ? rect.y
    : side === Position.Bottom ? rect.y + rect.height : rect.y + rect.height / 2;
  return { x, y };
}

function step(point: Point, side: Position, distance: number): Point {
  switch (side) {
    case Position.Left: return { x: point.x - distance, y: point.y };
    case Position.Right: return { x: point.x + distance, y: point.y };
    case Position.Top: return { x: point.x, y: point.y - distance };
    case Position.Bottom: return { x: point.x, y: point.y + distance };
  }
}

function segments(points: Point[]): Segment[] {
  return points.slice(1).map((end, index) => ({ start: points[index], end }));
}

function distance(a: Point, b: Point) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function simplify(points: Point[]) {
  const result: Point[] = [];
  for (const point of points) {
    const last = result.at(-1);
    if (last && distance(last, point) === 0) continue;
    const before = result.at(-2);
    if (before && last) {
      const straight = distance(before, last) + distance(last, point) === distance(before, point);
      if (straight && (before.x === point.x || before.y === point.y)) result.pop();
    }
    result.push(point);
  }
  return result;
}

function overlaps(a: number, b: number, min: number, max: number) {
  return Math.max(Math.min(a, b), min) < Math.min(Math.max(a, b), max);
}

function crossesCard({ start, end }: Segment, card: Rect) {
  if (start.y === end.y) {
    return start.y > card.y && start.y < card.y + card.height
      && overlaps(start.x, end.x, card.x, card.x + card.width);
  }
  return start.x > card.x && start.x < card.x + card.width
    && overlaps(start.y, end.y, card.y, card.y + card.height);
}

function sharedLength(a: Segment, b: Segment) {
  const horizontal = a.start.y === a.end.y && a.start.y === b.start.y && a.start.y === b.end.y;
  const vertical = a.start.x === a.end.x && a.start.x === b.start.x && a.start.x === b.end.x;
  if (!horizontal && !vertical) return 0;
  const axis = horizontal ? 'x' : 'y';
  return Math.max(0, Math.min(Math.max(a.start[axis], a.end[axis]), Math.max(b.start[axis], b.end[axis]))
    - Math.max(Math.min(a.start[axis], a.end[axis]), Math.min(b.start[axis], b.end[axis])));
}

function candidateLabel(parts: Segment[], label: string, cards: Rect[], labels: Rect[]) {
  const width = Math.max(30, [...label].length * 12 + 14);
  const height = 24;
  let best = Infinity;
  let point = parts[0]?.start ?? { x: 0, y: 0 };
  for (const part of parts) {
    const horizontal = part.start.y === part.end.y;
    const length = distance(part.start, part.end);
    if (length < (horizontal ? width : height) + 4) continue;
    const x = (part.start.x + part.end.x) / 2;
    const y = (part.start.y + part.end.y) / 2;
    const box = { x: x - width / 2, y: y - height / 2, width, height };
    const collisions = [...cards, ...labels].filter(card =>
      overlaps(box.x, box.x + width, card.x - 2, card.x + card.width + 2)
      && overlaps(box.y, box.y + height, card.y - 2, card.y + card.height + 2)).length;
    const score = collisions * 350 + Math.max(0, 72 - length) / 2 + (horizontal ? 0 : 8);
    if (score < best) {
      point = { x, y };
      best = score;
    }
  }
  return { point, cost: Number.isFinite(best) ? best : 500, width, height };
}

function routeEdge(
  edge: Relationship,
  source: Rect,
  target: Rect,
  cards: Rect[],
  earlier: Segment[],
  labels: Rect[],
  dense: boolean,
) {
  const gutter = 26;
  const channelCards = dense ? [source, target] : cards;
  const xChannels = new Set(channelCards.flatMap(card => [card.x - gutter, card.x + card.width + gutter]));
  const yChannels = new Set(channelCards.flatMap(card => [card.y - gutter, card.y + card.height + gutter]));
  let best: { cost: number; route: Route; labelBox: Rect } | undefined;

  for (const sourceSide of sides) {
    const from = port(source, sourceSide);
    const start = step(from, sourceSide, gutter);
    for (const targetSide of sides) {
      const to = port(target, targetSide);
      const end = step(to, targetSide, gutter);
      const candidates = [[{ x: start.x, y: end.y }], [{ x: end.x, y: start.y }]];
      for (const x of xChannels) candidates.push([{ x, y: start.y }, { x, y: end.y }]);
      for (const y of yChannels) candidates.push([{ x: start.x, y }, { x: end.x, y }]);

      for (const middle of candidates) {
        const points = simplify([from, start, ...middle, end, to]);
        const parts = segments(points);
        if (parts.length < 2 && source === target) continue;
        const collisionCost = parts.reduce((cost, part) =>
          cost + cards.filter(card => crossesCard(part, card)).length * 5000, 0);
        if (best && collisionCost >= best.cost) continue;
        const overlapCost = parts.reduce((cost, part) =>
          cost + earlier.reduce((shared, prev) => shared + sharedLength(part, prev), 0), 0);
        const pathCost = collisionCost + overlapCost * 1.8 + points.length * 10
          + parts.reduce((length, part) => length + distance(part.start, part.end), 0);
        if (best && pathCost >= best.cost) continue;

        const label = candidateLabel(parts, edge.label, cards, labels);
        const cost = pathCost + label.cost;
        if (best && cost >= best.cost) continue;
        best = {
          cost,
          route: { points, label: label.point, sourceSide, targetSide },
          labelBox: {
            x: label.point.x - label.width / 2,
            y: label.point.y - label.height / 2,
            width: label.width,
            height: label.height,
          },
        };
      }
    }
  }
  // Every endpoint pair has an outer lane, even if the preferred turns are crowded.
  if (best) return best;
  const from = port(source, Position.Top);
  const to = port(target, Position.Right);
  const top = Math.min(...cards.map(card => card.y)) - gutter;
  const right = Math.max(...cards.map(card => card.x + card.width)) + gutter;
  const label = { x: (from.x + right) / 2, y: top };
  return {
    route: {
      points: [from, { x: from.x, y: top }, { x: right, y: top }, { x: right, y: to.y }, to],
      label,
      sourceSide: Position.Top,
      targetSide: Position.Right,
    },
    labelBox: { x: label.x - 30, y: label.y - 12, width: 60, height: 24 },
  };
}

function roundedPath(points: Point[]) {
  const first = points[0];
  let path = `M ${first.x},${first.y}`;
  for (let index = 1; index < points.length - 1; index++) {
    const before = points[index - 1];
    const corner = points[index];
    const next = points[index + 1];
    const radius = Math.min(14, distance(before, corner) / 2, distance(corner, next) / 2);
    const ax = corner.x + Math.sign(before.x - corner.x) * radius;
    const ay = corner.y + Math.sign(before.y - corner.y) * radius;
    const bx = corner.x + Math.sign(next.x - corner.x) * radius;
    const by = corner.y + Math.sign(next.y - corner.y) * radius;
    path += ` L ${ax},${ay} Q ${corner.x},${corner.y} ${bx},${by}`;
  }
  const last = points[points.length - 1];
  return `${path} L ${last.x},${last.y}`;
}

function Card({ data, selected }: NodeProps<CanvasNode>) {
  const { item, focused } = data;
  const Icon = kindIcons[item.kind];
  const StatusIcon = item.status === 'done' ? Check : item.status === 'superseded' ? ArrowDownLeft : Circle;
  return (
    <div className="memory-card" data-kind={item.kind} data-status={item.status} data-focus={focused} data-selected={selected}>
      {sides.map(side => (
        <Handle key={`in-${side}`} id={`in-${side}`} type="target" position={side} />
      ))}
      {sides.map(side => (
        <Handle key={`out-${side}`} id={`out-${side}`} type="source" position={side} />
      ))}
      <div className="memory-card-meta">
        <span className="memory-card-kind"><span className="memory-kind-icon"><Icon size={14} /></span>{kindLabels[item.kind]}</span>
        <span className="memory-card-status"><StatusIcon size={10} />{focused ? '当前关注' : statusLabels[item.status]}</span>
      </div>
      <strong title={item.title}>{item.title}</strong>
      {item.summary && <p>{item.summary}</p>}
    </div>
  );
}

function Relation({ id, data, selected, markerEnd }: EdgeProps<CanvasEdge>) {
  if (!data) return null;
  const { label, route, tone, onSelect } = data;
  return (
    <>
      <BaseEdge
        id={id}
        path={roundedPath(route.points)}
        markerEnd={markerEnd}
        style={{
          stroke: colors[tone],
          strokeDasharray: tone === 'replace' ? '5 3' : undefined,
          strokeWidth: selected ? 2 : tone === 'quiet' ? 1.15 : 1.55,
        }}
      />
      <EdgeLabelRenderer>
        <button
          type="button"
          className="edge-label nodrag nopan"
          data-tone={tone}
          data-selected={selected}
          onClick={() => onSelect({ type: 'edge', id })}
          style={{ transform: `translate(-50%, -50%) translate(${route.label.x}px, ${route.label.y}px)` }}
        >
          {label}
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { memory: Card };
const edgeTypes = { relationship: Relation };

function ZoomTools({ viewport }: { viewport: Viewport }) {
  const graph = useReactFlow();
  const { viewportInitialized, setViewport } = graph;
  useEffect(() => {
    if (viewportInitialized) void setViewport(viewport);
  }, [setViewport, viewport, viewportInitialized]);

  return (
    <div className="canvas-zoom" role="group" aria-label="画布缩放">
      <button type="button" title="缩小" aria-label="缩小" onClick={() => void graph.zoomOut({ duration: 150 })}><Minus size={16} /></button>
      <button type="button" title="适合画布" aria-label="适合画布" onClick={() => void setViewport(viewport, { duration: 200 })}><Focus size={17} /></button>
      <button type="button" title="放大" aria-label="放大" onClick={() => void graph.zoomIn({ duration: 150 })}><Plus size={16} /></button>
    </div>
  );
}

interface CanvasProps {
  frame: Frame;
  positions: Map<string, number>;
  selection: Selection | null;
  allNodes: boolean;
  compact: boolean;
  onSelect: (selection: Selection) => void;
}

export function Canvas({ frame, positions, selection, allNodes, compact, onSelect }: CanvasProps) {
  const area = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!area.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    });
    observer.observe(area.current);
    return () => observer.disconnect();
  }, []);
  const narrow = compact || (size.width > 0 && size.width < 640);
  const readingView = size.width > 0 && size.width < 480 && !allNodes;
  const metrics = narrow ? compactCardSize : cardSize;
  const layout = useMemo(() => getLayout(frame, positions, narrow), [frame, positions, narrow]);
  const visible = getVisibleIds(frame, selection, allNodes);
  const visibleKey = JSON.stringify(frame.nodes.filter(node => visible.has(node.id)).map(node => node.id));

  const { cards, relations, bounds } = useMemo(() => {
    const ids = new Set<string>(JSON.parse(visibleKey));
    const cards = frame.nodes.flatMap(item => {
      const point = layout.get(item.id);
      return point && ids.has(item.id) ? [{ item, rect: { ...point, ...metrics } }] : [];
    });
    const cardById = new Map(cards.map(({ item, rect }) => [item.id, rect]));
    const obstacles = cards.map(card => card.rect);
    const earlier: Segment[] = [];
    const labels: Rect[] = [];
    const relations: { item: Relationship; route: Route; tone: RelationData['tone'] }[] = [];
    const toneFor = (edge: Relationship): RelationData['tone'] => {
      if (edge.label === '取代') return 'replace';
      if (edge.label === '沿用') return 'reuse';
      return edge.from === frame.focusId || edge.to === frame.focusId ? 'primary' : 'quiet';
    };
    const priority = ['replace', 'reuse', 'primary', 'quiet'];
    const ordered = [...frame.edges].sort((a, b) => priority.indexOf(toneFor(a)) - priority.indexOf(toneFor(b)));
    const dense = cards.length > 20;
    for (const item of ordered) {
      const source = cardById.get(item.from);
      const target = cardById.get(item.to);
      if (!source || !target) continue;
      const routed = routeEdge(item, source, target, obstacles, dense ? [] : earlier, dense ? [] : labels, dense);
      earlier.push(...segments(routed.route.points));
      labels.push(routed.labelBox);
      relations.push({ item, route: routed.route, tone: toneFor(item) });
    }

    const extents = [...obstacles, ...labels, ...earlier.flatMap(({ start, end }) =>
      [start, end].map(point => ({ ...point, width: 0, height: 0 })))];
    const x = Math.min(...extents.map(rect => rect.x));
    const y = Math.min(...extents.map(rect => rect.y));
    const bounds = extents.length ? {
      x, y,
      width: Math.max(...extents.map(rect => rect.x + rect.width)) - x,
      height: Math.max(...extents.map(rect => rect.y + rect.height)) - y,
    } : { x: 0, y: 0, width: 1, height: 1 };
    return { cards, relations, bounds };
  }, [frame, layout, metrics, visibleKey]);

  const nodes: CanvasNode[] = cards.map(({ item, rect }) => ({
    id: item.id,
    type: 'memory',
    position: rect,
    width: rect.width,
    height: rect.height,
    data: { item, focused: item.id === frame.focusId },
    selected: selection?.type === 'node' && selection.id === item.id,
    ariaLabel: `${kindLabels[item.kind]}，${item.title}，${statusLabels[item.status]}`,
  }));
  const edges: CanvasEdge[] = relations.map(({ item, route, tone }) => ({
    id: item.id,
    source: item.from,
    target: item.to,
    type: 'relationship',
    sourceHandle: `out-${route.sourceSide}`,
    targetHandle: `in-${route.targetSide}`,
    markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: colors[tone] },
    selected: selection?.type === 'edge' && selection.id === item.id,
    data: { label: item.label, route, tone, onSelect },
    ariaLabel: `关系：${item.label}`,
  }));

  const viewport = useMemo(() => getViewportForBounds(
    bounds, size.width, size.height, 0.12, narrow ? 1.03 : 1.09, narrow ? '8px' : '25px',
  ), [bounds, size, narrow]);

  const selectByKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.key !== 'Enter' && event.key !== ' ') || !(event.target instanceof Element)) return;
    const element = event.target.closest('.react-flow__node, .react-flow__edge');
    const id = element?.getAttribute('data-id');
    if (!id || !element) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect({ type: element.classList.contains('react-flow__node') ? 'node' : 'edge', id });
  };

  return (
    <div ref={area} className="memory-graph" data-narrow={narrow} onKeyDownCapture={selectByKey}>
      {readingView ? (
        <div className="narrow-map" key={frame.id} aria-label="当前关联">
          {[...cards].sort((a, b) => Number(b.item.id === frame.focusId) - Number(a.item.id === frame.focusId)
            || Number(relations.some(r => r.item.from === b.item.id && r.item.label === '沿用'))
              - Number(relations.some(r => r.item.from === a.item.id && r.item.label === '沿用'))).map(({ item }) => {
            const Icon = kindIcons[item.kind];
            const outgoing = relations.filter(r => r.item.from === item.id);
            return <section className="narrow-branch" key={item.id} data-focus={item.id === frame.focusId}>
              <button type="button" className="narrow-card" onClick={() => onSelect({ type: 'node', id: item.id })}>
                <span><Icon size={13}/>{kindLabels[item.kind]}<small>{item.id === frame.focusId ? '当前关注' : statusLabels[item.status]}</small></span>
                <strong>{item.title}</strong>
              </button>
              {outgoing.map(({ item: edge }) => <button key={edge.id} className="narrow-connection" type="button"
                aria-label={edge.label} onClick={() => onSelect({ type: 'edge', id: edge.id })}>
                <span>{edge.label}</span>{frame.nodes.find(node => node.id === edge.to)?.title}
              </button>)}
            </section>;
          })}
        </div>
      ) : size.width > 0 && size.height > 0 && (
        <ReactFlow<CanvasNode, CanvasEdge>
          key={frame.id}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultViewport={viewport}
          minZoom={0.12}
          maxZoom={1.75}
          nodesDraggable={false}
          nodesConnectable={false}
          onNodeClick={(_, node) => onSelect({ type: 'node', id: node.id })}
          onEdgeClick={(_, edge) => onSelect({ type: 'edge', id: edge.id })}
          ariaLabelConfig={{
            'node.a11yDescription.default': '按回车键打开此卡片的来源',
            'edge.a11yDescription.default': '按回车键打开此关系的来源',
          }}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1.2} color="#d9ded1" variant={BackgroundVariant.Dots} />
          <ZoomTools viewport={viewport} />
        </ReactFlow>
      )}
    </div>
  );
}
