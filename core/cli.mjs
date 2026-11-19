import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { openStore, recordEvent, storeStatus } from './store.mjs'

const [command, ...args] = process.argv.slice(2)

async function main() {
  const { values } = parseArgs({
    args,
    options: { workspace: { type: 'string' }, finished: { type: 'boolean' } },
  })
  if (!values.workspace) throw new Error('Provide --workspace <root>')
  const store = openStore(values.workspace)
  try {
    if (command === 'hook') {
      const payload = JSON.parse(readFileSync(0, 'utf8').replace(/^\uFEFF/, ''))
      const stopped = recordEvent(store, payload)
      if (stopped) {
        const child = spawn(process.execPath, [
          fileURLToPath(import.meta.url), 'worker', '--workspace', store.root,
        ], { detached: true, stdio: 'ignore', windowsHide: true })
        child.on('error', () => {})
        child.unref()
      }
      console.log('{}')
      return
    }
    if (command === 'status') {
      console.log(JSON.stringify(storeStatus(store)))
      return
    }
    if (command === 'snapshot') {
      const { snapshot } = await import('./memory.mjs')
      console.log(JSON.stringify(snapshot(store, { includeOpen: !values.finished })))
      return
    }
    if (command === 'process' || command === 'worker') {
      const { processTurns } = await import('./memory.mjs')
      const result = await processTurns(store)
      if (command === 'process') console.log(JSON.stringify(result))
      if (result.error) process.exitCode = 1
      return
    }
    throw new Error(`Unsupported command: ${command}`)
  } finally {
    store.db.close()
  }
}

try {
  await main()
} catch (error) {
  if (command === 'hook') {
    console.log(JSON.stringify({ systemMessage: `项目记忆记录失败：${error.message}` }))
  } else {
    console.error(error.message)
    process.exitCode = 1
  }
}
