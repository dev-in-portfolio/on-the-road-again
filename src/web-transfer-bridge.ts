import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { loadFieldState, saveFieldState } from './field-state';
import { loadRouteIds, saveRouteIds } from './route-state';
import {
  WEB_TRANSFER_MAX_ENCODED_LENGTH,
  buildAndroidTransferIntent,
  createWebTransferPayload,
  encodeWebTransferPayload,
  mergeWebTransfer,
  parseNativeTransferUrl,
  transferFingerprint,
} from './web-transfer';

const APPLIED_TRANSFER_KEY = 'otra.webTransfer.applied';
const LAST_TRANSFER_AT_KEY = 'otra.webTransfer.lastAppliedAt';

async function applyNativeTransferUrl(url: string): Promise<boolean> {
  const parsed = parseNativeTransferUrl(url);
  if (!parsed) return false;

  const fingerprint = transferFingerprint(parsed.encoded);
  if (sessionStorage.getItem(APPLIED_TRANSFER_KEY) === fingerprint) return false;

  const current = await loadFieldState();
  const merged = mergeWebTransfer(current, parsed.payload);
  await saveFieldState(merged);
  saveRouteIds(localStorage, merged.routeIds);
  sessionStorage.setItem(APPLIED_TRANSFER_KEY, fingerprint);
  localStorage.setItem(LAST_TRANSFER_AT_KEY, new Date().toISOString());

  window.location.reload();
  return true;
}

async function installNativeTransferReceiver() {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const launch = await App.getLaunchUrl();
    if (launch?.url && await applyNativeTransferUrl(launch.url)) return;
  } catch {
    // A normal launch may not expose a launch URL. The live listener still works.
  }

  void App.addListener('appUrlOpen', event => {
    void applyNativeTransferUrl(event.url);
  });
}

function setTransferStatus(button: HTMLButtonElement, message: string) {
  const status = button.querySelector<HTMLElement>('small');
  if (status) status.textContent = message;
}

async function handWebStateToNative(button: HTMLButtonElement) {
  button.disabled = true;
  setTransferStatus(button, 'Preparing your saved route and field state…');

  try {
    const state = await loadFieldState();
    const payload = createWebTransferPayload(state, loadRouteIds(localStorage));
    const encoded = encodeWebTransferPayload(payload);
    if (encoded.length > WEB_TRANSFER_MAX_ENCODED_LENGTH) {
      setTransferStatus(button, 'Saved state is too large for a direct handoff. Clear old offline changes and try again.');
      return;
    }

    setTransferStatus(button, `Opening OTRA with ${payload.routeIds.length} saved route stop${payload.routeIds.length === 1 ? '' : 's'}…`);
    window.location.assign(buildAndroidTransferIntent(encoded));
  } catch {
    setTransferStatus(button, 'Could not prepare the transfer. Try again.');
  } finally {
    window.setTimeout(() => {
      button.disabled = false;
      setTransferStatus(button, 'Move this browser’s saved route and field state into the installed app');
    }, 2500);
  }
}

function enhanceWebTransferControl(root: ParentNode = document) {
  if (Capacitor.isNativePlatform()) return;
  const grid = root.querySelector<HTMLElement>('.more-screen .more-grid');
  if (!grid || grid.querySelector('#more-transfer-to-app')) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'more-transfer-to-app';
  button.className = 'more-tile';
  button.innerHTML = '<span>⇢</span><strong>Move Web Data to App</strong><small>Move this browser’s saved route and field state into the installed app</small>';
  button.addEventListener('click', () => { void handWebStateToNative(button); });
  grid.appendChild(button);
}

function installWebTransferControl() {
  if (Capacitor.isNativePlatform()) return;
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  if (document.documentElement.dataset.otraWebTransferInstalled === 'true') return;
  document.documentElement.dataset.otraWebTransferInstalled = 'true';

  const start = () => {
    enhanceWebTransferControl(document);
    const target = document.getElementById('app') || document.body;
    const observer = new MutationObserver(() => enhanceWebTransferControl(document));
    observer.observe(target, { childList: true, subtree: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}

void installNativeTransferReceiver();
installWebTransferControl();
