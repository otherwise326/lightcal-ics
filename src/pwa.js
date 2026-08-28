function trimTrailingSlashes(value) {
  return String(value || '/').replace(/\/*$/, '/');
}

export async function registerPwa({
  serviceWorker,
  windowObject,
  baseUrl = '/',
  onUpdateReady = () => {},
} = {}) {
  if (!serviceWorker || !windowObject) return { supported: false };

  const normalizedBaseUrl = trimTrailingSlashes(baseUrl);
  let reloading = false;
  serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    windowObject.location.reload();
  });

  const registration = await serviceWorker.register(`${normalizedBaseUrl}sw.js`, {
    scope: normalizedBaseUrl,
  });

  const offerUpdate = (worker) => {
    if (!worker || !serviceWorker.controller) return;
    onUpdateReady(() => worker.postMessage({ type: 'SKIP_WAITING' }));
  };

  offerUpdate(registration.waiting);
  registration.addEventListener('updatefound', () => {
    const installingWorker = registration.installing;
    if (!installingWorker) return;
    installingWorker.addEventListener('statechange', () => {
      if (installingWorker.state === 'installed') offerUpdate(registration.waiting ?? installingWorker);
    });
  });

  return { supported: true, registration };
}
