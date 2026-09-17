/** Compare browser Origin with the actual request Host (Next may normalize its internal URL). */
export function sameRequestOrigin(request:{headers:{get(name:string):string|null};nextUrl:{protocol:string;origin:string}}){
 const origin=request.headers.get('origin');if(!origin)return true;
 const host=request.headers.get('host');if(!host||/[\s/\\@?#]/.test(host))return false;
 try{return origin===new URL(request.nextUrl.protocol+'//'+host).origin;}catch{return false;}
}
