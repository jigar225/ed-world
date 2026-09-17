// Store physics snapshots as binary data; large worlds exceed localStorage's
// small text quota. IndexedDB survives reloads and uses the browser's disk quota.
let database;
function open(){return database??=new Promise((resolve,reject)=>{
  const request=indexedDB.open('eduworld-physical-state',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('worlds');
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>{database=undefined;reject(Error('Saved-world storage could not be opened'));};
});}
export async function saveWorldState(id,state){
  const db=await open(),record={...state,physics:{...state.physics,bytes:new Uint8Array(state.physics.bytes)}};
  await new Promise((resolve,reject)=>{const tx=db.transaction('worlds','readwrite');tx.objectStore('worlds').put(record,id);
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(Error('Progress could not be saved. Device storage may be full.'));tx.onabort=()=>reject(Error('Saving progress was interrupted'));});
}
export async function loadWorldState(id){
  const db=await open();const state=await new Promise((resolve,reject)=>{const request=db.transaction('worlds','readonly').objectStore('worlds').get(id);
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(Error('Saved progress could not be read'));});
  if(!state)throw Error('No saved progress for this world');
  return {...state,physics:{...state.physics,bytes:new Uint8Array(state.physics.bytes)}};
}
