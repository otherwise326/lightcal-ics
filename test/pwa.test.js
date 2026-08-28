import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerPwa } from '../src/pwa.js';

test('G3 manifest is installable, standalone, relative-scoped, and includes any plus maskable icons', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.orientation, 'portrait-primary');
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192' && icon.purpose === 'any'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'any'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'maskable'));
});

test('G3 service worker caches only same-origin app requests and leaves ICS responses to Safari', async () => {
  const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.match(source, /url\.origin !== self\.location\.origin/);
  assert.match(source, /!url\.href\.startsWith\(scope\)/);
  assert.match(source, /endsWith\('\.ics'\)/);
  assert.match(source, /request\.mode === 'navigate'/);
  assert.match(source, /SKIP_WAITING/);
});

test('G3 registration offers a waiting update and reloads once after controller change', async () => {
  const serviceWorkerListeners = new Map();
  const registrationListeners = new Map();
  const messages = [];
  let reloads = 0;
  const waiting = { postMessage: (message) => messages.push(message) };
  const registration = { waiting, addEventListener(type, listener) { registrationListeners.set(type, listener); } };
  const serviceWorker = {
    controller: {},
    addEventListener(type, listener) { serviceWorkerListeners.set(type, listener); },
    async register(url, options) {
      assert.equal(url, '/tools/lightcal/sw.js');
      assert.deepEqual(options, { scope: '/tools/lightcal/' });
      return registration;
    },
  };
  let activateUpdate;
  const result = await registerPwa({
    serviceWorker,
    windowObject: { location: { reload: () => { reloads += 1; } } },
    baseUrl: '/tools/lightcal',
    onUpdateReady(activate) { activateUpdate = activate; },
  });
  assert.equal(result.supported, true);
  activateUpdate();
  assert.deepEqual(messages, [{ type: 'SKIP_WAITING' }]);
  serviceWorkerListeners.get('controllerchange')();
  serviceWorkerListeners.get('controllerchange')();
  assert.equal(reloads, 1);
  assert.ok(registrationListeners.has('updatefound'));
});

test('G3 registration stays inert when service workers are unavailable', async () => {
  assert.deepEqual(await registerPwa(), { supported: false });
});
