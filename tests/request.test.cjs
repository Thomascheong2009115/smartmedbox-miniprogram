const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const filename = resolve(__dirname, '../miniprogram/utils/request.js');

function loadRequest(response) {
  const calls = [];
  const wx = {
    showLoading: () => calls.push('loading'),
    hideLoading: () => calls.push('hidden'),
    showToast: options => calls.push(options.title),
    request(options) {
      calls.push(options);
      if (response.networkError) options.fail(response.networkError);
      else options.success(response);
      options.complete();
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(filename, 'utf8'), {
    module, require: createRequire(filename), wx,
    console: { log() {}, warn() {}, error() {} },
  }, { filename });
  return { request: module.exports, calls };
}

test('POST sends JSON and returns a successful API response', async () => {
  const { request, calls } = loadRequest({ statusCode: 201, data: { saved: true } });
  const result = await request.post('/api/config', { hour: 8 });
  assert.equal(result.saved, true);
  const options = calls.find(call => typeof call === 'object');
  assert.equal(options.method, 'POST');
  assert.equal(options.url, 'http://127.0.0.1:5000/api/config');
  assert.equal(options.header['content-type'], 'application/json');
  assert.equal(options.data.hour, 8);
  assert.equal(calls[0], 'loading');
  assert.equal(calls.at(-1), 'hidden');
});

test('404 stays rejected so the caller can handle demo fallback', async () => {
  const { request, calls } = loadRequest({ statusCode: 404, data: {} });
  await assert.rejects(request.get('https://example.invalid/status', {}, { loading: false }),
    error => error.statusCode === 404 && error.url === 'https://example.invalid/status');
  assert.equal(calls.includes('loading'), false);
  assert.equal(calls.includes('hidden'), false);
});

test('server errors reject with the API message', async () => {
  const { request, calls } = loadRequest({ statusCode: 503, data: { message: 'unavailable' } });
  await assert.rejects(request.get('/api/status'), error => error.message === 'unavailable');
  assert.equal(calls.includes('unavailable'), true);
  assert.equal(calls.at(-1), 'hidden');
});

test('network errors preserve the original failure and close loading', async () => {
  const failure = { errMsg: 'timeout' };
  const { request, calls } = loadRequest({ networkError: failure });
  await assert.rejects(request.get('/api/status'), error => error === failure);
  assert.equal(calls.includes('Network Error'), true);
  assert.equal(calls.at(-1), 'hidden');
});
