import { applyExtraction, extractTurn } from './extract.mjs'
import { claimTurn, finishTurn, getTurnSources, listTurns, previousFrame } from './store.mjs'

const escapeText = value => value.replace(/\\/g, '\\\\').replace(/[\x60*_\[\]<>#]/g, '\\$&')
const summarize = (text, limit = 160) => {
  const line = text.trim().replace(/\s+/g, ' ')
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line
}

export function renderSpec(project, { focusId, nodes, edges, sources }) {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const bySource = new Map(sources.map(source => [source.id, source]))
  const citations = new Map()
  const cite = ids => ids.slice(0, 2).map(id => {
    if (!citations.has(id)) citations.set(id, citations.size + 1)
    return `[证据 ${citations.get(id)}](#source-${citations.get(id)})`
  }).join('、')
  const nodeLine = node => {
    const details = escapeText(summarize(node.summary, 600))
    return `- **${escapeText(node.title)}**：${details}（${cite(node.sourceIds)}）`
  }
  const edgeLine = edge => {
    const from = escapeText(byId.get(edge.from).title)
    const to = escapeText(byId.get(edge.to).title)
    return `- **${from}** ${escapeText(edge.label)} **${to}**（${cite(edge.sourceIds)}）`
  }
  const goals = nodes.filter(node => node.kind === 'goal' && node.status === 'active')
  const directions = nodes.filter(node => node.kind !== 'goal' && node.status === 'active')
  const tradeoffEdges = edges.filter(edge => ['取代', '沿用'].includes(edge.label))
  const replaced = new Set(tradeoffEdges.filter(edge => edge.label === '取代').map(edge => edge.to))
  const nodeTitle = id => `**${escapeText(byId.get(id).title)}**`
  const replacement = tradeoffEdges.findLast(edge => edge.label === '取代'
    && byId.get(edge.from).status === 'active' && byId.get(edge.to).status === 'superseded')
  const reuse = tradeoffEdges.findLast(edge => edge.label === '沿用' && byId.get(edge.from).status === 'active')
  const current = directions.find(node => node.id === focusId) ?? directions.at(-1)
  const overview = [
    goals[0] && `项目目标是${nodeTitle(goals[0].id)}`,
    replacement
      ? `当前采用${nodeTitle(replacement.from)}，取代${nodeTitle(replacement.to)}`
      : current && `当前方向为${nodeTitle(current.id)}`,
    reuse && `${nodeTitle(reuse.from)}沿用${nodeTitle(reuse.to)}`,
  ].filter(Boolean).join('。')
  const lines = [`# ${escapeText(project.title)} · 当前项目说明`]
  if (overview) lines.push('', `${overview}。`)
  const section = (heading, items, empty) => {
    if (items.length) lines.push('', `## ${heading}`, '', ...items)
    else if (empty) lines.push('', `## ${heading}`, '', empty)
  }
  section('当前目标', goals.map(nodeLine), '当前记录尚未明确项目目标。')
  section('已定方向', directions.map(nodeLine), '当前记录尚未明确选择。')
  section('重要取舍', [
    ...tradeoffEdges.map(edgeLine),
    ...nodes.filter(node => node.status === 'superseded' && !replaced.has(node.id)).map(nodeLine),
  ])
  section('实际尝试', nodes.filter(node => node.kind === 'attempt' && node.status === 'done').map(nodeLine))
  section('待定事项', nodes.filter(node => node.status === 'proposed').map(nodeLine))
  if (citations.size) {
    const labels = { user: '用户发言', assistant: 'Codex 回复', tool: '工具记录' }
    lines.push('', '## 依据', '')
    for (const [id, index] of citations) {
      const source = bySource.get(id)
      lines.push(`<a id="source-${index}"></a>`, `${index}. ${labels[source.kind]}：${escapeText(summarize(source.text))}`, '')
    }
  }
  return `${lines.join('\n').trimEnd()}\n`
}

function buildFrame(turn, sources, previous, graph) {
  return {
    id: turn.turn_id,
    sessionId: turn.session_id,
    timestamp: sources.at(-1)?.timestamp ?? new Date().toISOString(),
    ...graph,
    sources: [...(previous?.sources ?? []), ...sources],
  }
}

export function snapshot(store, { includeOpen = true } = {}) {
  const frames = []
  for (const turn of listTurns(store, includeOpen)) {
    if (turn.frame) {
      frames.push(JSON.parse(turn.frame))
      continue
    }
    const previous = frames.at(-1)
    const sources = getTurnSources(store, turn)
    const prompt = sources.find(source => source.kind === 'user')?.text
    const frame = buildFrame(turn, sources, previous, {
      title: prompt ? summarize(prompt, 60) : 'Codex 对话',
      focusId: previous?.focusId ?? null,
      nodes: previous?.nodes ?? [],
      edges: previous?.edges ?? [],
      state: turn.state,
    })
    const stateText = {
      open: 'Codex 正在工作，本轮记录会继续更新。',
      pending: '本轮记录已保存，等待整理。',
      processing: '本轮记录已保存，正在整理。',
      failed: '本轮记录已保存，整理可重试。',
    }
    const status = stateText[turn.state]
    frame.spec = `${renderSpec(store.project, frame)}\n> ${status}\n`
    frames.push(frame)
  }
  return { version: 1, project: store.project, frames }
}

export async function processTurns(store, extract = extractTurn) {
  let processed = 0
  for (let turn = claimTurn(store); turn; turn = claimTurn(store)) {
    try {
      const previous = previousFrame(store, turn)
      const sources = getTurnSources(store, turn)
      const result = sources.length
        ? await extract(sources, previous)
        : { title: 'Codex 对话', focusId: null, nodes: [], edges: [] }
      const graph = applyExtraction(result, sources, previous)
      const frame = buildFrame(turn, sources, previous, graph)
      frame.spec = renderSpec(store.project, frame)
      processed += finishTurn(store, turn, frame).changes
    } catch (error) {
      finishTurn(store, turn, null, error.message || '整理失败')
      return { processed, error: error.message || '整理失败' }
    }
  }
  return { processed }
}
