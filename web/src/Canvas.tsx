import { useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  getSmoothStepPath,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
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
type CanvasEdge = Edge<{ item: Relationship; emphasis: boolean; onSelect: (selection: Selection) => void }, 'relationship'>;
type LayoutPosition = XYPosition & { compactY: number };

const columnGap = 270;
const rowGap = 158;

export function arrangeFrames(frames: Frame[]): Map<string, LayoutPosition> {
  const positions = new Map<string, LayoutPosition>();
  const rows = [0, 0, 0];
  for (const [index, frame] of frames.entries()) {
    for (const node of frame.nodes) {
      if (positions.has(node.id)) continue;
      const column = node.kind === 'goal' ? 0 : index === 0 && node.kind === 'idea' ? 1 : 2;
      const row = rows[column]++;
      const slot = row === 0 ? 0 : Math.ceil(row / 2) * (row % 2 ? 1 : -1);
      positions.set(node.id, {
        x: column * columnGap,
        y: slot * rowGap + (column === 1 ? 45 : 0),
        compactY: positions.size * 153,
      });
    }
  }
  return positions;
}

function Card({ data, selected }: NodeProps<CanvasNode>) {
  const { item, focused } = data;
  const Icon = kindIcons[item.kind];
  const StatusIcon = item.status === 'done' ? Check : item.status === 'superseded' ? ArrowDownLeft : Circle;
  return (
    <div className="memory-card" data-status={item.status} data-focus={focused} data-selected={selected}>
      <Handle id="in-left" type="target" position={Position.Left} />
      <Handle id="out-left" type="source" position={Position.Left} />
      <Handle id="in-right" type="target" position={Position.Right} />
      <Handle id="out-right" type="source" position={Position.Right} />
      <Handle id="in-top" type="target" position={Position.Top} />
      <Handle id="out-top" type="source" position={Position.Top} />
      <Handle id="in-bottom" type="target" position={Position.Bottom} />
      <Handle id="out-bottom" type="source" position={Position.Bottom} />
      <div className="memory-card-meta">
        <span className="memory-card-kind"><Icon size={14} />{kindLabels[item.kind]}</span>
        <span className="memory-card-status"><StatusIcon size={10} />{focused ? '当前关注' : statusLabels[item.status]}</span>
      </div>
      <strong title={item.title}>{item.title}</strong>
      {item.summary && <p>{item.summary}</p>}
    </div>
  );
}

function Relation(props: EdgeProps<CanvasEdge>) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
    borderRadius: 13,
    offset: 21,
  });
  const emphasis = props.data?.emphasis;
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={props.markerEnd}
        style={{ stroke: emphasis ? '#aee570' : '#606b63', strokeWidth: emphasis ? 1.8 : 1.25 }}
      />
      <EdgeLabelRenderer>
        <button
          type="button"
          className="edge-label nodrag nopan"
          data-emphasis={emphasis}
          onClick={() => props.data?.onSelect({ type: 'edge', id: props.id })}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          {props.data?.item.label}
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { memory: Card };
const edgeTypes = { relationship: Relation };

function ZoomTools() {
  const graph = useReactFlow();
  return (
    <div className="canvas-zoom" aria-label="画布缩放">
      <button type="button" title="缩小" aria-label="缩小" onClick={() => void graph.zoomOut({ duration: 150 })}><Minus size={15} /></button>
      <button type="button" title="适合画布" aria-label="适合画布" onClick={() => void graph.fitView({ padding: 0.17, maxZoom: 1.03, duration: 220 })}><Focus size={16} /></button>
      <button type="button" title="放大" aria-label="放大" onClick={() => void graph.zoomIn({ duration: 150 })}><Plus size={15} /></button>
    </div>
  );
}

interface CanvasProps {
  frame: Frame;
  positions: Map<string, LayoutPosition>;
  selection: Selection | null;
  allNodes: boolean;
  compact: boolean;
  onSelect: (selection: Selection) => void;
}

export function Canvas({ frame, positions, selection, allNodes, compact, onSelect }: CanvasProps) {
  const { nodes, edges } = useMemo(() => {
    const visible = new Set<string>();
    if (!allNodes && frame.focusId) {
      visible.add(frame.focusId);
      for (const edge of frame.edges) {
        if (edge.from === frame.focusId) visible.add(edge.to);
        if (edge.to === frame.focusId) visible.add(edge.from);
      }
      if (selection?.type === 'node') visible.add(selection.id);
      const selectedEdge = selection?.type === 'edge' && frame.edges.find(edge => edge.id === selection.id);
      if (selectedEdge) {
        visible.add(selectedEdge.from);
        visible.add(selectedEdge.to);
      }
    }
    const nodes: CanvasNode[] = frame.nodes
      .filter(node => !visible.size || visible.has(node.id))
      .map(node => {
        const position = positions.get(node.id) ?? { x: 0, y: 0, compactY: 0 };
        return {
          id: node.id,
          type: 'memory',
          position: compact ? { x: position.x / 12, y: position.compactY } : position,
          data: { item: node, focused: node.id === frame.focusId },
          selected: selection?.type === 'node' && selection.id === node.id,
          draggable: false,
          selectable: true,
          ariaLabel: `${kindLabels[node.kind]}，${node.title}，${statusLabels[node.status]}`,
        };
      });
    const visiblePositions = new Map(nodes.map(node => [node.id, node.position]));
    const edges: CanvasEdge[] = frame.edges.flatMap(edge => {
      const source = visiblePositions.get(edge.from);
      const target = visiblePositions.get(edge.to);
      if (!source || !target) return [];
      const pointsRight = target.x > source.x;
      const pointsDown = target.y > source.y;
      const selected = selection?.type === 'edge' && selection.id === edge.id;
      const emphasis = selected || frame.focusId === edge.from || frame.focusId === edge.to;
      return [{
        id: edge.id,
        source: edge.from,
        target: edge.to,
        type: 'relationship',
        sourceHandle: compact ? (pointsDown ? 'out-bottom' : 'out-top') : (pointsRight ? 'out-right' : 'out-left'),
        targetHandle: compact ? (pointsDown ? 'in-top' : 'in-bottom') : (pointsRight ? 'in-left' : 'in-right'),
        markerEnd: { type: MarkerType.ArrowClosed, width: 13, height: 13, color: emphasis ? '#aee570' : '#606b63' },
        selected,
        data: { item: edge, emphasis, onSelect },
        ariaLabel: `关系：${edge.label}`,
      }];
    });
    return { nodes, edges };
  }, [frame, positions, selection, allNodes, compact, onSelect]);

  return (
    <ReactFlow<CanvasNode, CanvasEdge>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: compact ? 0.14 : 0.18, maxZoom: 1.02 }}
      minZoom={0.15}
      maxZoom={1.75}
      nodesDraggable={false}
      nodesConnectable={false}
      onNodeClick={(_, node) => onSelect({ type: 'node', id: node.id })}
      onEdgeClick={(_, edge) => onSelect({ type: 'edge', id: edge.id })}
      ariaLabelConfig={{
        'node.a11yDescription.default': '按回车键选择此卡片，按 Esc 取消选择',
        'edge.a11yDescription.default': '按回车键选择此关系，按 Esc 取消选择',
      }}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={19} size={1} color="#344037" variant={BackgroundVariant.Dots} />
      <ZoomTools />
    </ReactFlow>
  );
}
