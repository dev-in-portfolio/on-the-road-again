import { fetchClosureObservations, markProspectClosed } from './api/closures.ts';
import { formatClosureTime, isClosureConflict, type ClosureObservation } from './closure-windows.ts';

const observationsByProspect = new Map<string, ClosureObservation[]>();
let loaded = false;
let loading: Promise<void> | null = null;

function remember(observation: ClosureObservation) {
  const existing = observationsByProspect.get(observation.prospect_id) || [];
  observationsByProspect.set(observation.prospect_id, [observation, ...existing.filter(item => item.id !== observation.id)]);
}

async function ensureLoaded() {
  if (loaded || loading) return loading;
  loading = fetchClosureObservations()
    .then(observations => {
      observationsByProspect.clear();
      observations.forEach(remember);
      loaded = true;
    })
    .catch(() => {
      loaded = false;
      window.setTimeout(() => { loading = null; enhanceClosedRouteUi(); }, 1500);
    })
    .finally(() => { if (loaded) loading = null; });
  await loading;
}

function renderClosureMemory(row: HTMLElement, prospectId: string) {
  const info = row.querySelector<HTMLElement>('.route-info');
  if (!info) return;
  info.querySelector('.route-closure-memory')?.remove();
  const observations = observationsByProspect.get(prospectId) || [];
  if (!observations.length) {
    row.classList.remove('route-closed-conflict');
    return;
  }

  const conflict = observations.find(item => isClosureConflict(item));
  const shown = conflict || observations[0];
  const memory = document.createElement('div');
  memory.className = `route-closure-memory${conflict ? ' conflict' : ''}`;
  memory.textContent = `${conflict ? '⚠ ' : ''}Closed ${formatClosureTime(shown)}`;
  info.appendChild(memory);
  row.classList.toggle('route-closed-conflict', Boolean(conflict));
}

function enhanceRow(row: HTMLElement) {
  const controls = row.querySelector<HTMLElement>('.route-ctrls');
  const removeButton = controls?.querySelector<HTMLButtonElement>('.route-rm[data-id]');
  const name = row.querySelector<HTMLElement>('.route-name')?.textContent?.trim() || 'this stop';
  const prospectId = removeButton?.dataset.id || '';
  if (!controls || !removeButton || !prospectId || name === 'Unavailable prospect') return;

  renderClosureMemory(row, prospectId);
  if (row.dataset.closedEnhanced === 'true') return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-small route-closed';
  button.textContent = 'Closed';
  button.setAttribute('aria-label', `Mark ${name} closed at this day and time`);
  button.addEventListener('click', async event => {
    event.preventDefault();
    event.stopPropagation();
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
      const observation = await markProspectClosed(prospectId);
      remember(observation);
      renderClosureMemory(row, prospectId);
      button.textContent = 'Closed ✓';
      // A closed door is not a completed drop-off. Remove only from today's route.
      window.setTimeout(() => removeButton.click(), 180);
    } catch {
      button.disabled = false;
      button.textContent = 'Closed';
    }
  });

  const mapsButton = controls.querySelector('.route-single-gmaps');
  controls.insertBefore(button, mapsButton || removeButton);
  row.dataset.closedEnhanced = 'true';
}

export function enhanceClosedRouteUi(root: ParentNode = document) {
  void ensureLoaded().then(() => {
    root.querySelectorAll<HTMLElement>('.route-list .route-item').forEach(enhanceRow);
  });
}

function install() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  if (document.documentElement.dataset.otraClosedUiInstalled === 'true') return;
  document.documentElement.dataset.otraClosedUiInstalled = 'true';
  const start = () => {
    enhanceClosedRouteUi(document);
    const target = document.getElementById('app') || document.body;
    new MutationObserver(() => enhanceClosedRouteUi(document)).observe(target, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}

install();
