/** Data contracts shared by reasoning roles, tools and the eventual world compiler. */
export type AssetKind = 'mesh' | 'rigged-mesh' | 'terrain' | 'volume';
export interface AssetRequest {
  id: string; description: string; kind: AssetKind; sizeMeters: [number, number, number];
  role?:'ground'|'object'|'liquid'|'effect';
  appearance?:'cloud'|'mist'|'rain'|'dust'|'spark'|'generic';
  requiredParts: string[]; referenceIds: string[];
}
export interface BehaviourRequest {
  id: string; targets: string[]; mechanism: string; fidelity: 'physical' | 'illustrative';
  parameters: Record<string, number>; evidenceIds: string[]; observations: string[];
}
export interface Evidence {
  id: string; title: string; url: string; excerpt: string;
  usage: 'reference-only'; retrievedAt: string;
}
export interface WorldIntent {
  version: 1; title: string; objective: string; researchQueries: string[];
}
export interface WorldPlan {
  version: 1; title: string; objective: string; artDirection: string;
  navigation: 'walk' | 'fly' | 'swim'; metersPerUnit: number;
  assets: AssetRequest[]; behaviours: BehaviourRequest[]; limitations: string[];
  unavailable?:string[];
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Expected an object');
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 2000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Error('Invalid text');
  return value.trim();
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw Error('Invalid list');
  return value;
}
function id(value: unknown): string {
  const result = text(value, 80);
  if (!/^[a-z][a-z0-9_-]*$/.test(result)) throw Error('Invalid identifier');
  return result;
}
function oneOf<T extends string>(value: unknown, options: readonly T[]): T {
  if (!options.includes(value as T)) throw Error('Unsupported enum value');
  return value as T;
}
function finite(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw Error('Invalid numeric range');
  return value;
}
function strings(value: unknown, max: number): string[] { return list(value, max).map(v => text(v)); }
function unique(ids: string[]) { if (new Set(ids).size !== ids.length) throw Error('Duplicate identifier'); }
function references(ids: string[], available: Set<string>) {
  if (ids.some(value => !available.has(value))) throw Error('Unknown reference or entity');
}

export function validateIntent(value: unknown): WorldIntent {
  const x = object(value);
  if (x.version !== 1) throw Error('Unsupported intent version');
  return {version: 1, title: text(x.title, 160), objective: text(x.objective),
    // Retrieval executes at most three searches. Extra valid suggestions need
    // no paid regeneration; preserve the raw answer in the RPC receipt.
    researchQueries: list(x.researchQueries, 12).map(q => text(q).slice(0,120)).slice(0,3)};
}

export function validatePlan(value: unknown, evidence: Evidence[]): WorldPlan {
  const x = object(value);
  if (x.version !== 1) throw Error('Unsupported plan version');
  const sourceIds = new Set(evidence.map(s => s.id));
  const assets = list(x.assets, 96).map(value => {
    const a = object(value), size = list(a.sizeMeters, 3);
    if (size.length !== 3) throw Error('Expected three dimensions');
    const referenceIds = list(a.referenceIds, 12).map(id); references(referenceIds, sourceIds);
    const role=a.role===undefined?undefined:oneOf(a.role,['ground','object','liquid','effect']);
    if(role&&a.kind!==({ground:'terrain',object:'mesh',liquid:'mesh',effect:'volume'}[role]))throw Error('Asset role does not match its representation');
    return {id: id(a.id), description: text(a.description),...(role?{role}:{}),...(a.appearance===undefined?{}:{appearance:oneOf(a.appearance,['cloud','mist','rain','dust','spark','generic'])}),
      kind: oneOf(a.kind, ['mesh', 'rigged-mesh', 'terrain', 'volume']),
      // A heightfield may be flat or have unknown relief before measured data
      // arrives. Zero vertical span is valid; horizontal spans remain positive.
      sizeMeters: size.map((v,i) => {
        const minimum=a.kind==='terrain'&&i===2?0:1e-12;
        if(typeof v!=='number'||!Number.isFinite(v)||v<minimum||v>1e7)throw Error(`Asset ${a.id}: sizeMeters[${i}] must be a finite number from ${minimum} to 10000000`);
        return v;
      }) as [number, number, number],
      requiredParts: strings(a.requiredParts, 32), referenceIds};
  });
  if (!assets.length) throw Error('A world needs assets');
  unique(assets.map(a => a.id));
  const entityIds = new Set(assets.map(a => a.id));
  const behaviours = list(x.behaviours, 96).map(value => {
    const b = object(value), targets = list(b.targets, 96).map(id);
    if (!targets.length) throw Error('Behaviour needs a target');
    references(targets, entityIds);
    const evidenceIds = list(b.evidenceIds, 12).map(id); references(evidenceIds, sourceIds);
    const parameters = Object.fromEntries(Object.entries(object(b.parameters)).map(([k, v]) =>
      [id(k), finite(v, -1e12, 1e12)]));
    if (Object.keys(parameters).length > 32) throw Error('Too many parameters');
    const observations = strings(b.observations, 12);
    if (!observations.length) throw Error('Behaviour needs observable acceptance criteria');
    return {id: id(b.id), targets, mechanism: id(b.mechanism),
      fidelity: oneOf(b.fidelity, ['physical', 'illustrative']), parameters, evidenceIds, observations};
  });
  unique(behaviours.map(b => b.id));
  return {version: 1, title: text(x.title, 160), objective: text(x.objective), artDirection: text(x.artDirection),
    navigation: oneOf(x.navigation, ['walk', 'fly', 'swim']), metersPerUnit: finite(x.metersPerUnit, 1e-12, 1e9),
    assets, behaviours, limitations: strings(x.limitations, 32),...(x.unavailable===undefined?{}:{unavailable:strings(x.unavailable,16)})};
}

export const INTENT_FORMAT = '{version:1,title:string,objective:string,researchQueries:string[0..3]}';
export const PLAN_FORMAT = '{version:1,title,objective,artDirection,navigation:"walk|fly|swim",metersPerUnit:number,assets:[{id,description,kind:"mesh|rigged-mesh|terrain|volume",sizeMeters:[x,y,z],requiredParts:string[],referenceIds:string[]}],behaviours:[{id,targets:string[],mechanism:string,fidelity:"physical|illustrative",parameters:{name:number},evidenceIds:string[],observations:string[]}],limitations:string[]}';
