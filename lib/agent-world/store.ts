import {DatabaseSync} from 'node:sqlite';
import {createHash, randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import path from 'node:path';

export function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export type CallState = 'started' | 'completed' | 'uncertain';
export interface CallRecord {id: string; job: string; tool: string; input_hash: string; state: CallState; result: string | null}

/** Durable call receipts. A crash after dispatch is never interpreted as permission to retry. */
export class AgentStore {
  readonly db: DatabaseSync;
  constructor(file = path.join(process.cwd(), '.cache', 'agent-world', 'tools.sqlite')) {
    mkdirSync(path.dirname(file), {recursive: true}); this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY,job TEXT NOT NULL,tool TEXT NOT NULL,input_hash TEXT NOT NULL,state TEXT NOT NULL,result TEXT,created INTEGER NOT NULL,UNIQUE(job,tool,input_hash));
      CREATE TABLE IF NOT EXISTS assets(hash TEXT PRIMARY KEY,manifest TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS checkpoints(job TEXT NOT NULL,stage TEXT NOT NULL,input_hash TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(job,stage,input_hash));`);
  }
  checkpoint(job: string, stage: string, input: unknown, result?: unknown): unknown {
    const hash = digest(input);
    if (result !== undefined) this.db.prepare('INSERT OR REPLACE INTO checkpoints VALUES(?,?,?,?)').run(job, stage, hash, JSON.stringify(result));
    const row = this.db.prepare('SELECT result FROM checkpoints WHERE job=? AND stage=? AND input_hash=?').get(job, stage, hash) as {result: string} | undefined;
    return row ? JSON.parse(row.result) : undefined;
  }
  begin(job: string, tool: string, input: unknown): {record: CallRecord; cached: boolean} {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const hash = digest(input);
      const old = this.db.prepare('SELECT * FROM calls WHERE job=? AND tool=? AND input_hash=?').get(job, tool, hash) as unknown as CallRecord | undefined;
      if (old) {
        if (old.state !== 'completed') throw Error('Previous model call is unresolved; recover its receipt before retrying');
        this.db.exec('COMMIT'); return {record: old, cached: true};
      }
      const id = randomUUID();
      this.db.prepare("INSERT INTO calls VALUES(?,?,?,?,'started',NULL,?)").run(id, job, tool, hash, Date.now());
      this.db.exec('COMMIT'); return {record: {id, job, tool, input_hash: hash, state: 'started', result: null}, cached: false};
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  complete(id: string, result: unknown) {
    if (!this.db.prepare("UPDATE calls SET state='completed',result=? WHERE id=? AND state='started'").run(JSON.stringify(result), id).changes) throw Error('Call receipt is not active');
  }
  uncertain(id: string) { this.db.prepare("UPDATE calls SET state='uncertain' WHERE id=? AND state='started'").run(id); }
  register(hash: string, manifest: unknown) { this.db.prepare('INSERT OR IGNORE INTO assets VALUES(?,?)').run(hash, JSON.stringify(manifest)); }
  assets(): unknown[] { return (this.db.prepare('SELECT manifest FROM assets ORDER BY hash').all() as {manifest: string}[]).map(r => JSON.parse(r.manifest)); }
  close() { this.db.close(); }
}
