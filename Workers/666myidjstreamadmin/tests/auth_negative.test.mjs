// Offline regression checks for the pre-existing Worker PR #3.
// No live radio skip, credentials, Cloudflare deployment or outbound fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const endpoint = 'https://worker.invalid/admin/autodj/skip';
async function request(method = 'POST', headers = {}) {
  let outgoing = 0;
  const previous = globalThis.fetch;
  globalThis.fetch = async () => { outgoing += 1; throw new Error('NETWORK_FORBIDDEN'); };
  try {
    return { response: await worker.fetch(new Request(endpoint, { method, headers }), {}), outgoing };
  } finally {
    globalThis.fetch = previous;
  }
}

test('missing ADMIN_TOKEN denies request with HTTP 503 before upstream', async () => {
  const { response, outgoing } = await request('POST');
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'ADMIN_TOKEN_NOT_CONFIGURED');
  assert.equal(outgoing, 0);
});

test('admin GET is not an accepted mutation', async () => {
  const { response, outgoing } = await request('GET');
  assert.equal(response.status, 405);
  assert.equal(outgoing, 0);
});

test('unconfigured admin token does not accept supplied credentials', async () => {
  const { response, outgoing } = await request('POST', { 'x-admin-token': 'unexpected' });
  assert.equal(response.status, 503);
  assert.equal(outgoing, 0);
});

test('nowplaying safety rejects raw stream URL without initiating fetch', async () => {
  let outgoing = 0;
  const previous = globalThis.fetch;
  globalThis.fetch = async () => { outgoing += 1; throw new Error('NETWORK_FORBIDDEN'); };
  try {
    const response = await worker.fetch(new Request('https://worker.invalid/nowplaying'), { NOWPLAYING_URL: 'https://radio.invalid/stream' });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, 'NOWPLAYING_URL_LOOKS_LIKE_RAW_STREAM');
    assert.equal(outgoing, 0);
  } finally {
    globalThis.fetch = previous;
  }
});


