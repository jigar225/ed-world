import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{sameRequestOrigin}=require('../../.cache/origin-test/request-origin.js');
const request=(origin,host='127.0.0.1:3011')=>({headers:{get:k=>({origin,host,'x-forwarded-host':'attacker.example'}[k]??null)},nextUrl:{origin:'http://localhost:3011',protocol:'http:'}});
assert(sameRequestOrigin(request('http://127.0.0.1:3011')));
assert(!sameRequestOrigin(request('https://attacker.example')));assert(!sameRequestOrigin(request('http://127.0.0.1:3002')));assert(!sameRequestOrigin(request('null')));assert(!sameRequestOrigin(request('http://127.0.0.1:3011','attacker.example@127.0.0.1:3011')));assert(sameRequestOrigin(request(null)));
console.log('PASS: loopback origin normalization, foreign origins/ports and malformed Host rejected; forwarded host ignored.');
