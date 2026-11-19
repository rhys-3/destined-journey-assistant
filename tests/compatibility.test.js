import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const loader = await readFile(new URL('../loader.js', import.meta.url), 'utf8');
const asset = `/gh/rhys-3/destined-journey-assistant@v${version}/dist/destined-journey-assistant.js`;
const primary = 'https://cdn.jsdelivr.net' + asset;
const fallback = 'https://testingcf.jsdelivr.net' + asset;
const retryName = '重新加载命定预设助手';
const existingButton = { name: 'existing', visible: true };

// Node cannot import a Blob URL. Substitute that one operation; Chrome tests the real import.
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
const runLoader = new AsyncFunction(
  'fetch', 'AbortSignal', 'URL', 'importModule', 'toastr',
  'updateScriptButtonsWith', 'eventOn', 'getButtonEvent', 'console',
  loader.replace(/\bimport\(/g, 'importModule('),
);

function scriptResponse() {
  return new Response('export const ready = await Promise.resolve(true);', {
    headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
  });
}

function host(respond, importModule = async () => {}) {
  const requests = [], timeouts = [], created = [], imported = [], revoked = [], errors = [], listeners = [];
  let buttons = [existingButton];
  let stops = 0;
  const fetch = (url, { cache, signal }) => {
    requests.push({ url, cache, signal });
    return respond(url, signal);
  };
  const start = () => runLoader(
    fetch,
    { timeout(ms) {
      const controller = new AbortController();
      timeouts.push({ ms, signal: controller.signal, expire: () => controller.abort(new DOMException('download timed out', 'TimeoutError')) });
      return controller.signal;
    } },
    { createObjectURL(blob) {
      assert(blob instanceof Blob);
      const url = URL.createObjectURL(blob);
      created.push(url);
      return url;
    }, revokeObjectURL(url) {
      URL.revokeObjectURL(url);
      revoked.push(url);
    } },
    async url => {
      imported.push(url);
      await importModule(url);
    },
    { error: message => errors.push(message) },
    update => { buttons = update(buttons); },
    (event, listener) => {
      assert.equal(event, `button:${retryName}`);
      listeners.push(listener);
      return { stop() { stops++; } };
    },
    name => `button:${name}`,
    { error() {} },
  );
  return {
    start, requests, timeouts, created, imported, revoked, errors, listeners,
    get buttons() { return buttons; },
    get stops() { return stops; },
  };
}

test('the old public bundle stays byte-equivalent to v2.8.3 for main/latest users',async()=>{
  const old=await readFile(new URL('../dist/destined-journey-summarizer.js',import.meta.url),'utf8');
  const hash=createHash('sha256').update(old.replace(/\r\n/g,'\n').trim()).digest('hex');
  assert.equal(hash,'1d5df8e5376ed1b313e8aee03d9f2d3c5dedef24e05b5f98f240fc64fe71dd1e');
});
test('the loader pins its version and asset',()=>{
  assert(loader.includes(`const version = '${version}'`));
  assert(loader.includes('destined-journey-assistant@v${version}/dist/destined-journey-assistant.js'));
  assert(!loader.includes('@main')&&!loader.includes('@latest'));
});

test('a successful primary download imports and releases one Blob URL', async () => {
  const page = host(scriptResponse, async url => {
    assert.match(url, /^blob:/);
    assert.equal(await (await fetch(url)).text(), 'export const ready = await Promise.resolve(true);');
  });
  await page.start();
  assert.deepEqual(page.requests.map(({ url, cache }) => [url, cache]), [[primary, 'default']]);
  assert.equal(page.created.length, 1);
  assert.deepEqual(page.imported, page.created);
  assert.deepEqual(page.revoked, page.created);
  assert.deepEqual(page.buttons, [existingButton]);
  assert.deepEqual(page.errors, []);
});

test('an HTTP failure or unexpected MIME type tries the same pinned bundle on the fallback', async t => {
  for (const [failure, response] of [
    ['HTTP failure', () => new Response('', { status: 503 })],
    ['unexpected MIME type', () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } })],
  ]) {
    await t.test(failure, async () => {
      const page = host(url => url === primary ? response() : scriptResponse());
      await page.start();
      assert.deepEqual(page.requests.map(({ url }) => url), [primary, fallback]);
      assert.equal(page.imported.length, 1);
      assert.deepEqual(page.revoked, page.imported);
      assert.deepEqual(page.errors, []);
    });
  }
});

test('a stalled primary response body times out before the fallback starts with its own deadline', async () => {
  const bodyStarted = Promise.withResolvers();
  const page = host((url, signal) => {
    if (url === fallback) return scriptResponse();
    return {
      ok: true,
      blob() {
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          bodyStarted.resolve();
        });
      },
    };
  });
  const load = page.start();
  await bodyStarted.promise;
  assert.equal(page.requests.length, 1);
  page.timeouts[0].expire();
  await load;
  assert.deepEqual(page.requests.map(({ url }) => url), [primary, fallback]);
  assert.deepEqual(page.timeouts.map(({ ms }) => ms), [10_000, 10_000]);
  assert.equal(page.requests[0].signal, page.timeouts[0].signal);
  assert.equal(page.requests[1].signal, page.timeouts[1].signal);
  assert.notEqual(page.requests[0].signal, page.requests[1].signal);
  assert.equal(page.requests[1].signal.aborted, false);
  assert.equal(page.imported.length, 1);
  assert.deepEqual(page.errors, []);
});

test('both download failures keep one retry button and concurrent retries use one load', async () => {
  let recovered = false;
  const downloaded = Promise.withResolvers();
  const importing = Promise.withResolvers();
  const initialized = Promise.withResolvers();
  const page = host(url => {
    if (recovered) return downloaded.promise;
    if (url === fallback) return new Response('', { status: 503 });
    throw new TypeError('network unavailable');
  }, () => {
    importing.resolve();
    return initialized.promise;
  });
  await page.start();
  assert(page.errors[0].includes(`v${version}`));
  assert.match(page.errors[0], /cdn\.jsdelivr\.net: network unavailable/);
  assert.match(page.errors[0], /testingcf\.jsdelivr\.net: HTTP 503/);
  assert.deepEqual(page.buttons, [existingButton, { name: retryName, visible: true }]);
  assert.equal(page.imported.length, 0);
  const [retry] = page.listeners;
  await retry();
  assert.equal(page.listeners.length, 1);
  assert.deepEqual(page.buttons, [existingButton, { name: retryName, visible: true }]);

  recovered = true;
  const load = retry();
  await retry();
  assert.deepEqual(page.requests.map(({ url, cache }) => [url, cache]), [
    [primary, 'default'], [fallback, 'default'],
    [primary, 'reload'], [fallback, 'reload'], [primary, 'reload'],
  ]);
  downloaded.resolve(scriptResponse());
  await importing.promise;
  await retry();
  assert.equal(page.requests.length, 5);
  assert.equal(page.revoked.length, 0);
  assert.equal(page.stops, 0);
  initialized.resolve();
  await load;
  assert.equal(page.imported.length, 1);
  assert.deepEqual(page.revoked, page.imported);
  assert.equal(page.stops, 1);
  assert.deepEqual(page.buttons, [existingButton]);
});

test('an initialization failure reports the original error without trying the fallback', async () => {
  const page = host(scriptResponse, async () => { throw new Error('startup failed'); });
  await page.start();
  assert.deepEqual(page.requests.map(({ url }) => url), [primary]);
  assert.equal(page.imported.length, 1);
  assert.deepEqual(page.revoked, page.imported);
  assert.match(page.errors[0], /startup failed/);
  assert.equal(page.listeners.length, 1);
});
