'use client';
import {useEffect,useRef,useState} from 'react';
import type {WorldViewer} from '@/lib/physical-world-viewer.mjs';
import {describeBinding} from '@/lib/agent-world/behaviour-runtime';
import type {WorldPlan} from '@/lib/agent-world/contracts';
import type {TerrainPlan} from '@/lib/agent-world/terrain';
import styles from './PhysicalWorlds.module.css';
type Saved={id:string;title:string;manifestUrl:string;status:string;source:string};
type Job={id:string;topic:string;state:string;phase:string;error:string|null;result?:{plan:WorldPlan;terrain:TerrainPlan[];evaluation:{gaps:{target:string;reason:string}[]};critique:{issues:{target:string;reason:string}[]};generation?:{status:string;world?:Saved;gaps?:{target:string;reason:string}[]}}};
const running=(job:Job|null)=>job&&['queued','running'].includes(job.state);
const stageLabels:Record<string,string>={queued:'Waiting for generation','scene-recipe':'Designing the scene','scene-recipe-repair':'Checking scene components','recipe-review':'Checking your lesson requirements','recipe-coverage':'Checking your lesson requirements','recipe-revision':'Refining the scene','terrain-detail':'Planning the landforms','particle-appearance':'Choosing effect visuals','entity-routing':'Checking scene materials','routing-revision':'Correcting scene components', 'repair-representations':'Correcting the behaviour plan','repair-spatial':'Correcting scene placement','world-and-behaviour-repair':'Correcting the world plan',understand:'Understanding your lesson',research:'Finding references',plan:'Planning the world and its behaviour','spatial-layout':'Planning routes and scale',critique:'Reviewing the plan','inspect-existing-assets':'Checking available assets',grounding:'Placing the scene on the generated land','ground-material':'Generating the ground material',assemble:'Saving your world'};
export default function AgentWorlds(){
  const [prompt,setPrompt]=useState(''),[job,setJob]=useState<Job|null>(null),[worlds,setWorlds]=useState<Saved[]>([]);
  const [worker,setWorker]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[selected,setSelected]=useState<Saved|null>(null);
  const [ready,setReady]=useState(false),[paused,setPaused]=useState(false),[status,setStatus]=useState('');
  const [state,setState]=useState<ReturnType<WorldViewer['behaviourState']>>(null);
  const openedFromLink=useRef(false);
  const canvas=useRef<HTMLCanvasElement>(null),viewer=useRef<WorldViewer|null>(null);
  const gravityMagnitude=Math.abs((viewer.current?.manifest as {gravity?:number[]}|undefined)?.gravity?.[2]??9.81);
  useEffect(()=>{
    let active=true;
    const refresh=async()=>{try{
      const suffix=new URLSearchParams(location.search).has('qa')?'?includeFixtures=1':'';
      const r=await fetch('/api/agent/worlds'+suffix,{cache:'no-store'});if(!r.ok)throw Error('World library unavailable');
      const d=await r.json();if(active){setWorlds(d.worlds);setWorker(d.workerReady);if(!openedFromLink.current){openedFromLink.current=true;const id=new URLSearchParams(location.search).get('world');const linked=d.worlds.find((w:Saved)=>w.id===id);if(linked)setSelected(linked);}}
    }catch(e){if(active)setError(e instanceof Error?e.message:'Could not open library');}};
    void refresh();const timer=setInterval(refresh,15000);
    const id=localStorage.getItem('ed-agent-active-job')??localStorage.getItem('ed-agent-last-job');
    if(id)fetch('/api/agent/jobs?id='+encodeURIComponent(id)).then(async r=>{
      if(r.status===404){localStorage.removeItem('ed-agent-active-job');localStorage.removeItem('ed-agent-last-job');return;}
      if(r.ok){const j=await r.json();if(active){setJob(j);setPrompt(j.topic);}}
    }).catch(()=>{});
    return()=>{active=false;clearInterval(timer);};
  },[]);
  useEffect(()=>{if(job)localStorage.setItem('ed-agent-last-job',job.id);},[job?.id]);
  useEffect(()=>{
    if(!running(job))return;let active=true;let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{try{const r=await fetch('/api/agent/jobs?id='+job!.id,{cache:'no-store'});if(!r.ok)throw Error('Reconnecting to world creation');const next=await r.json();if(active){setJob(next);if(!running(next))localStorage.removeItem('ed-agent-active-job');}}
      catch(e){if(active)setError(e instanceof Error?e.message:'Could not update progress');}
      if(active)timer=setTimeout(poll,2000);};void poll();return()=>{active=false;clearTimeout(timer);};
  },[job?.id,job?.state]);
  useEffect(()=>{
    if(!selected||!canvas.current)return;const targetCanvas=canvas.current;let active=true;setReady(false);setPaused(false);setState(null);setError('');
    import('@/lib/physical-world-viewer.mjs').then(m=>{if(!active)throw Error('World was closed');return m.createWorldViewer(targetCanvas,selected.manifestUrl,s=>active&&setStatus(s));}).then(v=>{
      if(!active){v.dispose();return;}viewer.current=v;setReady(true);setState(v.behaviourState());
      if(new URLSearchParams(location.search).has('qa'))(window as Window&{__ED_AGENT_VIEWER?:WorldViewer}).__ED_AGENT_VIEWER=v;
    }).catch(e=>active&&setError(e.message));
    const timer=setInterval(()=>{if(active)setState(viewer.current?.behaviourState()??null);},200);
    return()=>{active=false;clearInterval(timer);viewer.current?.dispose();viewer.current=null;delete (window as Window&{__ED_AGENT_VIEWER?:WorldViewer}).__ED_AGENT_VIEWER;};
  },[selected?.id]);
  async function submit(){setBusy(true);setError('');try{
    const r=await fetch('/api/agent/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic:prompt})});
    const next=await r.json();if(!r.ok)throw Error(next.error);setJob(next);localStorage.setItem('ed-agent-active-job',next.id);
  }catch(e){setError(e instanceof Error?e.message:'Could not prepare world');}finally{setBusy(false);}}
  async function cancel(){if(!job)return;const r=await fetch('/api/agent/jobs?id='+job.id,{method:'DELETE'});if(!r.ok){setError('Cancellation failed');return;}setJob({...job,state:'cancelled'});localStorage.removeItem('ed-agent-active-job');}
  async function action(fn:()=>unknown|Promise<unknown>){try{await fn();return true;}catch(e){setError(e instanceof Error?e.message:'Action failed');return false;}}
  return <main className={styles.shell}>
    <header className={styles.header}><a href="/" className={styles.brand}>EduWorld<span className={styles.local}>LOCAL</span></a><span>Explore through experience</span></header>
    {selected?<section className={styles.explorer}>
      <canvas ref={canvas} className={styles.canvas} aria-label="Living world explorer"/>
      <div className={styles.worldHeading}><button onClick={()=>setSelected(null)}>← Your worlds</button><h1>{selected.title}</h1></div>
      <aside className={styles.inspector}><h2>World controls</h2><p>Interactive learning preview</p><p>Gravity: {gravityMagnitude.toFixed(2)} m/s² · Space to jump</p><details><summary>Try a gravity experiment</summary><p>Each jump starts at 3 m/s upward. On level ground, this gravity gives an ideal rise of {(4.5/gravityMagnitude).toFixed(2)} m and about {(6/gravityMagnitude).toFixed(2)} seconds in the air. Compare Earth: 0.46 m and 0.61 seconds with the same launch speed.</p><p>This models vertical motion; terrain and obstacles can shorten a jump.</p></details><p>{(viewer.current?.manifest as {living?:{objective?:string}}|undefined)?.living?.objective}</p>
        {state&&Object.entries(state.controls).map(([id,value])=><label key={id} style={{display:'block',margin:'14px 0',fontSize:12}}>{id.replaceAll('_',' ')} · {value.toFixed(1)}× <button type="button" style={{float:'right',fontSize:11}} onClick={()=>action(()=>viewer.current!.focusEntity(viewer.current!.manifest.living!.bindings.find(b=>b.id===id)!.targets[0]))}>Look</button>
          <input aria-label={id} type="range" min="0" max="3" step="0.1" value={value} onChange={e=>{viewer.current?.setBehaviourControl(id,Number(e.target.value));setState(viewer.current?.behaviourState()??null);}} style={{width:'100%'}}/><details style={{fontSize:11,lineHeight:1.5,opacity:.8,marginTop:5}}><summary>What this represents</summary><small>{describeBinding(viewer.current?.manifest.living?.bindings.find(b=>b.id===id)).join(' ')}</small></details></label>)}
        {state&&<dl><dt>Simulation time</dt><dd>{state.time.toFixed(1)} s</dd>{Object.entries(state.quantities).map(([id,value])=><div key={id} style={{gridColumn:'1 / -1'}}>{id}: {value.toFixed(2)} model units</div>)}</dl>}
      </aside>
      <div className={styles.controls}><p>{ready?'WASD to move · Space to jump · E to push · mouse to look · Escape to release':status}</p><div className={styles.actions}>
        <button disabled={!ready} onClick={()=>action(()=>viewer.current!.enter())}>Enter world</button>
        <button disabled={!ready} onClick={()=>setPaused(viewer.current!.pause())}>{paused?'Resume':'Pause'}</button>
        <button disabled={!ready} onClick={()=>action(()=>viewer.current!.save()).then(ok=>ok&&setStatus('Progress saved'))}>Save progress</button>
        <button disabled={!ready} onClick={()=>action(()=>viewer.current!.restore()).then(ok=>{if(ok)setStatus('Progress restored');setState(viewer.current?.behaviourState()??null);})}>Restore</button>
        <button disabled={!ready} onClick={()=>{viewer.current!.reset();setState(viewer.current!.behaviourState());}}>Reset</button>
      </div><small role="status">{status}</small></div>
    </section>:<div className={styles.content}>
      <section className={styles.intro}><p className={styles.eyebrow}>A WORLD BUILT AROUND YOUR QUESTION</p><h1>Step inside what<br/>you want to understand.</h1><p>Describe a place, a process or a question. Generate its surroundings and objects, then explore with interactive motion controls.</p></section>
      <form className={styles.create} onSubmit={e=>{e.preventDefault();void submit();}}><label htmlFor="agent-prompt">What would you like to explore?</label>
        <textarea id="agent-prompt" value={prompt} onChange={e=>setPrompt(e.target.value)} maxLength={1600} placeholder="Explore a river valley and discover how water moves through it…" required/>
        <p className={styles.note}>Current prototype: generated Earth terrain or recorded lunar terrain, objects, jumping and illustrative motion. Other environments and behaviours may stop at planning if the required capability is unavailable.</p>
        <div className={styles.formFooter}><span className={styles.availability}>{worker?'Local worker ready · new generation needs cloud access':'Generation connection pending'}</span><button disabled={!worker||busy||!!running(job)||!prompt.trim()}>{busy?'Starting…':'Create world'}</button></div>
        {!worker&&<p className={styles.note}>New world generation is currently unavailable. Saved worlds can still be opened.</p>}
      </form>
      {job&&<section className={styles.job}><div role="status"><strong>{job.state==='needs_review'?(job.result?.generation?.world?'World generated · ready to explore':job.result?.generation?.status==='needs-capability'?'Generation stopped · world not created':job.result?.generation?.status==='needs-terrain-review'?'Generation stopped · terrain needs review':'Planning finished · world not generated'):job.state==='failed'?'World generation failed':job.state==='cancelled'?'World generation cancelled':stageLabels[job.phase]??(job.phase.startsWith('terrain-')?'Preparing the terrain':job.phase.startsWith('asset-')?'Preparing scene objects':job.phase)}</strong><p>{job.error??job.topic}</p>
        {job.result?.generation?.status==='needs-capability'&&<p>The plan could not be built with the current capabilities. Nothing is still generating. The reasons below need to be resolved before retrying; submitting the same prompt will reuse the saved plan.</p>}
      </div>{running(job)&&<button onClick={()=>void cancel()}>Cancel</button>}</section>}
      {job?.result?.plan&&<section className={styles.library}><h2>{job.result.plan.title}</h2><p>{job.result.plan.objective}</p>
        <p>{job.result.plan.assets.length} assets · {job.result.plan.behaviours.length} behaviours · {job.result.terrain?.length??0} terrain plans</p>
        {job.result.generation?.world&&<button onClick={()=>setSelected({...job.result!.generation!.world!,source:'generated'})}>Open world</button>}
        {job.result.generation?.gaps?.map((g,i)=><p key={'build-'+i}>{g.target}: {g.reason}</p>)}
        <ul>{!job.result.generation?.world&&job.result.evaluation.gaps.map((g,i)=><li key={i}>{g.target}: {g.reason}</li>)}</ul></section>}
      <section className={styles.library}><div className={styles.sectionTitle}><h2>Your worlds</h2><span>{worlds.length} saved</span></div>
        {worlds.length?<div className={styles.grid}>{worlds.map(w=><button key={w.id} data-world-id={w.id} className={styles.card} onClick={()=>setSelected(w)}><h3>{w.title}</h3><p>{w.source==='engineering-fixture'?'Engineering test · not AI-generated':'Saved interactive world'}</p><span>Open world →</span></button>)}</div>:<div className={styles.empty}><h3>Your saved worlds will appear here</h3><p>Worlds keep their layout and progress when you return.</p></div>}
      </section>
    </div>}
    {error&&<div role="alert" className={styles.error}>{error}<button aria-label="Dismiss error" onClick={()=>setError('')}>×</button></div>}
  </main>;
}
