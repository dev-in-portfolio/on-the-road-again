import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { OTRA_BUILD, OTRA_VERSION } from './app-release.ts';

async function annotateDiagnostics(root: ParentNode = document) {
  const diagnostics = root.querySelector<HTMLElement>('.diagnostics');
  if (!diagnostics || diagnostics.dataset.runtimeIdentityApplied === 'true') return;
  const text = diagnostics.querySelector<HTMLElement>('small');
  if (!text) return;

  diagnostics.dataset.runtimeIdentityApplied = 'true';
  const parts = text.textContent?.split(' · ') || [];
  const status = parts.slice(2).join(' · ');

  if (Capacitor.isNativePlatform()) {
    try {
      const info = await App.getInfo();
      text.textContent = `NATIVE APK · Version ${info.version} · Build ${info.build}${status ? ` · ${status}` : ''}`;
    } catch {
      text.textContent = `NATIVE APK · Version ${OTRA_VERSION} · Build ${OTRA_BUILD}${status ? ` · ${status}` : ''}`;
    }
    diagnostics.dataset.runtime = 'native';
    return;
  }

  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  text.textContent = `${standalone ? 'WEB/PWA' : 'WEB'} · Site bundle ${OTRA_VERSION} · This is not the Android APK`;
  diagnostics.dataset.runtime = 'web';
  diagnostics.querySelectorAll<HTMLButtonElement>('button').forEach(button => {
    if (button.id === 'more-check-updates' || /^Update\s/i.test(button.textContent || '')) button.remove();
  });
}

function installRuntimeIdentity() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  const run = () => { void annotateDiagnostics(document); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
  const target = document.getElementById('app') || document.body;
  new MutationObserver(run).observe(target, { childList: true, subtree: true });
}

installRuntimeIdentity();