const credentials = {ADMIN_TOKEN:'test-only-opaque-token',STREAM_ADMIN_USER:'local-test',STREAM_ADMIN_PASSWORD:'local-test',STREAM_ADMIN_BASE_URL:'https://upstream.example.test/admin.cgi',STREAM_SID:'1'};
async function invoke(path='/admin/autodj/skip',env=credentials,upstream=()=>{throw new Error('NETWORK_FORBIDDEN');},token='test-only-opaque-token') {
  const previous=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async (url,options)=>{calls.push({url:String(url),options});return await upstream(url,options);};
  try {const response=await worker.fetch(new Request('https://worker.invalid'+path,{method:'POST',headers:{'x-admin-token':token}}),env);return {response,calls};}
  finally {globalThis.fetch=previous;}
}
test('wrong token denies privileged skip with 401 and zero upstream calls', async()=>{
 const {response,calls}=await invoke('/admin/autodj/skip',credentials,()=>{throw Error('UNEXPECTED_FETCH');},'wrong-token');
 assert.equal(response.status,401);assert.equal(calls.length,0);
});
test('configured admin token with missing upstream username/password fails closed', async()=>{
 const env={ADMIN_TOKEN:credentials.ADMIN_TOKEN,STREAM_ADMIN_BASE_URL:credentials.STREAM_ADMIN_BASE_URL};
 const {response,calls}=await invoke('/admin/autodj/skip',env);
 assert.equal(response.status,503);assert.equal((await response.json()).error,'ADMIN_UPSTREAM_CREDENTIALS_NOT_CONFIGURED');assert.equal(calls.length,0);
});
test('legacy HTTP admin URL is blocked before credentials leave Worker', async()=>{
 const {response,calls}=await invoke('/admin/autodj/skip',{...credentials,STREAM_ADMIN_BASE_URL:'http://my.idjstream.com:8686/admin.cgi'});
 assert.equal(response.status,503);assert.equal((await response.json()).error,'SECURE_ADMIN_TRANSPORT_REQUIRED');assert.equal(calls.length,0);
});
test('200 HTML login page is never a successful skip; response body is not exposed',async()=>{
 const {response,calls}=await invoke('/admin/autodj/skip',credentials,()=>new Response('<html><form>Password: fake-value</form></html>',{status:200,headers:{'content-type':'text/html'}}));
 const data=await response.json();assert.equal(response.status,502);assert.equal(data.ok,false);assert.equal(data.upstreamAccepted,false);assert.equal(data.verified,false);assert.equal(JSON.stringify(data).includes('fake-value'),false);assert.equal(calls.length,1);
});
test('upstream 200 text acknowledges request but not actual track change',async()=>{
 const {response}=await invoke('/admin/autodj/skip',credentials,()=>new Response('OK',{status:200,headers:{'content-type':'text/plain'}}));
 const data=await response.json();assert.equal(response.status,202);assert.equal(data.ok,false);assert.equal(data.upstreamAccepted,true);assert.equal(data.verified,false);
});
test('Worker disables follow-redirect on upstream request',async()=>{
 const {response,calls}=await invoke('/admin/autodj/skip',credentials,()=>new Response('',{status:302,headers:{location:'https://other.example.test/'}}));
 assert.equal(response.status,502);assert.equal(calls.length,1);assert.equal(calls[0].options.redirect,'manual');
});
test('playlist switch with insecure HTTP override cannot send admin credentials',async()=>{
 const {response,calls}=await invoke('/admin/autodj/playlist-switch',{...credentials,RADIO_AUTODJ_PLAYLIST_SWITCH_URL:'http://other.example.test/switch'});
 assert.equal(response.status,503);assert.equal(calls.length,0);
});
test('credentials in upstream URL are blocked even if HTTPS',async()=>{
 const {response,calls}=await invoke('/admin/autodj/skip',{...credentials,STREAM_ADMIN_BASE_URL:'https://user:password@upstream.example.test/admin.cgi'});
 assert.equal(response.status,503);assert.equal(calls.length,0);
});
test('private upstream exceptions do not expose request error secrets',async()=>{
 const {response}=await invoke('/admin/autodj/skip',credentials,()=>{throw Error('PRIVATE_UPSTREAM_SECRET');});
 const data=await response.json();assert.equal(response.status,500);assert.equal(JSON.stringify(data).includes('PRIVATE_UPSTREAM_SECRET'),false);
});

test('NowPlaying with HTTP admin basic auth fails closed with zero network calls',async()=>{
 const previous=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('UNEXPECTED_FETCH');};
 try {
  const response=await worker.fetch(new Request('https://worker.invalid/nowplaying'),{NOWPLAYING_URL:'http://my.idjstream.com:8686/admin.cgi?mode=viewxml',STREAM_ADMIN_USER:'local-user',STREAM_ADMIN_PASSWORD:'local-secret'});
  assert.equal(response.status,503);assert.equal((await response.json()).error,'SECURE_ADMIN_TRANSPORT_REQUIRED');assert.equal(calls,0);
 } finally {globalThis.fetch=previous;}
});
test('cross-host HTTPS override cannot receive radio admin credentials',async()=>{
 const {response,calls}=await invoke('/admin/autodj/skip',{...credentials,RADIO_AUTODJ_SKIP_URL:'https://malicious.example.test/skip'});
 assert.equal(response.status,503);assert.equal((await response.json()).error,'ADMIN_TARGET_HOST_MISMATCH');assert.equal(calls.length,0);
});
test('HTTPS same-host override remains requestable, but success remains unverified',async()=>{
 const {response,calls}=await invoke('/admin/autodj/skip',{...credentials,RADIO_AUTODJ_SKIP_URL:'https://upstream.example.test/skip'},()=>new Response('accepted',{status:200,headers:{'content-type':'text/plain'}}));
 const data=await response.json();assert.equal(response.status,202);assert.equal(data.ok,false);assert.equal(data.verified,false);assert.equal(calls.length,1);assert.equal(calls[0].options.method,'POST');
});
test('cross-port HTTPS override is rejected',async()=>{
 const {response,calls}=await invoke('/admin/autodj/skip',{...credentials,RADIO_AUTODJ_SKIP_URL:'https://upstream.example.test:8443/skip'});
 assert.equal(response.status,503);assert.equal(calls.length,0);
});
