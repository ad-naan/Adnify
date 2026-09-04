import { parentPort, workerData } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

mkdirSync(dirname(workerData.databasePath), { recursive: true })
const db = new DatabaseSync(workerData.databasePath)
db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(collection,id))')
parentPort!.on('message', ({ id, operation, table, key, value }) => {
  try {
    let result: unknown
    if (operation === 'get') {
      const row = db.prepare('SELECT data FROM records WHERE collection=? AND id=?').get(table, key)
      result = row ? JSON.parse(row.data as string) : undefined
    } else if (operation === 'list') {
      result = db.prepare('SELECT data FROM records WHERE collection=?').all(table).map(row => JSON.parse(row.data as string))
    } else if (operation === 'put') {
      db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data').run(table, key, JSON.stringify(value))
    } else if (operation === 'putMany') {
      db.exec('BEGIN IMMEDIATE')
      try {
        const statement = db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data')
        for (const entry of value) statement.run(entry.table, entry.id, JSON.stringify(entry.value))
        db.exec('COMMIT')
      } catch (error) { db.exec('ROLLBACK'); throw error }
    } else if (operation === 'delete') {
      db.prepare('DELETE FROM records WHERE collection=? AND id=?').run(table, key)
    } else throw new Error('Invalid storage operation')
    parentPort!.postMessage({ id, result })
  } catch (error) {
    parentPort!.postMessage({ id, error: error instanceof Error ? error.message : 'Asset storage failure' })
  }
})
