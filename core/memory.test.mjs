import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { applyExtraction } from './extract.mjs'
import { processTurns, snapshot } from './memory.mjs'
import { claimTurn, openStore, recordEvent, storeStatus } from './store.mjs'

function fixture(t) {
  const temp = mkdtempSync(join(tmpdir(), 'mailuo-test-'))
  const workspace = join(temp, '校园电影节')
  const other = join(temp, '另一个项目')
  mkdirSync(workspace)
  mkdirSync(other)
  const old = process.env.MAILUO_DATA_DIR
  process.env.MAILUO_DATA_DIR = join(temp, 'data')
  const stores = []
  t.after(() => {
    stores.forEach(store => store.db.close())
    if (old === undefined) delete process.env.MAILUO_DATA_DIR
    else process.env.MAILUO_DATA_DIR = old
    const checkedTemp = join(tmpdir(), temp.split(/[\\/]/).at(-1))
    assert.equal(temp, checkedTemp)
    assert.match(checkedTemp.split(/[\\/]/).at(-1), /^mailuo-test-/)
    rmSync(checkedTemp, { recursive: true, force: true })
  })
  return {
    workspace, other,
    open(root = workspace) {
      const store = openStore(root)
      stores.push(store)
      return store
    },
  }
}

const firstPrompt = '帮我做校园电影节网站，首页先放海报轮播。'
const secondPrompt = '首页改成场次表，海报放到详情页。'

test('a stopped organizer can be recovered before the lease expires', t => {
  const store = fixture(t).open()
  captureTurn(store, 'first', firstPrompt)
  const owner = claimTurn(store)
  assert.equal(claimTurn(store), null)
  store.db.prepare('UPDATE turns SET claim = ? WHERE turn_key = ?')
    .run('2147483647:original', owner.turn_key)
  const recovered = claimTurn(store)
  assert.equal(recovered.turn_key, owner.turn_key)
  assert.notEqual(recovered.claim, owner.claim)
})

function captureTurn(store, session, prompt) {
  const common = { session_id: session, turn_id: `turn-${session}`, cwd: store.root }
  const user = { ...common, hook_event_name: 'UserPromptSubmit', prompt }
  const tool = {
    ...common, hook_event_name: 'PostToolUse', tool_name: 'apply_patch',
    tool_use_id: 'edit-index', tool_input: { command: '修改 index.html' },
    tool_response: 'Success. Updated index.html',
  }
  const stop = { ...common, hook_event_name: 'Stop', last_assistant_message: '已更新 index.html。' }
  for (const event of [user, tool, stop, user, tool, stop]) recordEvent(store, event)
}

function node(id, title, status, source, kind = 'idea') {
  return { id, title, summary: title, kind, status, sourceIds: [source.id] }
}

