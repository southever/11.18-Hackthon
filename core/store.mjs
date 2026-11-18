import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const eventNames = new Set(['UserPromptSubmit', 'PostToolUse', 'Stop'])
const leaseDuration = 5 * 60 * 1000

function hash(parts) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24)
}

function pathKey(path) {
  return process.platform === 'win32' ? path.toLowerCase() : path
}

export function openStore(workspace) {
  const root = realpathSync(resolve(workspace))
  const project = { id: hash(pathKey(root)), title: basename(root) || root }
  const dataRoot = process.env.MAILUO_DATA_DIR || join(
    process.env.LOCALAPPDATA || process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'),
    'Mailuo',
  )
  const directory = join(resolve(dataRoot), project.id)
  mkdirSync(directory, { recursive: true })
  const db = new DatabaseSync(join(directory, 'project.sqlite'), { timeout: 5000 })
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS turns (
      turn_key TEXT PRIMARY KEY,
      turn_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      stop_seq INTEGER UNIQUE,
      state TEXT NOT NULL DEFAULT 'open',
      claim TEXT,
      expires_at INTEGER,
      error TEXT,
      frame TEXT
    );
    CREATE TABLE IF NOT EXISTS events (
      seq INTEGER PRIMARY KEY,
      source_id TEXT NOT NULL UNIQUE,
      turn_key TEXT NOT NULL REFERENCES turns(turn_key),
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS turn_events ON events(turn_key, seq);
  `)
  return { db, root, directory, project }
}

function transaction(db, run) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = run()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function renderToolValue(value) {
  return typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2)
}

export function recordEvent(store, event) {
  const { db, root } = store
  const { hook_event_name: name, session_id: session, turn_id: turn, cwd } = event
  if (!eventNames.has(name)) return false
  if (![session, turn, cwd].every(value => typeof value === 'string' && value.length)) {
    throw new Error('Codex hook payload is missing session_id, turn_id, or cwd')
  }
  const eventPath = pathKey(realpathSync(cwd))
  const localPath = relative(pathKey(root), eventPath)
  if (isAbsolute(localPath) || localPath === '..' || localPath.startsWith(`..${sep}`)) return false

  const turnKey = hash([session, turn])
  let kind
  let text
  let identity
  if (name === 'UserPromptSubmit') {
    kind = 'user'
    text = typeof event.prompt === 'string' ? event.prompt : ''
  } else if (name === 'PostToolUse') {
    kind = 'tool'
    text = [
      event.tool_name || 'Codex 工具',
      renderToolValue(event.tool_input),
      renderToolValue(event.tool_response),
    ].join('\n\n')
    identity = event.tool_use_id
  } else {
    kind = 'assistant'
    text = typeof event.last_assistant_message === 'string' ? event.last_assistant_message : ''
  }
  const sourceId = `src-${hash([turnKey, name, identity || text])}`

  return transaction(db, () => {
    db.prepare('INSERT OR IGNORE INTO turns (turn_key, turn_id, session_id) VALUES (?, ?, ?)').run(
      turnKey, turn, session,
    )
    const result = db.prepare(`
      INSERT OR IGNORE INTO events(source_id, turn_key, kind, text, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).run(sourceId, turnKey, kind, text, new Date().toISOString())
    if (name === 'Stop' && result.changes) {
      db.prepare(`
        UPDATE turns SET stop_seq = ?, state = 'pending'
        WHERE turn_key = ? AND stop_seq IS NULL
      `).run(result.lastInsertRowid, turnKey)
    }
    return name === 'Stop'
  })
}

export function getTurnSources(store, turn) {
  return store.db.prepare(`
    SELECT source_id AS id, kind, text, timestamp FROM events
    WHERE turn_key = ? AND seq <= COALESCE(?, 9223372036854775807) AND text <> ''
    ORDER BY seq
  `).all(turn.turn_key, turn.stop_seq)
}

export function listTurns(store, includeOpen) {
  return store.db.prepare(`
    SELECT * FROM turns
    WHERE stop_seq IS NOT NULL OR (
      ? AND (SELECT MAX(seq) FROM events WHERE turn_key = turns.turn_key)
        > COALESCE((SELECT MAX(stop_seq) FROM turns), 0)
    )
    ORDER BY stop_seq IS NULL, COALESCE(stop_seq, rowid)
  `).all(Number(includeOpen))
}

export function storeStatus(store) {
  const { db } = store
  const eventCount = db.prepare('SELECT COUNT(*) AS total FROM events').get().total
  const turnCounts = db.prepare('SELECT state, COUNT(*) AS total FROM turns GROUP BY state').all()
  const lastError = db.prepare(`
    SELECT error FROM turns WHERE state = 'failed' ORDER BY stop_seq DESC LIMIT 1
  `).get()?.error ?? null
  return { eventCount, turns: Object.fromEntries(turnCounts.map(row => [row.state, row.total])), lastError }
}

export function claimTurn(store) {
  const { db } = store
  return transaction(db, () => {
    const turn = db.prepare(`
      SELECT * FROM turns WHERE stop_seq IS NOT NULL AND state <> 'ready'
      ORDER BY stop_seq LIMIT 1
    `).get()
    if (!turn || (turn.state === 'processing' && turn.expires_at > Date.now())) return null
    const claim = randomUUID()
    db.prepare(`
      UPDATE turns SET state = 'processing', claim = ?, expires_at = ?, error = NULL
      WHERE turn_key = ?
    `).run(claim, Date.now() + leaseDuration, turn.turn_key)
    return { ...turn, claim }
  })
}

export function previousFrame(store, turn) {
  const row = store.db.prepare(`
    SELECT frame FROM turns WHERE state = 'ready' AND stop_seq < ? ORDER BY stop_seq DESC LIMIT 1
  `).get(turn.stop_seq)
  return row ? JSON.parse(row.frame) : null
}

export function finishTurn(store, turn, frame, error = null) {
  return store.db.prepare(`
    UPDATE turns SET state = ?, frame = ?, error = ?, claim = NULL, expires_at = NULL
    WHERE turn_key = ? AND claim = ? AND state = 'processing'
  `).run(error ? 'failed' : 'ready', frame ? JSON.stringify(frame) : null, error, turn.turn_key, turn.claim)
}
