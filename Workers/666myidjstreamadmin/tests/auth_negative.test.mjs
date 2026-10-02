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
