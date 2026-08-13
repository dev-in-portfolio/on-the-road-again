// OTRA design runtime
// -------------------
// This module is intentionally presentation-only. It observes the already-
// rendered DOM and annotates it for the design system without owning business
// state, route state, API calls, or persistence.

function currentView(panel: HTMLElement | null): string {
  if (!panel) return 'unknown';
  if (panel.querySelector('#btn-route-back')) return 'route';
  if (panel.querySelector('#btn-pl-add')) return 'list';
  if (panel.querySelector('#btn-cx-add, #restaurant_name')) return 'add';
  if (panel.querySelector('#btn-cx-edit, #edit_restaurant_name')) return 'edit';
  if (panel.querySelector('#btn-cx-arch, #btn-arch-back')) return 'archived';
  if (panel.querySelector('#btn-cx-imp, #btn-cx-imp-res, #btn-imp-done')) return 'import';
  if (panel.querySelector('.detail-actions')) return 'detail';
  return 'unknown';
}

function addEyebrow(panel: HTMLElement, view: string) {
  const header = panel.querySelector<HTMLElement>('.panel-header');
  const title = header?.querySelector<HTMLElement>('.app-title');
  if (!header || !title || header.querySelector('.otra-eyebrow')) return;

  const labels: Record<string, string> = {
    route: 'ROAD MANIFEST',
    list: 'FIELD MAP • RESTAURANT PROSPECTS',
    detail: 'FIELD CARD',
    add: 'BACKSTAGE • DATABASE',
    edit: 'BACKSTAGE • RECORD EDIT',
    archived: 'BACKSTAGE • ARCHIVE',
    import: 'BACKSTAGE • INTAKE',
  };
  const text = labels[view];
  if (!text) return;

  const wrapper = document.createElement('span');
  wrapper.className = 'otra-title-wrap';
  title.parentElement?.insertBefore(wrapper, title);
  wrapper.appendChild(document.createElement('span')).className = 'otra-eyebrow';
  wrapper.querySelector<HTMLElement>('.otra-eyebrow')!.textContent = text;
  wrapper.appendChild(title);
}

function markUnavailableRows(panel: HTMLElement) {
  panel.querySelectorAll<HTMLElement>('.route-item').forEach(row => {
    const name = row.querySelector<HTMLElement>('.route-name')?.textContent?.trim();
    if (name === 'Unavailable prospect') row.dataset.otraUnavailable = 'true';
  });
}

function animateNewDropped(panel: HTMLElement) {
  panel.querySelectorAll<HTMLElement>('.badge-dropped').forEach(badge => {
    if (badge.dataset.otraStamped) return;
    badge.dataset.otraStamped = 'true';
    badge.classList.add('otra-stamp-in');
    badge.addEventListener('animationend', () => badge.classList.remove('otra-stamp-in'), { once: true });
  });
}

function annotate() {
  document.documentElement.classList.add('otra-blueprint-design');
  const app = document.getElementById('app');
  const panel = document.getElementById('panel-container');

  if (app?.querySelector('.access-gate')) {
    document.body.dataset.otraView = 'access';
    return;
  }

  if (!panel) return;
  const view = currentView(panel);
  document.body.dataset.otraView = view;
  document.documentElement.dataset.otraView = view;
  addEyebrow(panel, view);
  markUnavailableRows(panel);
  animateNewDropped(panel);

  const routeButton = document.getElementById('btn-current-route');
  if (routeButton) {
    routeButton.setAttribute('data-otra-role', 'tour-laminate');
  }
}

let queued = false;
function scheduleAnnotate() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    annotate();
  });
}

const observer = new MutationObserver(scheduleAnnotate);
observer.observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener('click', event => {
  const target = event.target as HTMLElement | null;
  const drop = target?.closest<HTMLElement>('.btn-status.pending, .popup-btn-pending');
  if (!drop) return;
  document.documentElement.classList.add('otra-drop-pending');
  window.setTimeout(() => document.documentElement.classList.remove('otra-drop-pending'), 380);
}, { capture: true });

scheduleAnnotate();
