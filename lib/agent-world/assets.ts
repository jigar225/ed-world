import {createHash} from 'node:crypto';
import {readFile, readdir, realpath, mkdir, writeFile, rename, stat} from 'node:fs/promises';
import path from 'node:path';

export interface AssetInventory {
  hash: string; bytes: number; format: 'glb'; meshes: number; nodes: string[];
  skins: number; animations: string[]; qualification: 'structural-only';
}
export function inspectGLB(bytes: Uint8Array): AssetInventory {
  const b = Buffer.from(bytes);
  if (b.length < 20 || b.readUInt32LE(0) !== 0x46546c67 || b.readUInt32LE(4) !== 2 || b.readUInt32LE(8) !== b.length) throw Error('Invalid GLB header');
  const length = b.readUInt32LE(12);
  if (length % 4 || length + 20 > b.length || b.readUInt32LE(16) !== 0x4e4f534a) throw Error('Invalid GLB JSON chunk');
  let end = 12;
  while (end < b.length) {
    if (end + 8 > b.length) throw Error('Truncated GLB chunk');
    const n = b.readUInt32LE(end);
    if (n % 4 || end + 8 + n > b.length) throw Error('Invalid GLB chunk length');
    end += 8 + n;
  }
  const document = JSON.parse(b.subarray(20, 20 + length).toString('utf8'));
  if (document.asset?.version !== '2.0' || !Array.isArray(document.meshes) || !document.meshes.length) throw Error('GLB has no mesh geometry');
  for (const item of [...(document.buffers ?? []), ...(document.images ?? [])]) {
    if (item.uri && !/^data:(image\/(png|jpeg|webp)|application\/octet-stream);base64,/.test(item.uri)) throw Error('GLB contains an external resource; embedding is required');
  }
  return {hash:createHash('sha256').update(b).digest('hex'), bytes:b.length, format:'glb',
    meshes:document.meshes.length, nodes:(document.nodes ?? []).map((n: {name?:string}, i:number) => String(n.name ?? `node-${i}`).slice(0,160)),
    skins:(document.skins ?? []).length, animations:(document.animations ?? []).map((a:{name?:string}, i:number) => String(a.name ?? `clip-${i}`).slice(0,160)),
    qualification:'structural-only'};
}

/** Real-path containment rejects symlinks into other projects or private directories. */
export async function projectFile(root: string, relative: string): Promise<string> {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw Error('Project-relative path required');
  const base = await realpath(root), file = await realpath(path.join(base, relative));
  if (!file.startsWith(base + path.sep)) throw Error('File escapes project');
  return file;
}
export async function inspectProjectAsset(root: string, relative: string) {
  if (!/^(public\/props|\.cache\/agent-world\/artifacts)\/[a-zA-Z0-9_.-]+\.glb$/.test(relative)) throw Error('Asset is outside the approved asset directories');
  const file = await projectFile(root, relative);
  if ((await stat(file)).size > 128 * 1024 * 1024) throw Error('Asset exceeds inspection limit');
  return {...inspectGLB(await readFile(file)), path:relative};
}
export async function findProjectAssets(root: string, query: string) {
  const terms = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  let files: string[];
  try { files = await readdir(await projectFile(root, 'public/props')); } catch { return []; }
  const selected = files.filter(f => f.endsWith('.glb')).map(f => ({f, score:terms.filter(t => f.toLowerCase().includes(t)).length}))
    .filter(x => x.score > 0).sort((a,b) => b.score-a.score || a.f.localeCompare(b.f)).slice(0,12);
  const result = [];
  for (const {f} of selected) {
    try { result.push(await inspectProjectAsset(root, `public/props/${f}`)); }
    catch { result.push({path:`public/props/${f}`, qualification:'rejected', reason:'Asset failed structural inspection'}); }
  }
  return result;
}
export async function saveArtifact(root: string, data: Uint8Array, extension: 'png' | 'glb') {
  const hash = createHash('sha256').update(data).digest('hex');
  const folder = path.join(root, '.cache', 'agent-world', 'artifacts');
  await mkdir(folder, {recursive:true});
  await projectFile(root, '.cache/agent-world/artifacts');
  const relative = `.cache/agent-world/artifacts/${hash}.${extension}`;
  const temp = path.join(folder, `${hash}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temp, data, {flag:'wx'}); await rename(temp, path.join(root, relative));
  return {hash, path:relative, bytes:data.byteLength};
}
