import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

export type JobState = "queued" | "running" | "ready" | "needs_review" | "failed" | "cancelled";
export interface SceneJob {
  id:string; owner:string; topic:string; state:JobState; phase:string;
  created:number; updated:number; lease:number; token:string|null; attempts:number;
  checkpoint:string|null; result:string|null; error:string|null;
}
export class SceneJobs {
  db:DatabaseSync;
  constructor(file=process.env.SCENE_JOBS_DB || path.join(process.cwd(),".cache","scene-jobs.sqlite")) {
    mkdirSync(path.dirname(file),{recursive:true});
    this.db=new DatabaseSync(file);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY,owner TEXT NOT NULL,topic TEXT NOT NULL,state TEXT NOT NULL,phase TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL,lease INTEGER NOT NULL DEFAULT 0,token TEXT,attempts INTEGER NOT NULL DEFAULT 0,checkpoint TEXT,result TEXT,error TEXT);
      CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(state,created);
      CREATE INDEX IF NOT EXISTS jobs_owner ON jobs(owner,created);
      CREATE INDEX IF NOT EXISTS jobs_created ON jobs(created);
      CREATE TABLE IF NOT EXISTS workers (id TEXT PRIMARY KEY, heartbeat INTEGER NOT NULL);`);
  }
  get(id:string,owner?:string):SceneJob|undefined {
    return (owner?this.db.prepare("SELECT * FROM jobs WHERE id=? AND owner=?").get(id,owner):this.db.prepare("SELECT * FROM jobs WHERE id=?").get(id)) as unknown as SceneJob|undefined;
  }
  enqueue(owner:string,topic:string,initialCheckpoint?:unknown):SceneJob {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing=this.db.prepare("SELECT * FROM jobs WHERE owner=? AND topic=? AND state IN ('queued','running')").get(owner,topic) as unknown as SceneJob|undefined;
      if(existing){this.db.exec("COMMIT");return existing;}
      const active=this.db.prepare("SELECT count(*) AS n FROM jobs WHERE state IN ('queued','running')").get() as {n:number};
      const recent=this.db.prepare("SELECT count(*) AS n FROM jobs WHERE owner=? AND created>?").get(owner,Date.now()-86400000) as {n:number};
      const daily=this.db.prepare("SELECT count(*) AS n FROM jobs WHERE created>?").get(Date.now()-86400000) as {n:number};
      if(active.n>=20||recent.n>=10||daily.n>=100)throw new Error("Generation capacity reached. Please try later.");
      const id=randomUUID(),now=Date.now();
      this.db.prepare("INSERT INTO jobs(id,owner,topic,state,phase,created,updated,checkpoint) VALUES(?,?,?,'queued','Waiting for worker',?,?,?)").run(id,owner,topic,now,now,initialCheckpoint===undefined?null:JSON.stringify(initialCheckpoint));
      this.db.exec("COMMIT");return this.get(id)!;
    }catch(e){this.db.exec("ROLLBACK");throw e;}
  }
  heartbeat(worker:string) {
    this.db.prepare("INSERT INTO workers VALUES(?,?) ON CONFLICT(id) DO UPDATE SET heartbeat=excluded.heartbeat").run(worker,Date.now());
  }
  healthy(){return !!this.db.prepare("SELECT id FROM workers WHERE heartbeat>? LIMIT 1").get(Date.now()-30000);}
  claim({recoverOnly=false}:{recoverOnly?:boolean}={}):SceneJob|undefined {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const now=Date.now();
      this.db.prepare("UPDATE jobs SET state='failed',phase='Worker recovery limit reached',error='Generation was interrupted repeatedly. Please retry.',token=NULL WHERE state='running' AND lease<? AND attempts>=3").run(now);
      const running=this.db.prepare("SELECT count(*) AS n FROM jobs WHERE state='running' AND lease>=?").get(now) as {n:number};
      if(running.n>=2){this.db.exec("COMMIT");return;}
      const where=recoverOnly?"state='running' AND lease<? AND attempts<3":"state='queued' OR (state='running' AND lease<? AND attempts<3)";
      const job=this.db.prepare(`SELECT * FROM jobs WHERE ${where} ORDER BY created LIMIT 1`).get(now) as unknown as SceneJob|undefined;
      if(!job){this.db.exec("COMMIT");return;}
      this.db.prepare("UPDATE jobs SET state='running',phase='Starting worker',token=?,lease=?,updated=?,attempts=attempts+1 WHERE id=?").run(randomUUID(),now+60000,now,job.id);
      this.db.exec("COMMIT");return this.get(job.id);
    }catch(e){this.db.exec("ROLLBACK");throw e;}
  }
  update(job:SceneJob,phase:string,checkpoint?:unknown){
    const r=this.db.prepare("UPDATE jobs SET phase=?,updated=?,lease=?,checkpoint=COALESCE(?,checkpoint) WHERE id=? AND token=? AND state='running' AND lease>?").run(phase,Date.now(),Date.now()+60000,checkpoint===undefined?null:JSON.stringify(checkpoint),job.id,job.token,Date.now());
    if(!r.changes)throw new Error("Job cancelled or worker lease lost");
  }
  finish(job:SceneJob,state:JobState,result:unknown,error:string|null=null){
    return this.db.prepare("UPDATE jobs SET state=?,phase=?,result=?,error=?,updated=?,token=NULL,lease=0 WHERE id=? AND token=? AND state='running' AND lease>?").run(state,state,JSON.stringify(result),error,Date.now(),job.id,job.token,Date.now()).changes>0;
  }
  cancel(id:string,owner:string){
    this.db.prepare("UPDATE jobs SET state='cancelled',phase='Cancelled',token=NULL,lease=0,updated=? WHERE id=? AND owner=? AND state IN ('queued','running')").run(Date.now(),id,owner);
  }
}
let singleton:SceneJobs|undefined;
export const sceneJobs=()=>singleton??=new SceneJobs();
export function publicJob(job:SceneJob){return {id:job.id,topic:job.topic,state:job.state,phase:job.phase,created:job.created,updated:job.updated,error:job.error,result:job.result?JSON.parse(job.result):null};}
