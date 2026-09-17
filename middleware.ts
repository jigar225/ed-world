import {NextRequest,NextResponse} from 'next/server';
import {sameRequestOrigin} from './lib/request-origin';
// A private demo/VPS access boundary; replace with account authentication before public launch.
export function middleware(req:NextRequest){
  const origin=req.headers.get("origin");
  if(!["GET","HEAD","OPTIONS"].includes(req.method)&&origin&&!sameRequestOrigin(req))return new NextResponse("Invalid origin",{status:403});
  const password=process.env.ED_ACCESS_PASSWORD;
  if(!password){
    if(process.env.NODE_ENV==='production')return new NextResponse('Server access is not configured.',{status:503});
    return NextResponse.next();
  }
  const auth=req.headers.get('authorization');
  let valid=false;
  if(auth?.startsWith('Basic ')){
    try{const decoded=atob(auth.slice(6));valid=decoded===`ed:${password}`;}catch{/* invalid credentials */}
  }
  if(!valid)return new NextResponse('Authentication required',{status:401,headers:{'WWW-Authenticate':'Basic realm="EduWorld", charset="UTF-8"','Cache-Control':'no-store'}});
  return NextResponse.next();
}
export const config={matcher:['/((?!_next/static|_next/image|favicon.ico).*)']};
