import { serveUtility } from '../process/utilityServer'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

let db: DatabaseSync | undefined
let openedPath: string | undefined
serveUtility(raw => {
    const { operation, databasePath, table, key, value } = raw as {
      operation: string; databasePath: string; table: string; key: string;
      value: Array<{ table: string; id: string; value: unknown }>
    }
    if (operation === 'close') {
      db?.exec('PRAGMA wal_checkpoint(TRUNCATE)')
      db?.close()
      db = undefined
      return
    }
    if (openedPath && openedPath !== databasePath) throw new Error('Asset database cannot change within a process')
    if (!db) {
      mkdirSync(dirname(databasePath), { recursive: true })
      db = new DatabaseSync(databasePath)
      openedPath = databasePath
      db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(collection,id))')
    }
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
    return result
})