test('capture, persist and merge two sessions without changing historical frames', async t => {
  const dirs = fixture(t)
  const store = dirs.open()
  assert.deepEqual(snapshot(store).frames, [])
  captureTurn(store, 'first', firstPrompt)
  const before = snapshot(store).frames[0]
  assert.match(before.spec, /等待整理/)
  assert.deepEqual(before.sources.map(source => source.kind), ['user', 'tool', 'assistant'])
  assert.equal(before.sources[0].text, firstPrompt)
  assert.match(before.sources[1].text, /Success. Updated index\.html/)
  assert.equal(storeStatus(store).eventCount, 3)
  assert.deepEqual(snapshot(dirs.open(dirs.other)).frames, [])

  const first = await processTurns(store, async ([user, tool]) => ({
    title: '首页轮播',
    focusId: 'carousel',
    nodes: [
      node('site', '校园电影节网站', 'active', user, 'goal'),
      node('carousel', '首页海报轮播', 'active', user),
      node('poster', '电影海报', 'active', user),
      node('index-edit', '更新首页文件', 'done', tool, 'attempt'),
    ],
    edges: [],
  }))
  assert.equal(first.processed, 1)
  const firstFrame = snapshot(store).frames[0]
  assert.match(firstFrame.spec, /首页海报轮播/)

  const restarted = dirs.open()
  captureTurn(restarted, 'second', secondPrompt)
  const failed = await processTurns(restarted, async ([user]) => ({
    title: '不可信',
    focusId: 'unknown',
    nodes: [{ ...node('new', '场次表', 'active', user), sourceIds: ['unknown-evidence'] }],
    edges: [],
  }))
  assert.match(failed.error, /来源/)
  const pending = snapshot(restarted).frames[1]
  assert.match(pending.spec, /整理可重试/)
  assert.ok(pending.sources.some(source => source.text === secondPrompt))
  assert.equal(pending.focusId, 'carousel')

  const second = await processTurns(restarted, async ([user], previous) => {
    assert.deepEqual(previous, firstFrame)
    return {
      title: '改用场次表',
      focusId: 'schedule',
      nodes: [
        node('carousel', '首页海报轮播', 'superseded', user),
        node('schedule', '首页场次表', 'active', user),
        node('detail', '海报详情页', 'active', user),
      ],
      edges: [
        { from: 'schedule', to: 'carousel', label: '取代', sourceIds: [user.id] },
        { from: 'detail', to: 'poster', label: '沿用', sourceIds: [user.id] },
      ],
    }
  })
  assert.equal(second.processed, 1)
  assert.equal((await processTurns(restarted, assert.fail)).processed, 0)
  const [history, latest] = snapshot(dirs.open()).frames
  assert.deepEqual(history, firstFrame)
  assert.deepEqual([history.sessionId, latest.sessionId], ['first', 'second'])
  assert.deepEqual(latest.edges.map(edge => edge.label), ['取代', '沿用'])
  assert.equal(latest.nodes.find(item => item.id === 'carousel').status, 'superseded')
  assert.equal(latest.sources.length, 6)
  assert.match(latest.spec, /首页场次表/)
  assert.match(latest.spec, /当前采用\*\*首页场次表\*\*，取代\*\*首页海报轮播\*\*/)
  assert.doesNotMatch(latest.spec.split('## 已定方向')[1].split('## 重要取舍')[0], /首页海报轮播/)
  assert.doesNotMatch(history.spec, /场次表/)
})

test('live snapshot shows incoming prompt and tool results before Stop', async t => {
  const dirs = fixture(t)
  const store = dirs.open()
  const event = { session_id: 'unfinished', turn_id: 'unfinished-turn', cwd: store.root }
  recordEvent(store, { ...event, hook_event_name: 'UserPromptSubmit', prompt: firstPrompt })
  const [open] = snapshot(store).frames
  assert.equal(open.state, 'open')
  assert.match(open.spec, /正在工作/)
  assert.equal(open.sources[0].text, firstPrompt)
  assert.deepEqual(snapshot(store, { includeOpen: false }).frames, [])
  recordEvent(store, {
    ...event, hook_event_name: 'PostToolUse', tool_name: 'Bash',
    tool_use_id: 'shell-copy', tool_input: { command: 'copy a b' }, tool_response: '已复制文件',
  })
  assert.match(snapshot(store).frames[0].sources[1].text, /已复制文件/)
  captureTurn(store, 'finished', secondPrompt)
  const processed = await processTurns(store, async ([user]) => ({
    title: '场次表', focusId: 'schedule',
    nodes: [node('schedule', '首页场次表', 'active', user)], edges: [],
  }))
  assert.equal(processed.processed, 1)
  assert.deepEqual(snapshot(store).frames.map(frame => frame.sessionId), ['finished'])
})

test('assistant proposals cannot become user decisions or verified attempts', () => {
  const assistant = { id: 'assistant', kind: 'assistant', text: '可以用轮播。' }
  for (const [status, kind] of [['active', 'decision'], ['superseded', 'idea'], ['done', 'attempt']]) {
    assert.throws(() => applyExtraction({
      title: '美术方向', focusId: 'poster',
      nodes: [node('poster', '首页海报', status, assistant, kind)], edges: [],
    }, [assistant], null), /来源/)
  }
})
