export const GOOGLE_MAPS_MAX_ROUTE_STOPS = 10;

export function isBulkGoogleMapsRouteSupported(stopCount: number): boolean {
  return stopCount > 0 && stopCount <= GOOGLE_MAPS_MAX_ROUTE_STOPS;
}

export function buildSingleStopGoogleMapsUrl(destination: string): string {
  const normalizedDestination = destination.trim();
  if (!normalizedDestination) throw new Error('A destination is required.');

  const params = new URLSearchParams({
    api: '1',
    travelmode: 'driving',
    destination: normalizedDestination,
  });

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function openSingleStopInGoogleMaps(destination: string) {
  const url = buildSingleStopGoogleMapsUrl(destination);
  const mapsWindow = window.open(url, '_blank', 'noopener');
  if (!mapsWindow) window.location.assign(url);
}

function enhanceRouteRow(row: HTMLElement) {
  if (row.dataset.singleMapsEnhanced === 'true') return;

  const name = row.querySelector<HTMLElement>('.route-name')?.textContent?.trim() || 'route stop';
  const address = row.querySelector<HTMLElement>('.route-addr')?.textContent?.trim() || '';
  const controls = row.querySelector<HTMLElement>('.route-ctrls');
  if (!controls || !address || name === 'Unavailable prospect') return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-small btn-secondary route-single-gmaps';
  button.textContent = 'Maps';
  button.setAttribute('aria-label', `Open ${name} in Google Maps`);
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    openSingleStopInGoogleMaps(address);
  });

  const removeButton = controls.querySelector('.route-rm');
  controls.insertBefore(button, removeButton);
  row.dataset.singleMapsEnhanced = 'true';
}

function updateBulkRouteControl(root: ParentNode) {
  const bulkButton = root.querySelector<HTMLButtonElement>('#btn-send-gmaps');
  if (!bulkButton) return;

  const routeList = bulkButton.parentElement?.querySelector<HTMLElement>('.route-list');
  const stopCount = routeList?.querySelectorAll('.route-item').length ?? 0;
  const parent = bulkButton.parentElement;
  if (!parent) return;

  const existingNote = parent.querySelector<HTMLElement>('.route-maps-limit-note');
  if (isBulkGoogleMapsRouteSupported(stopCount)) {
    if (bulkButton.dataset.otraOriginalLabel) {
      bulkButton.textContent = bulkButton.dataset.otraOriginalLabel;
      delete bulkButton.dataset.otraOriginalLabel;
    }
    if (bulkButton.disabled) bulkButton.disabled = false;
    bulkButton.removeAttribute('aria-disabled');
    bulkButton.removeAttribute('title');
    existingNote?.remove();
    return;
  }

  if (stopCount <= GOOGLE_MAPS_MAX_ROUTE_STOPS) return;

  if (!bulkButton.dataset.otraOriginalLabel) {
    bulkButton.dataset.otraOriginalLabel = bulkButton.textContent || 'Send route to Google Maps';
  }
  if (!bulkButton.disabled) bulkButton.disabled = true;
  bulkButton.setAttribute('aria-disabled', 'true');
  bulkButton.title = `Google Maps supports up to ${GOOGLE_MAPS_MAX_ROUTE_STOPS} stops in this handoff.`;
  const limitedLabel = `${stopCount} stops — use Maps per stop`;
  if (bulkButton.textContent !== limitedLabel) bulkButton.textContent = limitedLabel;

  if (!existingNote) {
    const note = document.createElement('div');
    note.className = 'route-hint route-maps-limit-note';
    note.textContent = `Google Maps can take up to ${GOOGLE_MAPS_MAX_ROUTE_STOPS} stops at once. Use Maps on any restaurant below for a single-stop handoff.`;
    bulkButton.before(note);
  }
}

export function enhanceRouteMaps(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('.route-list .route-item').forEach(enhanceRouteRow);
  updateBulkRouteControl(root);
}

function installRouteMapsEnhancer() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  if (document.documentElement.dataset.otraRouteMapsInstalled === 'true') return;
  document.documentElement.dataset.otraRouteMapsInstalled = 'true';

  const start = () => {
    enhanceRouteMaps(document);
    const target = document.getElementById('app') || document.body;
    const observer = new MutationObserver(() => enhanceRouteMaps(document));
    observer.observe(target, { childList: true, subtree: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}

installRouteMapsEnhancer();
