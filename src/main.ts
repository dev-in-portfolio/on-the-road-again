import type * as maplibregl from 'maplibre-gl';
import {
  fetchProspects, createProspect, updateProspect,
  toggleDroppedOff, archiveProspect, restoreProspect, deleteProspect,
  geocodeAutocomplete, geocodeSearch, getAccessSession, signIn,
} from './api/client';
import { Prospect, AutocompleteSuggestion, CreateProspectInput } from './types/prospect';
import { buildRouteGoogleMapsUrl } from './google-maps';
import {
  addRouteStop, moveRouteStop, removeRouteStop, resolveRoute, routeEntries,
  loadRouteIds, saveRouteIds,
} from './route-state';
import { filterProspects, sortProspects, distanceMiles, ListFilter, ListSort } from './prospect-list';
import { upsertProspect, removeProspectById, prependProspect } from './prospect-actions';
import { parseImportText, ImportRow } from './import-parser';
import { RequestSequencer } from './search-coordination';
import { emptyFieldState, loadFieldState, saveFieldState, type FieldState, type PendingOperation } from './field-state';
import { OTRA_BUILD, OTRA_PACKAGE_ID, OTRA_VERSION } from './app-release';
import { checkForAndroidUpdate, getInstalledAppInfo, type InstalledAppInfo } from './update-manager';
import { downloadVerifyAndInstall } from './android-updater';
import type { AndroidRelease } from './mobile-updates';

// ─── Constants ─────────────────────────────────────────
const DEFAULT_CENTER: [number, number] = [-95.7129, 37.0902];
const DEFAULT_ZOOM = 3.5;
const SINGLE_ZOOM = 15;

// ─── State ─────────────────────────────────────────────
let prospects: Prospect[] = [];
// Complete active prospect data. Search changes only `prospects`, never this
// canonical store or the saved route.
let activeProspects: Prospect[] = [];
let archivedProspects: Prospect[] = [];
let loading = true;
let archivedLoading = false;
let errorMessage: string | null = null;
let submitting = false;
let fieldState: FieldState = emptyFieldState();
let syncMessage: string | null = null;
let installedAppInfo: InstalledAppInfo = { version: OTRA_VERSION, build: OTRA_BUILD, packageId: OTRA_PACKAGE_ID };
let availableUpdate: AndroidRelease | null = null;
let updateStatus = 'Not checked';
let updateChecking = false;

type View = 'panel-list' | 'panel-route' | 'panel-add' | 'panel-detail' | 'panel-edit' | 'panel-archived' | 'panel-import';
let panelView: View = 'panel-list';
type AppScreen = 'map' | 'route' | 'prospects' | 'activity' | 'more';
let appScreen: AppScreen = 'map';
let selectedProspectId: string | null = null;
let searchQuery = '';
let searchAbort: AbortController | null = null;
let searchTimer: ReturnType<typeof setTimeout> | null = null;
const searchSequencer = new RequestSequencer();
let listFilter: ListFilter = 'all';
let listSort: ListSort = 'nearby';

let addStep: 'entry' | 'confirm' | 'duplicate' = 'entry';
let addName = '', addAddress = '', addNormalized = '';
let addLat: number | null = null, addLon: number | null = null, addPlaceId = '';
let addDuplicates: Prospect[] = [], addAddressSelected = false;

let acSug: AutocompleteSuggestion[] = [], acVis = false;
let acAbort: AbortController | null = null, acTimer: ReturnType<typeof setTimeout> | null = null;

let edName = '', edAddr = '', edNorm = '';
let edLat: number | null = null, edLon: number | null = null, edPid = '';
let edDups: Prospect[] = [];
let edStep: 'entry' | 'confirm' | 'duplicate' = 'entry';
let edAcSug: AutocompleteSuggestion[] = [], edAcVis = false;
let edAcAbort: AbortController | null = null, edAcTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Import State ──────────────────────────────────────
let importRows: ImportRow[] = [];
let importPhase: 'paste' | 'preview' | 'geocoding' | 'results' = 'paste';
let importText = '';
let importRunning = false;
const IMPORT_CONCURRENCY = 3;

async function runImportGeocodeBatch() {
  importRunning = true; importPhase = 'geocoding';
  renderPanel();

  const pending = importRows.filter(r => r.status === 'pending');
  for (let i = 0; i < pending.length; i += IMPORT_CONCURRENCY) {
    const batch = pending.slice(i, i + IMPORT_CONCURRENCY);
    await Promise.all(batch.map(async (row) => {
      row.status = 'geocoding'; renderPanel();
      try {
        const result = await geocodeSearch(row.address);
        if (result.results.length > 0 && result.isPrecise) {
          row.normalized = result.best.formatted;
          row.lat = result.best.lat; row.lon = result.best.lon;
          row.placeId = result.best.placeId;
          row.status = 'ready';
        } else {
          row.status = 'needs_review';
          row.errorMsg = result.results.length > 0 ? 'Address too broad.' : 'Could not locate.';
        }
      } catch (e: unknown) {
        row.status = 'error';
        row.errorMsg = e instanceof Error ? e.message : 'Geocoding failed.';
      }
    }));
    renderPanel();
  }
  importRunning = false; importPhase = 'results'; renderPanel();
}

async function saveImportRows() {
  const ready = importRows.filter(r => r.status === 'ready');
  if (!ready.length) return;
  importRunning = true; renderPanel();
  let saved = 0; let duped = 0;
  for (const row of ready) {
    if (row.status !== 'ready') continue;
    try {
      const result = await createProspect({
        restaurant_name: row.name,
        address_input: row.address,
        address_normalized: row.normalized || null,
        latitude: row.lat ?? null,
        longitude: row.lon ?? null,
        geocode_provider: row.lat != null ? 'Geoapify' : null,
        geocode_reference: row.placeId || null,
      });
      if ('code' in result && result.code === 'DUPLICATE_DETECTED') {
        row.status = 'duplicate';
        row.duplicates = result.duplicates;
        duped++;
      } else {
        row.status = 'imported';
        prospects = prependProspect(prospects, result as Prospect);
        activeProspects = prependProspect(activeProspects, result as Prospect);
        saved++;
      }
    } catch (e: unknown) {
      row.status = 'error';
      row.errorMsg = e instanceof Error ? e.message : 'Save failed.';
    }
    renderPanel();
  }
  if (saved > 0) refreshMarkers();
  importRunning = false; renderPanel();
}

function resetImport() {
  importRows = []; importPhase = 'paste'; importText = ''; importRunning = false;
}

// ─── Route State ───────────────────────────────────────
let routeIds: string[] = [];

function loadRoute(): string[] {
  return loadRouteIds(localStorage);
}
function saveRoute() {
  saveRouteIds(localStorage, routeIds);
  fieldState = { ...fieldState, routeIds, selectedProspectId, prospects: activeProspects };
  void saveFieldState(fieldState);
}
function getRouteIndex(id: string): number { return routeIds.indexOf(id); }
function isInRoute(id: string): boolean { return routeIds.indexOf(id) >= 0; }
function getRouteResolution() { return resolveRoute(routeIds, activeProspects); }

function addToRoute(id: string): string | null {
  const next = addRouteStop(routeIds, id);
  if (!next) return 'Unable to add this stop to the route.';
  if (next === routeIds) return null;
  routeIds = next;
  saveRoute();
  refreshMarkers();
  return null;
}
function removeFromRoute(id: string) {
  routeIds = removeRouteStop(routeIds, id);
  saveRoute();
  refreshMarkers();
}
function moveRouteItem(idx: number, dir: -1 | 1) {
  const next = moveRouteStop(routeIds, idx, dir);
  if (next === routeIds) return;
  routeIds = next;
  saveRoute();
  refreshMarkers();
  renderPanel();
}
function clearRoute() {
  if (!routeIds.length) return;
  if (!confirm(`Clear all ${routeIds.length} selected stops?`)) return;
  routeIds = [];
  saveRoute();
  refreshMarkers();
}

function persistFieldContext() {
  fieldState = {
    ...fieldState, routeIds, selectedProspectId, prospects: activeProspects,
    filters: { searchQuery, listFilter, listSort },
  };
  void saveFieldState(fieldState);
}

function queueOfflineOperation(kind: PendingOperation['kind'], payload: unknown, prospectId?: string) {
  const operation: PendingOperation = {
    id: crypto.randomUUID(), kind, prospectId, payload,
    createdAt: new Date().toISOString(), attempts: 0,
  };
  fieldState = { ...fieldState, pendingOperations: [...fieldState.pendingOperations, operation] };
  syncMessage = `OFFLINE · ${fieldState.pendingOperations.length} pending`;
  void saveFieldState(fieldState);
}

async function flushOfflineOperations() {
  if (!navigator.onLine || !fieldState.pendingOperations.length) return;
  const remaining: PendingOperation[] = [];
  for (const operation of fieldState.pendingOperations) {
    try {
      if (operation.kind === 'UPDATE_PROSPECT') await updateProspect(operation.payload as Parameters<typeof updateProspect>[0]);
      else if (operation.kind === 'CREATE_PROSPECT') await createProspect(operation.payload as CreateProspectInput);
      else if (operation.kind === 'DELETE_PROSPECT') await deleteProspect(operation.prospectId || String((operation.payload as { id?: string }).id || ''));
    } catch {
      remaining.push({ ...operation, attempts: operation.attempts + 1 });
    }
  }
  fieldState = { ...fieldState, pendingOperations: remaining };
  syncMessage = remaining.length ? `OFFLINE · ${remaining.length} pending` : 'SYNCED ✓';
  await saveFieldState(fieldState);
  renderPanel();
}

// ─── Google Maps Handoff ───────────────────────────────

function buildGoogleMapsUrl(origin: [number, number] | null): string | { error: string } {
  return buildRouteGoogleMapsUrl(getRouteResolution(), origin);
}

function handleSendToGoogleMaps() {
  // Navigate to the complete universal URL during the original button tap.
  // Opening a blank tab and replacing it after an async geolocation request
  // prevents Android from handing the multi-stop URL to the Google Maps app.
  // If location has not been cached, Maps supplies the current location itself.
  const result = buildGoogleMapsUrl(currentLocation);
  if (typeof result === 'object' && 'error' in result) {
    errorMessage = result.error;
    renderPanel();
    return;
  }

  const mapsWindow = window.open(result, '_blank', 'noopener');
  if (!mapsWindow) window.location.assign(result);
}

// ─── Map ───────────────────────────────────────────────
let map: maplibregl.Map | null = null;
let maplibreglModule: typeof maplibregl | null = null;
let mapLoading = false;
let markers: Map<string, maplibregl.Marker> = new Map();
let mapPopup: maplibregl.Popup | null = null;
let selectedMarkerId: string | null = null;
let currentLocation: [number, number] | null = null;
let currentLocationMarker: maplibregl.Marker | null = null;
let mapReady = false;
let initialMapFitApplied = false;
let mapResizeObserver: ResizeObserver | null = null;

async function createMap() {
  if (map || mapLoading) return;
  mapLoading = true;
  try {
    [maplibreglModule] = await Promise.all([
      import('maplibre-gl'),
      import('maplibre-gl/dist/maplibre-gl.css'),
    ]);
  } catch {
    errorMessage = 'The map could not be loaded. Please refresh and try again.';
    renderPanel();
    return;
  } finally {
    mapLoading = false;
  }

  map = new maplibreglModule!.Map({
    container: 'map-container',
    style: {
      version: 8,
      sources: { 'osm': { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '&copy; OpenStreetMap' } },
      layers: [{ id: 'osm-layer', type: 'raster', source: 'osm' }],
    },
    center: fieldState.mapView?.center || DEFAULT_CENTER,
    zoom: fieldState.mapView?.zoom || DEFAULT_ZOOM, attributionControl: false,
  });
  map.addControl(new maplibreglModule!.AttributionControl({ compact: true }), 'bottom-right');
  map.on('load', () => {
    mapReady = true;
    refreshMarkers();
    applyInitialMapFit();
  });

  // The map is behind a responsive panel. Keep the WebGL canvas and DOM markers
  // in the same coordinate space whenever that shell changes size.
  const container = document.getElementById('map-container');
  if (container && typeof ResizeObserver !== 'undefined') {
    mapResizeObserver?.disconnect();
    mapResizeObserver = new ResizeObserver(() => {
      map?.resize();
      refreshMarkers();
    });
    mapResizeObserver.observe(container);
  }
  window.addEventListener('resize', () => {
    map?.resize();
    refreshMarkers();
  });
  map.on('moveend', () => {
    refreshMarkers();
    if (map) {
      const center = map.getCenter();
      fieldState = { ...fieldState, mapView: { center: [center.lng, center.lat], zoom: map.getZoom() } };
      void saveFieldState(fieldState);
    }
  });
}

function applyInitialMapFit() {
  if (!mapReady || initialMapFitApplied || !prospects.length) return;
  initialMapFitApplied = true;
  map!.resize();
  refreshMarkers();
  fitMap();
}

function mapFitPadding() {
  // The panel is an overlay, not part of the map's layout. Reserve its exact
  // height so the opening view puts pins in the visible area above it.
  const panelHeight = document.getElementById('panel-container')?.getBoundingClientRect().height ?? 0;
  return { top: 72, right: 60, bottom: panelHeight + 84, left: 60 };
}

function fitMap() {
  if (!map) return;
  const v = prospects.filter(p => p.latitude != null && p.longitude != null);
  if (!v.length) { map.flyTo({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM }); return; }
  const padding = mapFitPadding();
  if (v.length === 1) {
    map.flyTo({
      center: [v[0].longitude!, v[0].latitude!],
      zoom: SINGLE_ZOOM,
      offset: [0, -(padding.bottom - padding.top) / 2],
    });
    return;
  }
  const b = new maplibreglModule!.LngLatBounds();
  for (const p of v) b.extend([p.longitude!, p.latitude!]);
  map.fitBounds(b, { padding, maxZoom: 14 });
}

function markerHTML(p: Prospect): string {
  const ri = getRouteIndex(p.id);
  const routed = ri >= 0;
  const fill = routed ? '#e8b84a' : p.dropped_off ? '#c94f68' : '#17243a';
  const ring = routed ? '#101827' : p.dropped_off ? '#f0a0ae' : '#f0e4c8';
  const center = routed
    ? `<text x="18" y="23" text-anchor="middle" fill="#101827" font-family="system-ui,sans-serif" font-size="16" font-weight="900">${ri + 1}</text>`
    : p.dropped_off
      ? '<path d="M18 11c-3-4-8 0-5 4-5-1-6 5-2 7-2 5 5 7 7 2 2 5 9 3 7-2 4-2 3-8-2-7 3-4-2-8-5-4Z" fill="#f5e8cf"/><circle cx="18" cy="18" r="2.2" fill="#a52e47"/>'
      : '<path d="M18 10 21 16 28 17 23 22 24 29 18 26 12 29 13 22 8 17 15 16Z" fill="#e8b84a"/>';
  const droppedFlag = routed && p.dropped_off
    ? '<circle cx="29" cy="9" r="6" fill="#c94f68" stroke="#f5e8cf" stroke-width="2"/><path d="m26 9 2 2 4-5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
    : '';
  return `<svg class="marker-glyph" width="36" height="46" viewBox="0 0 36 46" aria-hidden="true"><path d="M18 1.5C8.9 1.5 2 8.2 2 17.1c0 11.4 16 27.4 16 27.4s16-16 16-27.4C34 8.2 27.1 1.5 18 1.5Z" fill="#0a101c" stroke="#fff4d8" stroke-width="2.5"/><circle cx="18" cy="18" r="12.2" fill="${fill}" stroke="${ring}" stroke-width="2"/><path d="M9 18h18" stroke="${routed ? '#101827' : '#ffffff'}" stroke-opacity=".2" stroke-width="1"/>${center}${droppedFlag}</svg>`;
}

function markerAria(p: Prospect): string {
  const ri = getRouteIndex(p.id);
  const parts = [p.restaurant_name];
  if (ri >= 0) parts.unshift(`Stop ${ri + 1} —`);
  if (p.dropped_off) parts.push('— 🌹 Dropped Off');
  return parts.join(' ');
}

function refreshMarkers() {
  if (!map) return;
  if (map.getZoom() < 8) {
    for (const marker of markers.values()) marker.remove();
    markers.clear();
    const groups = new Map<string, { lon: number; lat: number; count: number }>();
    for (const prospect of prospects) {
      if (prospect.latitude == null || prospect.longitude == null) continue;
      const key = `${Math.round(prospect.longitude * 2) / 2}:${Math.round(prospect.latitude * 2) / 2}`;
      const existing = groups.get(key);
      if (existing) { existing.lon = (existing.lon * existing.count + prospect.longitude) / (existing.count + 1); existing.lat = (existing.lat * existing.count + prospect.latitude) / (existing.count + 1); existing.count++; }
      else groups.set(key, { lon: prospect.longitude, lat: prospect.latitude, count: 1 });
    }
    for (const [key, group] of groups) {
      const element = document.createElement('button');
      element.className = 'map-cluster'; element.type = 'button'; element.textContent = String(group.count); element.setAttribute('aria-label', `${group.count} prospects in this area`);
      const cluster = new maplibreglModule!.Marker({ element }).setLngLat([group.lon, group.lat]).addTo(map);
      element.addEventListener('click', () => map?.easeTo({ center: [group.lon, group.lat], zoom: Math.min((map?.getZoom() || 3) + 3, 14) }));
      markers.set(`cluster:${key}`, cluster);
    }
    return;
  }
  const ids = new Set(prospects.map(p => p.id));
  for (const [id, m] of markers) { if (!ids.has(id)) { m.remove(); markers.delete(id); } }
  for (const p of prospects) {
    if (p.latitude == null || p.longitude == null) continue;
    const ex = markers.get(p.id);
    const rCls = getRouteIndex(p.id) >= 0 ? ' marker-routed' : '';
    const sCls = selectedMarkerId === p.id ? ' marker-selected' : '';
    if (ex) {
      const el = ex.getElement();
      el.className = `map-marker ${p.dropped_off ? 'marker-dropped' : 'marker-active'}${rCls}${sCls}`;
      el.setAttribute('aria-label', markerAria(p));
      el.innerHTML = markerHTML(p);
      ex.setLngLat([p.longitude, p.latitude]);
    } else {
      const el = document.createElement('div');
      el.className = `map-marker ${p.dropped_off ? 'marker-dropped' : 'marker-active'}${rCls}${sCls}`;
      el.setAttribute('aria-label', markerAria(p));
      el.innerHTML = markerHTML(p);
      // Inline placement keeps marker geometry correct even when a restored PWA
      // shell has not yet applied the external MapLibre stylesheet.
      el.style.cssText = 'position:absolute;top:0;left:0;width:36px;height:46px;cursor:pointer';
      const mk = new maplibreglModule!.Marker({ element: el, anchor: 'bottom' }).setLngLat([p.longitude, p.latitude]).addTo(map!);
      // MapLibre's drag surface can suppress a plain click after a pointer/touch
      // interaction. Handle the release directly so pins work consistently on
      // desktop and mobile, while preventing the map from swallowing it.
      let openedFromPointer = false;
      const openMarker = (event: Event) => {
        event.stopPropagation();
        openPopup(p, mk);
      };
      el.addEventListener('pointerdown', (event) => {
        openedFromPointer = true;
        openMarker(event);
        setTimeout(() => { openedFromPointer = false; }, 0);
      }, { capture: true });
      el.addEventListener('click', (event) => {
        if (!openedFromPointer) openMarker(event);
      });
      markers.set(p.id, mk);
    }
  }
  // NOTE: fitMap() intentionally NOT called here (ISSUE 3 fix).
  // Call fitMap() explicitly only on initial load or explicit user action.
}

function openPopup(p: Prospect, mk: maplibregl.Marker) {
  if (!map) return;
  selectedProspectId = p.id;
  appScreen = 'map';
  panelView = 'panel-list';
  renderPanel();
  refreshMarkers();
  return;
  /* Legacy desktop popup retained below for reference while the field shell
     uses the compact selected-prospect sheet above. */
  mapPopup?.remove();
  selectedMarkerId = p.id;
  refreshMarkers();
  const a = p.address_normalized || p.address_input;
  const inRt = isInRoute(p.id);
  const ri = getRouteIndex(p.id);
  const html = `<div class="map-popup">
    <div class="popup-name">${ri >= 0 ? `<span class="route-badge-sm">${ri + 1}</span> ` : ''}${esc(p.restaurant_name)}</div>
    <div class="popup-addr">${esc(a)}</div>
    <div class="${p.dropped_off ? 'popup-dropped' : 'popup-pending'}">${p.dropped_off ? '🌹 Dropped Off ' + (p.dropped_off_at ? new Date(p.dropped_off_at || '').toLocaleDateString() : '') : 'Still on the road'}</div>
    <div class="popup-actions">
      <button class="popup-btn popup-btn-primary" data-act="pop-view" data-id="${p.id}">View</button>
      <button class="popup-btn ${p.dropped_off ? 'popup-btn-dropped' : 'popup-btn-pending'}" data-act="pop-toggle" data-id="${p.id}" data-dr="${p.dropped_off}">${p.dropped_off ? 'Undo' : '🌹 Drop'}</button>
    </div>
    <div class="popup-actions" style="margin-top:4px;">
      <button class="popup-btn ${inRt ? 'popup-btn-danger' : 'popup-btn-route'}" data-act="pop-route" data-id="${p.id}">${inRt ? 'Remove from Route' : '+ Add to Route'}</button>
    </div></div>`;
  mapPopup = new maplibreglModule!.Popup({ offset: [0, -38], closeButton: true, maxWidth: '280px' }).setLngLat(mk.getLngLat()).setHTML(html).addTo(map!);
  mapPopup!.once('close', () => { selectedMarkerId = null; refreshMarkers(); });
  // addTo() fires the popup's open event synchronously, so bind directly to
  // the created popup element rather than subscribing after that event.
  const popupElement = mapPopup!.getElement();
  popupElement?.querySelector('[data-act="pop-view"]')?.addEventListener('click', (event) => {
    event.stopPropagation();
    selectedProspectId = p.id; panelView = 'panel-detail'; renderPanel();
  });
  popupElement?.querySelector('[data-act="pop-toggle"]')?.addEventListener('click', (event) => {
    event.stopPropagation();
    mapToggleDropped(p.id, p.dropped_off);
  });
  popupElement?.querySelector('[data-act="pop-route"]')?.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleRouteSelection(p.id);
  });
}

function toggleRouteSelection(id: string) {
  if (isInRoute(id)) { removeFromRoute(id); } else {
    const err = addToRoute(id);
    if (err) { errorMessage = err; renderPanel(); return; }
  }
  renderPanel();
  const mk = markers.get(id); const p = getById(id);
  if (mk && p) openPopup(p, mk);
}

async function mapToggleDropped(id: string, cur: boolean) {
  try {
    const u = await toggleDroppedOff(id, cur);
    prospects = upsertProspect(prospects, u);
    activeProspects = upsertProspect(activeProspects, u);
    refreshMarkers();
    // Re-render the open popup so its status and Drop/Undo label update in place.
    const mk = markers.get(id);
    if (mk) openPopup(u, mk);
    if (panelView === 'panel-detail' && selectedProspectId === id) renderPanel();
    if (!cur) playDropStamp(u.restaurant_name);
  } catch (e: unknown) { errorMessage = e instanceof Error ? e.message : 'Failed'; renderPanel(); }
}

function flyTo(p: Prospect) {
  if (!map || p.latitude == null || p.longitude == null) return;
  map.flyTo({ center: [p.longitude, p.latitude], zoom: SINGLE_ZOOM });
  const m = markers.get(p.id);
  if (m) setTimeout(() => openPopup(p, m), 600);
}

function setCurrentLocation(coordinates: [number, number]) {
  currentLocation = coordinates;
  if (!map) return;
  if (!currentLocationMarker) {
    const el = document.createElement('div');
    el.setAttribute('aria-label', 'Your current location');
    el.style.cssText = 'width:18px;height:18px;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 0 0 4px rgba(37,99,235,.28);position:absolute';
    currentLocationMarker = new maplibreglModule!.Marker({ element: el, anchor: 'center' }).setLngLat(coordinates).addTo(map);
  } else {
    currentLocationMarker.setLngLat(coordinates);
  }
  if (panelView === 'panel-list' && listSort === 'nearby') renderPanel();
}

function requestCurrentLocation(flyToLocation: boolean): Promise<[number, number] | null> {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise(resolve => navigator.geolocation.getCurrentPosition(
    pos => {
      const coordinates: [number, number] = [pos.coords.longitude, pos.coords.latitude];
      setCurrentLocation(coordinates);
      if (flyToLocation && map) map.flyTo({ center: coordinates, zoom: 14 });
      resolve(coordinates);
    },
    () => resolve(null),
    { timeout: 8000, enableHighAccuracy: true, maximumAge: 60000 },
  ));
}

async function handleLocate() {
  const coordinates = await requestCurrentLocation(true);
  if (!coordinates) {
    errorMessage = 'Location wasn’t available. Check your browser permission and try again.';
    renderPanel();
  }
}

// ─── Shell ─────────────────────────────────────────────
function setupShell() {
  const app = document.getElementById('app')!;
  app.innerHTML = `<div id="map-container"></div><div id="top-bar"><div id="search-bar"></div><div id="sync-status" aria-live="polite"></div></div><div id="panel-container"></div><nav id="bottom-nav" aria-label="Primary navigation"><button data-screen="map" class="nav-item active"><span>⌖</span><small>Map</small></button><button data-screen="route" class="nav-item"><span>⚡</span><small>Route</small><b id="nav-route-count">0</b></button><button data-screen="prospects" class="nav-item"><span>◉</span><small>Prospects</small></button><button data-screen="activity" class="nav-item"><span>✓</span><small>Activity</small></button><button data-screen="more" class="nav-item"><span>⋯</span><small>More</small></button></nav>`;
  const updateBanner = document.createElement('div');
  updateBanner.id = 'update-banner';
  updateBanner.setAttribute('aria-live', 'polite');
  app.insertBefore(updateBanner, document.getElementById('panel-container'));
  document.querySelectorAll<HTMLButtonElement>('.nav-item').forEach(button => button.addEventListener('click', () => navigateScreen(button.dataset.screen as AppScreen)));
  setupMapControls();
  renderPanel();
  updateSearchBar();
  renderUpdateBanner();
}

function navigateScreen(screen: AppScreen) {
  appScreen = screen;
  if (screen === 'map') panelView = 'panel-list';
  if (screen === 'route') panelView = 'panel-route';
  if (screen === 'prospects') panelView = 'panel-list';
  if (screen === 'activity') panelView = 'panel-list';
  if (screen === 'more') panelView = 'panel-list';
  document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.getAttribute('data-screen') === screen));
  updateSearchBar();
  renderPanel();
}

async function checkForUpdates(force = false) {
  if (updateChecking) return;
  updateChecking = true;
  try {
    const result = await checkForAndroidUpdate({ force });
    installedAppInfo = result.installed;
    availableUpdate = result.release;
    updateStatus = result.error ? `Unavailable · ${result.error}` : result.release ? `Update ${result.release.version} available` : 'Up to date';
  } catch {
    updateStatus = 'Update check unavailable';
  } finally {
    updateChecking = false;
    renderUpdateBanner();
    if (appScreen === 'more') renderPanel();
  }
}

async function startAndroidUpdate() {
  if (!availableUpdate) return;
  persistFieldContext();
  updateStatus = 'Downloading update…';
  renderUpdateBanner();
  try {
    await downloadVerifyAndInstall(availableUpdate, installedAppInfo.build);
    updateStatus = 'Installer opened';
  } catch (error: unknown) {
    updateStatus = error instanceof Error ? error.message : 'Update installation failed.';
  }
  renderUpdateBanner();
  if (appScreen === 'more') renderPanel();
}

function renderUpdateBanner() {
  const banner = document.getElementById('update-banner');
  if (!banner) return;
  banner.innerHTML = availableUpdate
    ? `<div class="update-banner-card"><span>OTRA ${esc(availableUpdate.version)} is available${availableUpdate.critical ? ' · Required' : ''}</span><button class="btn btn-primary btn-small" id="update-now">Update</button><button class="btn btn-small btn-secondary" id="update-later">Later</button></div>`
    : '';
  document.getElementById('update-now')?.addEventListener('click', () => { void startAndroidUpdate(); });
  document.getElementById('update-later')?.addEventListener('click', () => { availableUpdate = null; renderUpdateBanner(); });
}

function setupMapControls() {
  const mc = document.getElementById('map-container');
  if (!mc) return;
  const div = document.createElement('div'); div.id = 'map-controls';
  div.innerHTML = `<button class="map-ctrl-btn route-control" id="btn-current-route" title="Open Current Route" aria-label="Open Current Route">ROUTE · 0</button><button class="map-ctrl-btn" id="btn-locate" title="Locate Me" aria-label="Locate Me">📍</button><button class="map-ctrl-btn" id="btn-map-add" title="Add Prospect" aria-label="Add Prospect">＋</button>`;
  mc.appendChild(div);
  document.getElementById('btn-current-route')?.addEventListener('click', () => navigateScreen('route'));
  document.getElementById('btn-locate')?.addEventListener('click', handleLocate);
  document.getElementById('btn-map-add')?.addEventListener('click', () => { resetAdd(); panelView = 'panel-add'; renderPanel(); });
}

function updateRouteControl() {
  const button = document.getElementById('btn-current-route');
  if (!button) return;
  button.textContent = `ROUTE · ${routeIds.length}`;
  button.setAttribute('aria-label', `Open Current Route, ${routeIds.length} stop${routeIds.length === 1 ? '' : 's'}`);
  const sync = document.getElementById('sync-status');
  if (sync) { sync.textContent = syncMessage || ''; sync.className = syncMessage?.startsWith('OFFLINE') ? 'offline' : ''; }
  const navCount = document.getElementById('nav-route-count');
  if (navCount) navCount.textContent = String(routeIds.length);
}

function updateSearchBar() {
  const sb = document.getElementById('search-bar'); if (!sb) return;
  sb.parentElement?.classList.toggle('screen-map', appScreen === 'map');
  sb.innerHTML = `<input type="search" id="shell-search" class="form-input search-input" placeholder="Search prospects..." autocomplete="off" value="${esc(searchQuery)}">${searchQuery ? '<button class="btn btn-small btn-secondary" id="shell-clear">✕</button>' : ''}`;
  document.getElementById('shell-search')?.addEventListener('input', e => { searchQuery = (e.target as HTMLInputElement).value; scheduleSearch(); });
  document.getElementById('shell-clear')?.addEventListener('click', () => { searchQuery = ''; scheduleSearch(true); });
}

function scheduleSearch(immediate = false) {
  if (searchTimer) clearTimeout(searchTimer);
  if (searchAbort) searchAbort.abort();
  const run = () => { void loadData(); };
  searchTimer = immediate ? null : setTimeout(run, 220);
  if (immediate) run();
}

// ─── Data ──────────────────────────────────────────────
async function loadData() {
  const requestSequence = searchSequencer.next();
  searchAbort?.abort();
  const controller = new AbortController();
  searchAbort = controller;
  loading = true; errorMessage = null;
  if (fieldState.prospects.length && !activeProspects.length) {
    activeProspects = fieldState.prospects;
    prospects = searchQuery ? fieldState.prospects.filter(p => `${p.restaurant_name} ${p.address_input}`.toLowerCase().includes(searchQuery.toLowerCase())) : fieldState.prospects;
  }
  renderPanel();
  try {
    const visible = await fetchProspects(searchQuery || undefined, false, controller.signal);
    if (!searchSequencer.isCurrent(requestSequence)) return;
    prospects = visible;
    // Search results are display-only. The unfiltered load hydrates the route's
    // canonical source of truth and is never replaced by a filtered result.
    if (!searchQuery) {
      activeProspects = visible;
      fieldState = { ...fieldState, prospects: activeProspects };
      void saveFieldState(fieldState);
    }
  }
  catch (e: unknown) {
    if (!searchSequencer.isCurrent(requestSequence) || (e instanceof DOMException && e.name === 'AbortError')) return;
    errorMessage = fieldState.prospects.length ? null : (e instanceof Error ? e.message : 'Failed to load.');
    if (fieldState.prospects.length) syncMessage = `OFFLINE · ${fieldState.pendingOperations.length} pending`;
  }
  finally {
    if (!searchSequencer.isCurrent(requestSequence)) return;
    loading = false;
    void createMap();
    refreshMarkers();
    // Render first: fitMap uses the panel's real overlay height.
    renderPanel();
    applyInitialMapFit();
  }
}

async function showArchived() {
  panelView = 'panel-archived';
  archivedLoading = true;
  errorMessage = null;
  renderPanel();
  try {
    const allProspects = await fetchProspects(undefined, true);
    archivedProspects = allProspects.filter((prospect) => prospect.archived);
  } catch (e: unknown) {
    errorMessage = e instanceof Error ? e.message : 'Failed to load archived prospects.';
  } finally {
    archivedLoading = false;
    renderPanel();
  }
}

// ─── Autocomplete ──────────────────────────────────────
const acSequencer = new RequestSequencer(); // monotonically increasing sequence to reject stale responses

function triggerAc(
  text: string,
  setSug: (s: AutocompleteSuggestion[]) => void, setVis: (v: boolean) => void,
  abort: AbortController | null, setAbort: (a: AbortController | null) => void,
  timer: ReturnType<typeof setTimeout> | null, setTimer: (t: ReturnType<typeof setTimeout> | null) => void,
  rebuild: () => void,
) {
  // Cancel any pending timer and in-flight request IMMEDIATELY (ISSUE 4 fix)
  if (timer) clearTimeout(timer);
  if (abort) abort.abort();
  setAbort(null);
  setTimer(null);

  if (text.trim().length < 2) { setSug([]); setVis(false); return; }

  const seq = acSequencer.next(); // capture current sequence number
  const query = text.trim();

  const t = setTimeout(async () => {
    const ctrl = new AbortController(); setAbort(ctrl);
    try {
      const r = await geocodeAutocomplete(query, ctrl.signal);
      // Only accept result if no newer input has arrived (ISSUE 4 guard)
      if (!acSequencer.isCurrent(seq)) return;
      setSug(r); setVis(r.length > 0);
    } catch {
      // Silently ignore aborted/failed — only if still current
      if (!acSequencer.isCurrent(seq)) return;
      setSug([]); setVis(false);
    }
    rebuild();
  }, 300);
  setTimer(t);
}

function updateAcDropdown(wrapper: HTMLElement, sug: AutocompleteSuggestion[], vis: boolean, onSel: (s: AutocompleteSuggestion) => void) {
  const old = wrapper.querySelector('.autocomplete-dropdown'); if (old) old.remove();
  if (!vis || !sug.length) return;
  const dd = document.createElement('div'); dd.className = 'autocomplete-dropdown';
  sug.forEach(s => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'autocomplete-item';
    b.innerHTML = `<span class="autocomplete-label">${esc(s.formatted)}</span>`;
    b.addEventListener('mousedown', e => { e.preventDefault(); onSel(s); });
    dd.appendChild(b);
  });
  wrapper.appendChild(dd);
}

function selAddSug(s: AutocompleteSuggestion) { addAddress = s.formatted; addNormalized = s.formatted; addLat = s.lat; addLon = s.lon; addPlaceId = s.placeId; addAddressSelected = true; acSug = []; acVis = false; addStep = 'confirm'; renderPanel(); }
function selEdSug(s: AutocompleteSuggestion) { edAddr = s.formatted; edNorm = s.formatted; edLat = s.lat; edLon = s.lon; edPid = s.placeId; edAcSug = []; edAcVis = false; edStep = 'confirm'; renderPanel(); }

// ─── Add ───────────────────────────────────────────────
async function handleAddSubmit(e: SubmitEvent) {
  e.preventDefault();
  const f = e.target as HTMLFormElement;
  addName = (f.querySelector('#restaurant_name') as HTMLInputElement).value.trim();
  if (!addAddressSelected) addAddress = (f.querySelector('#address_input') as HTMLInputElement).value.trim();
  if (!addName || !addAddress) return; errorMessage = null;
  if (!addAddressSelected && addAddress) {
    submitting = true; renderPanel();
    try {
      const r = await geocodeSearch(addAddress);
      if (r.results.length > 0 && r.isPrecise) { addNormalized = r.best.formatted; addLat = r.best.lat; addLon = r.best.lon; addPlaceId = r.best.placeId; addStep = 'confirm'; submitting = false; renderPanel(); return; }
      errorMessage = r.results.length > 0 ? "We couldn't confidently locate this address." : "We couldn't locate this address.";
    } catch (er: unknown) { errorMessage = er instanceof Error ? er.message : 'Address search unavailable.'; }
    submitting = false; renderPanel(); return;
  }
  if (addAddressSelected && addStep !== 'confirm') { addStep = 'confirm'; renderPanel(); }
}

async function confirmAdd() {
  submitting = true; errorMessage = null; renderPanel();
  const inp: CreateProspectInput = { restaurant_name: addName, address_input: addAddress, address_normalized: addNormalized || null, latitude: addLat, longitude: addLon, geocode_provider: addLat !== null ? 'Geoapify' : null, geocode_reference: addPlaceId || null };
  try {
    const r = await createProspect(inp);
    if ('code' in r && r.code === 'DUPLICATE_DETECTED') { addDuplicates = r.duplicates; addStep = 'duplicate'; submitting = false; renderPanel(); return; }
    const created = r as Prospect; prospects = prependProspect(prospects, created); activeProspects = prependProspect(activeProspects, created); resetAdd(); panelView = 'panel-list'; refreshMarkers(); submitting = false; renderPanel();
  } catch (er: unknown) { errorMessage = er instanceof Error ? er.message : "Couldn't save."; submitting = false; renderPanel(); }
}

async function confirmAddDup() {
  submitting = true; renderPanel();
  const inp: CreateProspectInput = { restaurant_name: addName, address_input: addAddress, address_normalized: addNormalized || null, latitude: addLat, longitude: addLon, geocode_provider: addLat !== null ? 'Geoapify' : null, geocode_reference: addPlaceId || null, skip_duplicate_check: true };
  try { const created = await createProspect(inp) as Prospect; prospects = prependProspect(prospects, created); activeProspects = prependProspect(activeProspects, created); resetAdd(); panelView = 'panel-list'; refreshMarkers(); submitting = false; renderPanel(); }
  catch (er: unknown) { errorMessage = er instanceof Error ? er.message : "Couldn't save."; submitting = false; renderPanel(); }
}

function resetAdd() { addStep = 'entry'; addName = addAddress = addNormalized = ''; addLat = addLon = null; addPlaceId = ''; addDuplicates = []; addAddressSelected = false; acSug = []; acVis = false; }

// ─── Edit ──────────────────────────────────────────────
function startEdit(p: Prospect) {
  edName = p.restaurant_name; edAddr = p.address_input; edNorm = p.address_normalized || '';
  edLat = p.latitude; edLon = p.longitude; edPid = p.geocode_reference || '';
  edDups = []; edStep = 'entry'; edAcSug = []; edAcVis = false;
  panelView = 'panel-edit'; renderPanel();
}

async function handleEditSubmit(e: SubmitEvent) {
  e.preventDefault();
  const f = e.target as HTMLFormElement;
  const n = (f.querySelector('#edit_restaurant_name') as HTMLInputElement).value.trim();
  const a = (f.querySelector('#edit_address_input') as HTMLInputElement).value.trim();
  if (!n || !a || !selectedProspectId) return; errorMessage = null;
  const chg = a !== edAddr || edLat === null;
  if (chg && !edAcVis && edStep === 'entry') {
    submitting = true; renderPanel();
    try {
      const r = await geocodeSearch(a);
      if (r.results.length > 0 && r.isPrecise) { edName = n; edAddr = r.best.formatted; edNorm = r.best.formatted; edLat = r.best.lat; edLon = r.best.lon; edPid = r.best.placeId; edStep = 'confirm'; submitting = false; renderPanel(); return; }
      errorMessage = r.results.length > 0 ? "Couldn't precisely locate the new address." : "Couldn't locate the new address.";
    } catch (er: unknown) { errorMessage = er instanceof Error ? er.message : 'Address search unavailable.'; }
    submitting = false; renderPanel(); return;
  }
  edStep = 'confirm'; renderPanel();
}

async function confirmEdit() {
  if (!selectedProspectId) return; submitting = true; errorMessage = null; renderPanel();
  try {
    const r = await updateProspect({ id: selectedProspectId, restaurant_name: edName, address_input: edAddr, address_normalized: edNorm || null, latitude: edLat, longitude: edLon, geocode_provider: edLat !== null ? 'Geoapify' : null, geocode_reference: edPid || null });
    if ('code' in r && r.code === 'DUPLICATE_DETECTED') { edDups = r.duplicates; edStep = 'duplicate'; submitting = false; renderPanel(); return; }
    const u = r as Prospect; prospects = upsertProspect(prospects, u); activeProspects = upsertProspect(activeProspects, u); selectedProspectId = u.id; panelView = 'panel-detail'; refreshMarkers(); submitting = false; renderPanel();
  } catch (er: unknown) { errorMessage = er instanceof Error ? er.message : 'Failed to update.'; submitting = false; renderPanel(); }
}

async function confirmEditDup() {
  if (!selectedProspectId) return; submitting = true; renderPanel();
  try { const r = await updateProspect({ id: selectedProspectId, restaurant_name: edName, address_input: edAddr, address_normalized: edNorm || null, latitude: edLat, longitude: edLon, geocode_provider: edLat !== null ? 'Geoapify' : null, geocode_reference: edPid || null, skip_duplicate_check: true }); const u = r as Prospect; prospects = upsertProspect(prospects, u); activeProspects = upsertProspect(activeProspects, u); selectedProspectId = u.id; panelView = 'panel-detail'; refreshMarkers(); submitting = false; renderPanel(); }
  catch (er: unknown) { errorMessage = er instanceof Error ? er.message : 'Failed to update.'; submitting = false; renderPanel(); }
}

// ─── Actions ───────────────────────────────────────────
function applyLocalProspectUpdate(id: string, patch: Partial<Prospect>) {
  const update = (items: Prospect[]) => items.map(p => p.id === id ? { ...p, ...patch, updated_at: new Date().toISOString() } : p);
  prospects = update(prospects); activeProspects = update(activeProspects);
  fieldState = { ...fieldState, prospects: activeProspects };
  void saveFieldState(fieldState); refreshMarkers();
}

async function handleToggleDropped(id: string, cur: boolean) {
  const next = !cur;
  const local = activeProspects.find(p => p.id === id);
  applyLocalProspectUpdate(id, { dropped_off: next, dropped_off_at: next ? new Date().toISOString() : null });
  try {
    const u = await toggleDroppedOff(id, cur);
    prospects = upsertProspect(prospects, u); activeProspects = upsertProspect(activeProspects, u);
    fieldState = { ...fieldState, prospects: activeProspects }; void saveFieldState(fieldState);
    syncMessage = 'SYNCED ✓';
  } catch {
    queueOfflineOperation('UPDATE_PROSPECT', { id, dropped_off: next, dropped_off_at: next ? new Date().toISOString() : null }, id);
  }
  if ((panelView === 'panel-detail' && selectedProspectId === id) || panelView === 'panel-list' || panelView === 'panel-route') renderPanel();
  if (local && next) playDropStamp(local.restaurant_name);
}

function playDropStamp(name: string) {
  document.querySelector('.drop-stamp')?.remove();
  const stamp = document.createElement('div');
  stamp.className = 'drop-stamp';
  stamp.setAttribute('role', 'status');
  stamp.setAttribute('aria-label', `${name} marked Dropped Off`);
  stamp.innerHTML = `<img src="/otra-rose-stamp.svg" alt=""><span>DROPPED OFF</span>`;
  document.body.append(stamp);
  stamp.addEventListener('animationend', () => stamp.remove(), { once: true });
  window.setTimeout(() => stamp.remove(), 700);
}

async function handleArchive(id: string) {
  try {
    const archived = await archiveProspect(id);
    archivedProspects = [archived, ...archivedProspects.filter(p => p.id !== id)];
    prospects = removeProspectById(prospects, id); activeProspects = removeProspectById(activeProspects, id); refreshMarkers();
    if (selectedProspectId === id) { selectedProspectId = null; panelView = 'panel-list'; }
    renderPanel();
  }
  catch (e: unknown) { errorMessage = e instanceof Error ? e.message : 'Failed.'; renderPanel(); }
}

async function handleRestore(id: string) {
  try {
    const u = await restoreProspect(id);
    archivedProspects = archivedProspects.filter(p => p.id !== id);
    prospects = prependProspect(prospects, u); activeProspects = prependProspect(activeProspects, u); refreshMarkers();
    if (selectedProspectId === id) { selectedProspectId = id; panelView = 'panel-detail'; }
    renderPanel();
  }
  catch (e: unknown) { errorMessage = e instanceof Error ? e.message : 'Failed.'; renderPanel(); }
}

async function handleDelete(id: string) {
  if (!confirm('Permanently delete?')) return;
  try { await deleteProspect(id); removeFromRoute(id); prospects = removeProspectById(prospects, id); activeProspects = removeProspectById(activeProspects, id); refreshMarkers(); if (selectedProspectId === id) { selectedProspectId = null; panelView = 'panel-list'; } renderPanel(); }
  catch (e: unknown) { errorMessage = e instanceof Error ? e.message : 'Failed.'; renderPanel(); }
}

function getById(id: string): Prospect | undefined { return activeProspects.find(p => p.id === id); }

// ─── Panel Render ──────────────────────────────────────
function shortArea(p: Prospect): string {
  const address = p.address_normalized || p.address_input;
  return address.split(',').slice(-2).join(',').trim() || address;
}

function distanceLabel(p: Prospect): string {
  const miles = distanceMiles(currentLocation, p);
  return Number.isFinite(miles) ? `${miles.toFixed(miles < 10 ? 1 : 0)} mi` : '';
}

function rMap(p: HTMLElement) {
  const selected = getById(selectedProspectId || '');
  const next = routeEntries(routeIds, activeProspects).find(entry => entry.kind === 'resolved' && !entry.prospect.dropped_off);
  p.innerHTML = selected ? `<section class="map-sheet" aria-label="Selected prospect"><div class="sheet-grip"></div><div class="sheet-kicker">SELECTED PROSPECT</div><div class="sheet-title-row"><div><h1>${esc(selected.restaurant_name)}</h1><p>${esc(shortArea(selected))}${distanceLabel(selected) ? ` · ${distanceLabel(selected)}` : ''} · ${selected.dropped_off ? 'Dropped Off' : 'Active'}</p></div><button class="sheet-close" id="btn-sheet-close" aria-label="Close prospect">×</button></div><div class="sheet-actions"><button class="btn ${isInRoute(selected.id) ? 'btn-route-active' : 'btn-primary'}" id="btn-sheet-route">${isInRoute(selected.id) ? 'ON ROUTE' : '+ Add to Route'}</button><button class="btn btn-status ${selected.dropped_off ? 'dropped' : 'pending'}" id="btn-sheet-drop">Dropped Off</button><button class="btn btn-secondary" id="btn-sheet-details">Details</button></div><details class="sheet-more"><summary>Expand details</summary><div class="detail-value">${esc(selected.address_normalized || selected.address_input)}</div><button class="btn btn-secondary btn-full" id="btn-sheet-fly">Show on Map</button></details></section>` : `<section class="map-status-card"><div><span class="field-kicker">FIELD MAP</span><strong>ROUTE · ${routeIds.length}</strong><span>${routeIds.filter(id => activeProspects.find(p => p.id === id)?.dropped_off).length} Dropped · ${next && next.kind === 'resolved' ? `Next: ${esc(next.prospect.restaurant_name)}` : 'Choose your next stop'}</span></div><button class="btn btn-secondary" id="btn-map-route">Open Route</button></section>`;
  document.getElementById('btn-sheet-close')?.addEventListener('click', () => { selectedProspectId = null; selectedMarkerId = null; renderPanel(); refreshMarkers(); });
  document.getElementById('btn-sheet-route')?.addEventListener('click', () => { if (selected) toggleRouteSelection(selected.id); });
  document.getElementById('btn-sheet-drop')?.addEventListener('click', () => { if (selected) void handleToggleDropped(selected.id, selected.dropped_off); });
  document.getElementById('btn-sheet-details')?.addEventListener('click', () => { panelView = 'panel-detail'; renderPanel(); });
  document.getElementById('btn-sheet-fly')?.addEventListener('click', () => { if (selected) flyTo(selected); });
  document.getElementById('btn-map-route')?.addEventListener('click', () => navigateScreen('route'));
}

function rActivity(p: HTMLElement) {
  const completed = activeProspects.filter(prospect => prospect.dropped_off).sort((a, b) => (b.dropped_off_at || '').localeCompare(a.dropped_off_at || ''));
  p.innerHTML = `<section class="screen-panel"><div class="screen-heading"><div><span class="field-kicker">TODAY'S RUN</span><h1>Activity</h1><p>${completed.length} visits marked Dropped Off</p></div></div><details class="completed-section" open><summary>Completed · ${completed.length}</summary><div class="compact-list">${completed.length ? completed.map(x => `<div class="compact-row completed-row"><div><strong>${esc(x.restaurant_name)}</strong><span>${esc(shortArea(x))}</span></div><span class="badge badge-dropped">Dropped Off</span></div>`).join('') : '<div class="empty-state"><span class="empty-text">No completed visits yet. Your first stamp belongs here.</span></div>'}</div></details></section>`;
}

function rMore(p: HTMLElement) {
  p.innerHTML = `<section class="screen-panel more-screen"><div class="screen-heading"><div><span class="field-kicker">BACKSTAGE</span><h1>More</h1><p>Low-frequency field tools and diagnostics</p></div></div><div class="more-grid"><button class="more-tile" id="more-add"><span>＋</span><strong>Add Prospect</strong><small>Create one new field record</small></button><button class="more-tile" id="more-import"><span>▤</span><strong>Import</strong><small>Bring in a prepared setlist</small></button><button class="more-tile" id="more-archive"><span>▣</span><strong>Archived</strong><small>Restore hidden records</small></button><div class="more-tile diagnostics"><span>⌁</span><strong>Field diagnostics</strong><small>Version ${esc(installedAppInfo.version)} · Build ${installedAppInfo.build} · ${esc(updateStatus)}</small></div></div></section>`;
  const diagnostics = p.querySelector<HTMLElement>('.diagnostics');
  const diagnosticText = diagnostics?.querySelector('small');
  if (diagnosticText) diagnosticText.textContent = `Version ${installedAppInfo.version} · Build ${installedAppInfo.build} · ${updateStatus}`;
  if (diagnostics) {
    const checkButton = document.createElement('button');
    checkButton.className = 'btn btn-secondary btn-small'; checkButton.id = 'more-check-updates';
    checkButton.textContent = updateChecking ? 'Checking…' : 'Check for updates';
    checkButton.addEventListener('click', () => { void checkForUpdates(true); });
    diagnostics.appendChild(checkButton);
    if (availableUpdate) {
      const updateButton = document.createElement('button');
      updateButton.className = 'btn btn-primary btn-small'; updateButton.textContent = `Update ${availableUpdate.version}`;
      updateButton.addEventListener('click', () => { void startAndroidUpdate(); });
      diagnostics.appendChild(updateButton);
    }
  }
  document.getElementById('more-add')?.addEventListener('click', () => { resetAdd(); panelView = 'panel-add'; renderPanel(); });
  document.getElementById('more-import')?.addEventListener('click', () => { resetImport(); panelView = 'panel-import'; renderPanel(); });
  document.getElementById('more-archive')?.addEventListener('click', () => { void showArchived(); });
}

function rProspectsCompact(p: HTMLElement) {
  const listProspects = getListProspects();
  const activeFilters = [listFilter !== 'all' ? listFilter : '', listSort !== 'nearby' ? listSort : ''].filter(Boolean).length;
  p.innerHTML = `<section class="screen-panel prospect-screen"><div class="screen-heading"><div><span class="field-kicker">FIELD DIRECTORY</span><h1>Prospects</h1><p>${activeProspects.length} records · compact field view</p></div></div><details class="filter-drawer"><summary>Filters${activeFilters ? ` · ${activeFilters} active` : ''}</summary><div class="filter-controls"><label for="list-filter">Status</label><select class="form-input list-select" id="list-filter"><option value="all" ${listFilter === 'all' ? 'selected' : ''}>All prospects</option><option value="not-dropped" ${listFilter === 'not-dropped' ? 'selected' : ''}>Active only</option><option value="dropped" ${listFilter === 'dropped' ? 'selected' : ''}>Dropped Off</option><option value="route" ${listFilter === 'route' ? 'selected' : ''}>On Route</option></select><label for="list-sort">Sort</label><select class="form-input list-select" id="list-sort"><option value="nearby" ${listSort === 'nearby' ? 'selected' : ''}>Nearby</option><option value="name" ${listSort === 'name' ? 'selected' : ''}>A–Z</option></select></div></details><div class="compact-list">${loading ? '<div class="empty-state">Loading field directory…</div>' : !listProspects.length ? '<div class="empty-state">No prospects match those filters.</div>' : listProspects.map(x => `<details class="prospect-row" data-id="${x.id}"><summary><div class="prospect-row-main"><strong>${isInRoute(x.id) ? '⚡ ' : ''}${esc(x.restaurant_name)}</strong><span>${esc(shortArea(x))}${distanceLabel(x) ? ` · ${distanceLabel(x)}` : ''}</span></div><div class="prospect-row-state">${x.dropped_off ? '<span class="badge badge-dropped">Dropped Off</span>' : isInRoute(x.id) ? '<span class="badge badge-pending">On Route</span>' : '<span class="badge badge-pending">Active</span>'}<i>⌄</i></div></summary><div class="prospect-row-expanded"><p>${esc(x.address_normalized || x.address_input)}</p><div class="row-actions"><button class="btn btn-small ${isInRoute(x.id) ? 'btn-route-active' : 'btn-primary'} row-route" data-id="${x.id}">${isInRoute(x.id) ? 'ON ROUTE' : 'Add to Route'}</button><button class="btn btn-small btn-status ${x.dropped_off ? 'dropped' : 'pending'} row-drop" data-id="${x.id}" data-dr="${x.dropped_off}">Dropped Off</button><button class="btn btn-small btn-secondary row-details" data-id="${x.id}">Details</button></div></div></details>`).join('')}</div></section>`;
  document.getElementById('list-filter')?.addEventListener('change', event => { listFilter = (event.target as HTMLSelectElement).value as ListFilter; renderPanel(); });
  document.getElementById('list-sort')?.addEventListener('change', event => { listSort = (event.target as HTMLSelectElement).value as ListSort; renderPanel(); });
  p.querySelectorAll('.row-route').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); toggleRouteSelection(b.getAttribute('data-id')!); }));
  p.querySelectorAll('.row-drop').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); void handleToggleDropped(b.getAttribute('data-id')!, b.getAttribute('data-dr') === 'true'); }));
  p.querySelectorAll('.row-details').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); selectedProspectId = b.getAttribute('data-id'); panelView = 'panel-detail'; renderPanel(); }));
}

function renderPanel() {
  const p = document.getElementById('panel-container'); if (!p) return;
  if ((panelView === 'panel-list' || panelView === 'panel-route') && appScreen === 'map') rMap(p);
  else if (panelView === 'panel-list' && appScreen === 'prospects') rProspectsCompact(p);
  else if (panelView === 'panel-list' && appScreen === 'activity') rActivity(p);
  else if (panelView === 'panel-list' && appScreen === 'more') rMore(p);
  else switch (panelView) { case 'panel-list': rList(p); break; case 'panel-route': rRoute(p); break; case 'panel-add': rAdd(p); break; case 'panel-detail': rDetail(p); break; case 'panel-edit': rEdit(p); break; case 'panel-archived': rArch(p); break; case 'panel-import': rImport(p); break; }
  updateRouteControl();
  persistFieldContext();
}

function unavailableRouteRow(id: string, index: number): string {
  return `<div class="route-item route-work-item">
    <span class="route-num">${index + 1}.</span>
    <div class="route-info"><div class="route-name">Unavailable prospect</div><div class="route-addr">This stop is archived/deleted/unavailable.</div></div>
    <div class="route-ctrls"><button class="btn btn-small btn-danger route-rm" data-id="${esc(id)}" aria-label="Remove unavailable stop from route">Remove from Route</button></div>
  </div>`;
}

function rRoute(p: HTMLElement) {
  const entries = routeEntries(routeIds, activeProspects);
  const count = routeIds.length;
  const completedCount = entries.filter(entry => entry.kind === 'resolved' && entry.prospect.dropped_off).length;
  const nextEntry = entries.find(entry => entry.kind === 'resolved' && !entry.prospect.dropped_off);
  const routeComplete = count > 0 && entries.every(entry => entry.kind === 'resolved' && entry.prospect.dropped_off);
  p.innerHTML = `<div class="panel-header"><button class="btn btn-back" id="btn-route-back">← Map</button><h1 class="app-title" style="font-size:1.15rem;">Current Route</h1></div>
    ${errorMessage ? `<div class="error-banner">${esc(errorMessage)}</div>` : ''}
    <div class="card route-tray">
      <div class="card-title"><span>Today's Setlist</span><span class="badge ${routeComplete ? 'badge-dropped' : 'badge-pending'}">${count} stops · ${completedCount} done</span></div>
      ${nextEntry && nextEntry.kind === 'resolved' ? `<div class="route-next">NEXT STOP · <strong>${esc(nextEntry.prospect.restaurant_name)}</strong></div>` : ''}
      ${routeComplete ? '<div class="route-complete" role="status"><img src="/otra-show-over.svg" alt=""><div><strong>SHOW OVER</strong><span>Run complete. Route remains available.</span></div></div>' : ''}
      ${count ? `<div class="route-list">${entries.map((entry, index) => entry.kind === 'missing'
        ? unavailableRouteRow(entry.id, index)
        : `<div class="route-item route-work-item">
            <span class="route-num">${index + 1}.</span>
            <div class="route-info"><div class="route-name">${esc(entry.prospect.restaurant_name)}</div><div class="route-addr">${esc(entry.prospect.address_normalized || entry.prospect.address_input)}</div>${entry.prospect.dropped_off ? '<span class="badge badge-dropped">🌹 Dropped Off</span>' : ''}</div>
            <div class="route-ctrls">
              <button class="btn btn-small btn-secondary route-up" data-idx="${index}" ${index === 0 ? 'disabled' : ''} aria-label="Move ${esc(entry.prospect.restaurant_name)} up">↑</button>
              <button class="btn btn-small btn-secondary route-dn" data-idx="${index}" ${index === count - 1 ? 'disabled' : ''} aria-label="Move ${esc(entry.prospect.restaurant_name)} down">↓</button>
              <button class="btn btn-small btn-status ${entry.prospect.dropped_off ? 'dropped' : 'pending'} route-drop" data-id="${entry.prospect.id}" data-dr="${entry.prospect.dropped_off}">${entry.prospect.dropped_off ? 'Undo' : 'Dropped Off'}</button>
              <button class="btn btn-small btn-danger route-rm" data-id="${entry.prospect.id}" aria-label="Remove ${esc(entry.prospect.restaurant_name)} from route">✕</button>
            </div>
          </div>`).join('')}</div>` : '<div class="empty-state empty-route"><img src="/otra-empty-route.svg" alt=""><strong>Nothing shaking on Shakedown yet.</strong><span class="empty-text">Add stops from the map.</span></div>'}
      ${count ? `<button class="btn btn-primary btn-full btn-send-gmaps" id="btn-send-gmaps">Open ${count} Stop${count === 1 ? '' : 's'} in Google Maps</button><button class="btn btn-secondary btn-full" id="btn-clear-route">Clear Route</button>` : ''}
    </div>`;
  document.getElementById('btn-route-back')?.addEventListener('click', () => navigateScreen('map'));
  document.getElementById('btn-clear-route')?.addEventListener('click', () => { clearRoute(); panelView = 'panel-route'; renderPanel(); });
  document.getElementById('btn-send-gmaps')?.addEventListener('click', handleSendToGoogleMaps);
  p.querySelectorAll('.route-up').forEach(button => button.addEventListener('click', () => moveRouteItem(parseInt(button.getAttribute('data-idx')!), -1)));
  p.querySelectorAll('.route-dn').forEach(button => button.addEventListener('click', () => moveRouteItem(parseInt(button.getAttribute('data-idx')!), 1)));
  p.querySelectorAll('.route-rm').forEach(button => button.addEventListener('click', () => { removeFromRoute(button.getAttribute('data-id')!); renderPanel(); }));
  p.querySelectorAll('.route-drop').forEach(button => button.addEventListener('click', () => { void handleToggleDropped(button.getAttribute('data-id')!, button.getAttribute('data-dr') === 'true'); }));
}

function rList(p: HTMLElement) {
  const nc = prospects.filter(x => x.latitude == null || x.longitude == null).length;
  const routeEntriesList = routeEntries(routeIds, activeProspects);
  const routeCount = routeIds.length;
  const listProspects = getListProspects();
  p.innerHTML = `<div class="panel-header"><h1 class="app-title">ON THE ROAD AGAIN</h1><p class="app-subtitle">${prospects.length} prospect${prospects.length !== 1 ? 's' : ''}</p></div>
    ${errorMessage ? `<div class="error-banner">${esc(errorMessage)}</div>` : ''}
    ${nc > 0 && !loading ? `<div class="info-banner">${nc} prospect${nc !== 1 ? 's' : ''} need${nc === 1 ? 's' : ''} an address update for the map.</div>` : ''}
    <details class="backstage-tools"><summary>Backstage tools <span>database &amp; import</span></summary><div class="panel-actions-row"><button class="btn btn-primary" id="btn-pl-add">+ Add Prospect</button><button class="btn btn-secondary" id="btn-pl-arch">📦 Archived</button><button class="btn btn-secondary" id="btn-pl-import">📋 Import</button></div></details>
    <div class="list-tools" aria-label="Prospect list options"><label class="sr-only" for="list-filter">Filter prospects</label><select class="form-input list-select" id="list-filter"><option value="all" ${listFilter === 'all' ? 'selected' : ''}>All prospects</option><option value="not-dropped" ${listFilter === 'not-dropped' ? 'selected' : ''}>Not dropped off</option><option value="dropped" ${listFilter === 'dropped' ? 'selected' : ''}>Dropped off</option><option value="route" ${listFilter === 'route' ? 'selected' : ''}>In Current Route</option></select><label class="sr-only" for="list-sort">Sort prospects</label><select class="form-input list-select" id="list-sort"><option value="nearby" ${listSort === 'nearby' ? 'selected' : ''}>${currentLocation ? 'Nearest first' : 'A–Z (locate me for nearby)'}</option><option value="name" ${listSort === 'name' ? 'selected' : ''}>A–Z</option></select></div>
    ${routeCount ? `<div class="card route-tray">
      <div class="card-title"><span>⚡ Current Route</span><span class="badge badge-pending">${routeCount}</span></div>
      <div class="route-hint">Your complete OTRA setlist. Arrange stops here before opening a navigation leg.</div>
      <div class="route-list">${routeEntriesList.map((entry, index) => entry.kind === 'missing'
        ? unavailableRouteRow(entry.id, index)
        : `<div class="route-item">
            <span class="route-num">${index + 1}.</span>
            <div class="route-info"><div class="route-name">${esc(entry.prospect.restaurant_name)}</div><div class="route-addr">${esc(entry.prospect.address_normalized || entry.prospect.address_input)}</div></div>
            <div class="route-ctrls">
              <button class="btn btn-small btn-secondary route-up" data-idx="${index}" ${index === 0 ? 'disabled' : ''} aria-label="Move ${esc(entry.prospect.restaurant_name)} up">↑</button>
              <button class="btn btn-small btn-secondary route-dn" data-idx="${index}" ${index === routeCount - 1 ? 'disabled' : ''} aria-label="Move ${esc(entry.prospect.restaurant_name)} down">↓</button>
              <button class="btn btn-small btn-danger route-rm" data-id="${entry.prospect.id}" aria-label="Remove ${esc(entry.prospect.restaurant_name)} from route">✕</button>
            </div>
          </div>`).join('')}</div>
      <button class="btn btn-secondary btn-full" id="btn-clear-route">Clear Route</button>
      <button class="btn btn-primary btn-full btn-send-gmaps" id="btn-send-gmaps">🗺️ Send ${routeCount} Stop${routeCount !== 1 ? 's' : ''} to Google Maps</button>
    </div>` : ''}
    <div class="prospect-list">${loading ? '<div class="empty-state"><span class="empty-icon">⚡</span><span class="empty-text">One way or another, this darkness has got to give...</span></div>' : !listProspects.length ? `<div class="empty-state"><span class="empty-text">${searchQuery ? 'No matches with those list options.' : 'Nothing matches those list options yet.'}</span></div>` : listProspects.map(x => `<div class="prospect-item" data-id="${x.id}"><div class="prospect-info"><div class="prospect-name">${isInRoute(x.id) ? '<span class="route-badge-sm">⚡</span> ' : ''}${esc(x.restaurant_name)}</div><div class="prospect-address">${esc(x.address_normalized || x.address_input)}</div></div><div class="prospect-actions-row">${x.dropped_off ? '<span class="badge badge-dropped">🌹 Dropped</span>' : ''}<button class="btn btn-small btn-secondary pl-view" data-id="${x.id}">View</button><button class="btn btn-small btn-status ${x.dropped_off ? 'dropped' : 'pending'} pl-toggle" data-id="${x.id}" data-dr="${x.dropped_off}">${x.dropped_off ? '🌹' : 'Drop'}</button></div></div>`).join('')}</div>`;
  document.getElementById('btn-pl-add')?.addEventListener('click', () => { resetAdd(); panelView = 'panel-add'; renderPanel(); });
  document.getElementById('btn-pl-arch')?.addEventListener('click', () => { void showArchived(); });
  document.getElementById('btn-pl-import')?.addEventListener('click', () => { resetImport(); panelView = 'panel-import'; renderPanel(); });
  document.getElementById('list-filter')?.addEventListener('change', event => { listFilter = (event.target as HTMLSelectElement).value as ListFilter; renderPanel(); });
  document.getElementById('list-sort')?.addEventListener('change', event => { listSort = (event.target as HTMLSelectElement).value as ListSort; renderPanel(); });
  document.getElementById('btn-clear-route')?.addEventListener('click', clearRoute);
  document.getElementById('btn-send-gmaps')?.addEventListener('click', handleSendToGoogleMaps);
  p.querySelectorAll('.route-up').forEach(b => b.addEventListener('click', () => moveRouteItem(parseInt(b.getAttribute('data-idx')!), -1)));
  p.querySelectorAll('.route-dn').forEach(b => b.addEventListener('click', () => moveRouteItem(parseInt(b.getAttribute('data-idx')!), 1)));
  p.querySelectorAll('.route-rm').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); removeFromRoute(b.getAttribute('data-id')!); renderPanel(); }));
  p.querySelectorAll('.prospect-item').forEach(el => el.addEventListener('click', () => { const id = el.getAttribute('data-id'); if (id) { selectedProspectId = id; panelView = 'panel-detail'; renderPanel(); } }));
  p.querySelectorAll('.pl-view').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); const id = b.getAttribute('data-id'); if (id) { selectedProspectId = id; panelView = 'panel-detail'; renderPanel(); } }));
  p.querySelectorAll('.pl-toggle').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); handleToggleDropped(b.getAttribute('data-id')!, b.getAttribute('data-dr') === 'true'); }));
  updateSearchBar();
}

function getListProspects(): Prospect[] {
  return sortProspects(
    filterProspects(prospects, listFilter, routeIds),
    listSort,
    currentLocation,
  );
}

function rAdd(p: HTMLElement) {
  if (addStep === 'duplicate') { rAddDup(p); return; }
  if (addStep === 'confirm') { rAddConf(p); return; }
  p.innerHTML = `<div class="panel-header"><button class="btn btn-back" id="btn-cx-add">← Back</button><h1 class="app-title" style="font-size:1.15rem;">Add Prospect</h1></div>
    ${errorMessage ? `<div class="error-banner">${esc(errorMessage)}</div>` : ''}
    <div class="card"><form id="add-form"><div class="form-group"><label class="form-label" for="rname">Restaurant / Business Name</label><input type="text" id="rname" class="form-input" placeholder="e.g. Lupie's Cafe" required maxlength="200" value="${esc(addName)}" ${submitting ? 'disabled' : ''}></div>
    <div class="form-group" id="ac-wrap"><label class="form-label" for="addr">Address</label><input type="text" id="addr" class="form-input" placeholder="Start typing..." required maxlength="500" value="${esc(addAddress)}" autocomplete="off" ${submitting ? 'disabled' : ''}><div class="form-hint">Select a suggestion or type a full address.</div></div>
    <button type="submit" class="btn btn-primary" style="width:100%;" ${submitting ? 'disabled' : ''}>${submitting ? 'Searching...' : 'Continue'}</button></form></div>`;
  document.getElementById('btn-cx-add')?.addEventListener('click', () => { resetAdd(); panelView = 'panel-list'; renderPanel(); });
  document.getElementById('add-form')?.addEventListener('submit', e => handleAddSubmit(e as SubmitEvent));
  const ai = document.getElementById('addr') as HTMLInputElement, aw = document.getElementById('ac-wrap')!;
  function reb() { updateAcDropdown(aw, acSug, acVis, selAddSug); }
  ai?.addEventListener('input', () => { addAddressSelected = false; addAddress = ai.value; triggerAc(ai.value, s => { acSug = s; }, v => { acVis = v; }, acAbort, a => { acAbort = a; }, acTimer, t => { acTimer = t; }, reb); });
  if (acVis) reb();
}

function rAddConf(p: HTMLElement) {
  p.innerHTML = `<div class="panel-header"><button class="btn btn-back" id="btn-bk-ac">← Back</button><h1 class="app-title" style="font-size:1.15rem;">Confirm Prospect</h1></div>
    ${errorMessage ? `<div class="error-banner">${esc(errorMessage)}</div>` : ''}
    <div class="card"><div class="confirm-detail"><h2 class="confirm-name">${esc(addName)}</h2><p class="confirm-address">${esc(addNormalized || addAddress)}</p>${addLat !== null ? `<p class="confirm-coords">📍 ${addLat!.toFixed(5)}, ${addLon!.toFixed(5)}</p>` : ''}</div>
    <div class="btn-row"><button class="btn btn-secondary" id="btn-cx-ac" style="flex:1;">Cancel</button><button class="btn btn-primary" id="btn-cf-ac" style="flex:1;" ${submitting ? 'disabled' : ''}>${submitting ? 'Saving...' : 'Save Prospect'}</button></div></div>`;
  document.getElementById('btn-bk-ac')?.addEventListener('click', () => { addStep = 'entry'; renderPanel(); });
  document.getElementById('btn-cx-ac')?.addEventListener('click', () => { resetAdd(); panelView = 'panel-list'; renderPanel(); });
  document.getElementById('btn-cf-ac')?.addEventListener('click', confirmAdd);
}

function rAddDup(p: HTMLElement) {
  p.innerHTML = `<div class="panel-header"><h1 class="app-title" style="font-size:1.15rem;">Possible Duplicate</h1></div>
    <div class="card"><div class="warning-banner">This prospect may already exist.</div>
    ${addDuplicates.map(d => `<div class="duplicate-card"><div class="prospect-name">${esc(d.restaurant_name)}</div><div class="prospect-address">${esc(d.address_normalized || d.address_input)}</div><button class="btn btn-secondary btn-small ad-open" data-id="${d.id}">Open Existing</button></div>`).join('')}
    <div class="btn-row"><button class="btn btn-secondary" id="btn-cx-dup" style="flex:1;">Cancel</button><button class="btn btn-primary" id="btn-sv-dup" style="flex:1;" ${submitting ? 'disabled' : ''}>${submitting ? 'Saving...' : 'Save Anyway'}</button></div></div>`;
  document.getElementById('btn-cx-dup')?.addEventListener('click', () => { resetAdd(); panelView = 'panel-list'; renderPanel(); });
  document.getElementById('btn-sv-dup')?.addEventListener('click', confirmAddDup);
  p.querySelectorAll('.ad-open').forEach(b => b.addEventListener('click', () => { const id = b.getAttribute('data-id'); if (id) { selectedProspectId = id; resetAdd(); panelView = 'panel-detail'; renderPanel(); } }));
}

function rDetail(p: HTMLElement) {
  const x = getById(selectedProspectId || ''); if (!x) { panelView = 'panel-list'; renderPanel(); return; }
  const a = x.address_normalized || x.address_input;
  p.innerHTML = `<div class="panel-header"><button class="btn btn-back" id="btn-bk-dt">← Back</button><h1 class="app-title" style="font-size:1.15rem;">${esc(x.restaurant_name)}</h1></div>
    ${errorMessage ? `<div class="error-banner">${esc(errorMessage)}</div>` : ''}
    <div class="card"><div class="detail-section"><div class="detail-label">Address</div><div class="detail-value">${esc(a)}</div>${x.address_input !== x.address_normalized && x.address_normalized ? `<div class="detail-muted">Original: ${esc(x.address_input)}</div>` : ''}</div>
    ${x.latitude !== null ? `<div class="detail-section"><div class="detail-label">Coordinates</div><div class="detail-value detail-coords">📍 ${x.latitude.toFixed(5)}, ${x.longitude!.toFixed(5)}</div></div>` : ''}
    <div class="detail-section"><div class="detail-label">Status</div><div class="detail-value">${x.dropped_off ? `<span class="badge badge-dropped">🌹 Dropped Off</span><div class="detail-muted">${x.dropped_off_at ? new Date(x.dropped_off_at).toLocaleString() : ''}</div>` : '<span class="badge badge-pending">Still on the road</span>'}</div></div>
    ${x.archived ? '<div class="detail-section"><div class="detail-label"></div><div class="detail-value"><span class="badge badge-archived">Archived</span></div></div>' : ''}
    <div class="detail-section"><div class="detail-label">Created</div><div class="detail-value detail-muted">${new Date(x.created_at).toLocaleString()}</div></div></div>
    <div class="card"><div class="detail-actions">
    <button class="btn btn-secondary btn-full" id="btn-dt-fly">📍 Show on Map</button>
    ${!x.archived ? `<button class="btn ${isInRoute(x.id) ? 'btn-danger' : 'btn-primary'} btn-full" id="btn-dt-route">${isInRoute(x.id) ? 'Remove from Route' : '⚡ Add to Route'}</button><button class="btn btn-status ${x.dropped_off ? 'dropped' : 'pending'} btn-full" id="btn-dt-tog">${x.dropped_off ? '🌹 Dropped Off — Undo' : '🌹 Mark Dropped Off'}</button><button class="btn btn-secondary btn-full" id="btn-dt-ed">✏️ Edit</button><button class="btn btn-secondary btn-full" id="btn-dt-arch">📦 Archive</button>` : '<button class="btn btn-primary btn-full" id="btn-dt-rest">↩️ Restore</button>'}
    <button class="btn btn-danger btn-full" id="btn-dt-del">🗑️ Delete Permanently</button></div></div>`;
  document.getElementById('btn-bk-dt')?.addEventListener('click', () => { selectedProspectId = null; panelView = 'panel-list'; renderPanel(); });
  document.getElementById('btn-dt-fly')?.addEventListener('click', () => flyTo(x));
  document.getElementById('btn-dt-route')?.addEventListener('click', () => { toggleRouteSelection(x.id); renderPanel(); });
  document.getElementById('btn-dt-tog')?.addEventListener('click', () => handleToggleDropped(x.id, x.dropped_off));
  document.getElementById('btn-dt-ed')?.addEventListener('click', () => startEdit(x));
  document.getElementById('btn-dt-arch')?.addEventListener('click', () => handleArchive(x.id));
  document.getElementById('btn-dt-rest')?.addEventListener('click', () => handleRestore(x.id));
  document.getElementById('btn-dt-del')?.addEventListener('click', () => handleDelete(x.id));
}

function rEdit(p: HTMLElement) {
  const x = getById(selectedProspectId || ''); if (!x) { panelView = 'panel-list'; renderPanel(); return; }
  if (edStep === 'duplicate') { rEditDup(p); return; }
  if (edStep === 'confirm') { rEditConf(p); return; }
  p.innerHTML = `<div class="panel-header"><button class="btn btn-back" id="btn-cx-ed">← Cancel</button><h1 class="app-title" style="font-size:1.15rem;">Edit Prospect</h1></div>
    ${errorMessage ? `<div class="error-banner">${esc(errorMessage)}</div>` : ''}
    <div class="card"><form id="ed-form"><div class="form-group"><label class="form-label" for="edname">Restaurant / Business Name</label><input type="text" id="edname" class="form-input" value="${esc(edName)}" required maxlength="200" ${submitting ? 'disabled' : ''}></div>
    <div class="form-group" id="ed-ac-wrap"><label class="form-label" for="edaddr">Address</label><input type="text" id="edaddr" class="form-input" value="${esc(edAddr)}" required maxlength="500" autocomplete="off" ${submitting ? 'disabled' : ''}></div>
    <button type="submit" class="btn btn-primary" style="width:100%;" ${submitting ? 'disabled' : ''}>${submitting ? 'Checking...' : 'Save Changes'}</button></form></div>`;
  document.getElementById('btn-cx-ed')?.addEventListener('click', () => { panelView = 'panel-detail'; renderPanel(); });
  document.getElementById('ed-form')?.addEventListener('submit', e => handleEditSubmit(e as SubmitEvent));
  const ai = document.getElementById('edaddr') as HTMLInputElement, aw = document.getElementById('ed-ac-wrap')!;
  function reb() { updateAcDropdown(aw, edAcSug, edAcVis, selEdSug); }
  ai?.addEventListener('input', () => { edAddr = ai.value; triggerAc(ai.value, s => { edAcSug = s; }, v => { edAcVis = v; }, edAcAbort, a => { edAcAbort = a; }, edAcTimer, t => { edAcTimer = t; }, reb); });
  if (edAcVis) reb();
}

function rEditConf(p: HTMLElement) {
  p.innerHTML = `<div class="panel-header"><button class="btn btn-back" id="btn-bk-ec">← Back</button><h1 class="app-title" style="font-size:1.15rem;">Confirm Changes</h1></div>
    <div class="card"><div class="confirm-detail"><h2 class="confirm-name">${esc(edName)}</h2><p class="confirm-address">${esc(edNorm || edAddr)}</p>${edLat !== null ? `<p class="confirm-coords">📍 ${edLat!.toFixed(5)}, ${edLon!.toFixed(5)}</p>` : ''}</div>
    <div class="btn-row"><button class="btn btn-secondary" id="btn-cx-ec" style="flex:1;">Cancel</button><button class="btn btn-primary" id="btn-cf-ec" style="flex:1;" ${submitting ? 'disabled' : ''}>${submitting ? 'Saving...' : 'Save Changes'}</button></div></div>`;
  document.getElementById('btn-bk-ec')?.addEventListener('click', () => { edStep = 'entry'; renderPanel(); });
  document.getElementById('btn-cx-ec')?.addEventListener('click', () => { panelView = 'panel-detail'; renderPanel(); });
  document.getElementById('btn-cf-ec')?.addEventListener('click', confirmEdit);
}

function rEditDup(p: HTMLElement) {
  p.innerHTML = `<div class="panel-header"><h1 class="app-title" style="font-size:1.15rem;">Possible Duplicate</h1></div>
    <div class="card"><div class="warning-banner">This change appears to create a duplicate.</div>
    ${edDups.map(d => `<div class="duplicate-card"><div class="prospect-name">${esc(d.restaurant_name)}</div><div class="prospect-address">${esc(d.address_normalized || d.address_input)}</div></div>`).join('')}
    <div class="btn-row"><button class="btn btn-secondary" id="btn-cx-edd" style="flex:1;">Cancel</button><button class="btn btn-primary" id="btn-sv-edd" style="flex:1;" ${submitting ? 'disabled' : ''}>${submitting ? 'Saving...' : 'Save Anyway'}</button></div></div>`;
  document.getElementById('btn-cx-edd')?.addEventListener('click', () => { panelView = 'panel-detail'; renderPanel(); });
  document.getElementById('btn-sv-edd')?.addEventListener('click', confirmEditDup);
}

function rArch(p: HTMLElement) {
  const ar = archivedProspects;
  p.innerHTML = `<div class="panel-header"><button class="btn btn-back" id="btn-bk-ar">← Back</button><h1 class="app-title" style="font-size:1.15rem;">Archived</h1></div>
    <div class="card archive-card"><div class="card-title"><span>Archive Vault</span><span class="badge badge-pending">${archivedLoading ? 'Loading...' : `${ar.length} archived`}</span></div>
    ${archivedLoading ? '<div class="empty-state">Loading archived prospects...</div>' : !ar.length ? '<div class="empty-state"><span class="empty-text">The archive vault is empty.</span></div>' : `<div class="prospect-list">${ar.map(x => `<div class="prospect-item" data-id="${x.id}"><div class="prospect-info"><div class="prospect-name">${esc(x.restaurant_name)}</div><div class="prospect-address">${esc(x.address_normalized || x.address_input)}</div></div><div class="prospect-actions-row"><button class="btn btn-small btn-primary ar-rest" data-id="${x.id}">Restore</button></div></div>`).join('')}</div>`}</div>`;
  document.getElementById('btn-bk-ar')?.addEventListener('click', () => { panelView = 'panel-list'; renderPanel(); });
  p.querySelectorAll('.ar-rest').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); handleRestore(b.getAttribute('data-id')!); }));
}

// ─── Render: Import ─────────────────────────────────────
function rImport(p: HTMLElement) {
  // Paste phase
  if (importPhase === 'paste') {
    p.innerHTML = `<div class="panel-header"><button class="btn btn-back" id="btn-cx-imp">← Back</button><h1 class="app-title" style="font-size:1.15rem;">Bulk Import</h1></div>
      <div class="card">
        <p class="form-hint" style="margin-bottom:0.5rem;">Paste restaurant name and address pairs, one per line. Use <code>|</code>, comma, or tab as separator.</p>
        <textarea id="import-textarea" class="form-input" style="min-height:180px;font-size:0.85rem;resize:vertical;" placeholder="Alexander Michael's | 401 W 9th St, Charlotte, NC 28202&#10;Lupie's Cafe | 2718 Monroe Rd, Charlotte, NC 28205&#10;The Garrison | 314 Main St, Pineville, NC 28134">${esc(importText)}</textarea>
        <div class="btn-row">
          <button class="btn btn-secondary" id="btn-cancel-imp" style="flex:1;">Cancel</button>
          <button class="btn btn-primary" id="btn-parse-imp" style="flex:1;">Parse & Preview</button>
        </div>
      </div>`;
    document.getElementById('btn-cx-imp')?.addEventListener('click', () => { panelView = 'panel-list'; renderPanel(); });
    document.getElementById('btn-cancel-imp')?.addEventListener('click', () => { panelView = 'panel-list'; renderPanel(); });
    document.getElementById('btn-parse-imp')?.addEventListener('click', () => {
      importText = (document.getElementById('import-textarea') as HTMLTextAreaElement).value;
      importRows = parseImportText(importText);
      if (!importRows.length) { errorMessage = 'No valid rows found. Use format: Name | Address'; renderPanel(); return; }
      errorMessage = null; importPhase = 'preview'; renderPanel();
    });
    return;
  }

  // Preview phase
  if (importPhase === 'preview') {
    p.innerHTML = `<div class="panel-header"><button class="btn btn-back" id="btn-bk-imp-prev">← Edit</button><h1 class="app-title" style="font-size:1.15rem;">Preview (${importRows.length} rows)</h1></div>
      <div class="card">
        <div class="import-preview">${importRows.map((r, i) => `<div class="import-row"><span class="route-num">${i + 1}.</span><div><div class="route-name">${esc(r.name)}</div><div class="route-addr">${esc(r.address)}</div></div></div>`).join('')}</div>
        <div class="btn-row">
          <button class="btn btn-secondary" id="btn-imp-back" style="flex:1;">Edit</button>
          <button class="btn btn-primary" id="btn-imp-geocode" style="flex:1;">Geocode ${importRows.length} Address${importRows.length !== 1 ? 'es' : ''}</button>
        </div>
      </div>`;
    document.getElementById('btn-bk-imp-prev')?.addEventListener('click', () => { importPhase = 'paste'; renderPanel(); });
    document.getElementById('btn-imp-back')?.addEventListener('click', () => { importPhase = 'paste'; renderPanel(); });
    document.getElementById('btn-imp-geocode')?.addEventListener('click', () => runImportGeocodeBatch());
    return;
  }

  // Geocoding phase
  if (importPhase === 'geocoding') {
    const done = importRows.filter(r => r.status !== 'pending' && r.status !== 'geocoding').length;
    const geo = importRows.filter(r => r.status === 'geocoding').length;
    p.innerHTML = `<div class="panel-header"><h1 class="app-title" style="font-size:1.15rem;">Geocoding...</h1></div>
      <div class="card">
        <div class="empty-state">${done} / ${importRows.length} processed${geo > 0 ? ` (${geo} in progress...)` : ''}</div>
        <div class="progress-bar"><div class="progress-fill" style="width:${importRows.length ? Math.round(done / importRows.length * 100) : 0}%"></div></div>
      </div>`;
    return;
  }

  // Results phase
  const ready = importRows.filter(r => r.status === 'ready').length;
  const dupes = importRows.filter(r => r.status === 'duplicate').length;
  const review = importRows.filter(r => r.status === 'needs_review').length;
  const errors = importRows.filter(r => r.status === 'error').length;
  const imported = importRows.filter(r => r.status === 'imported').length;

  p.innerHTML = `<div class="panel-header"><button class="btn btn-back" id="btn-cx-imp-res">← Back</button><h1 class="app-title" style="font-size:1.15rem;">Import Results</h1></div>
    ${imported > 0 ? `<div class="info-banner">✅ ${imported} imported successfully!</div>` : ''}
    <div class="card">
      <div class="import-summary">
        <div>✅ <b>${ready}</b> ready to import</div>
        ${dupes > 0 ? `<div>⚠️ <b>${dupes}</b> duplicates</div>` : ''}
        ${review > 0 ? `<div>🔍 <b>${review}</b> need review</div>` : ''}
        ${errors > 0 ? `<div>❌ <b>${errors}</b> failed</div>` : ''}
      </div>
      <div class="import-row-list">${importRows.map((r, i) => {
        let badge = '';
        if (r.status === 'ready') badge = '<span class="badge badge-pending">Ready</span>';
        else if (r.status === 'imported') badge = '<span class="badge badge-dropped">✓</span>';
        else if (r.status === 'duplicate') badge = '<span class="badge badge-pending">Duplicate</span>';
        else if (r.status === 'needs_review') badge = '<span class="badge badge-pending">Review</span>';
        else if (r.status === 'error') badge = '<span class="badge badge-archived">Error</span>';
        const addr = r.normalized || r.address;
        return `<div class="import-row"><span class="route-num">${i + 1}.</span><div style="flex:1;min-width:0;"><div class="route-name">${esc(r.name)} ${badge}</div><div class="route-addr">${esc(addr)}</div>${r.errorMsg ? `<div class="detail-muted" style="color:#fca5a5;">${esc(r.errorMsg)}</div>` : ''}</div></div>`;
      }).join('')}</div>
      <div class="btn-row">
        <button class="btn btn-secondary" id="btn-imp-done" style="flex:1;">Done</button>
        ${ready > 0 ? `<button class="btn btn-primary" id="btn-imp-save" style="flex:1;" ${importRunning ? 'disabled' : ''}>${importRunning ? 'Saving...' : `Save ${ready} Prospect${ready !== 1 ? 's' : ''}`}</button>` : ''}
      </div>
    </div>`;
  document.getElementById('btn-cx-imp-res')?.addEventListener('click', () => { panelView = 'panel-list'; renderPanel(); });
  document.getElementById('btn-imp-done')?.addEventListener('click', () => { panelView = 'panel-list'; renderPanel(); });
  document.getElementById('btn-imp-save')?.addEventListener('click', saveImportRows);
}

function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }

// ─── Bootstrap ─────────────────────────────────────────
async function bootstrap() {
  try {
    const session = await getAccessSession();
    if (!session.authenticated) return renderAccessGate();
    fieldState = await loadFieldState();
    setupShell();
    routeIds = fieldState.routeIds.length ? fieldState.routeIds : loadRoute();
    selectedProspectId = fieldState.selectedProspectId;
    searchQuery = fieldState.filters.searchQuery;
    listFilter = fieldState.filters.listFilter as ListFilter;
    listSort = fieldState.filters.listSort as ListSort;
    void loadData();
    void getInstalledAppInfo().then(info => { installedAppInfo = info; renderUpdateBanner(); });
    void checkForUpdates();
  } catch (error: unknown) {
    renderAccessGate(error instanceof Error ? error.message : 'Private access is unavailable.');
  }
}

function renderAccessGate(message = '') {
  const app = document.getElementById('app')!;
  app.innerHTML = `<main class="access-gate"><section class="access-card" aria-labelledby="access-title"><div class="credential-top"><img src="/otra-darkstar-compass.svg" alt=""><div><p class="access-kicker">DARK STAR CONSULTING</p><p class="access-dept">FIELD OPERATIONS</p></div></div><div class="credential-rule"></div><p class="access-pass">BACKSTAGE / FIELD ACCESS</p><h1 id="access-title">ON THE ROAD AGAIN</h1><p class="access-note">Private restaurant prospecting tool</p>${message ? `<div class="error-banner" role="alert">${esc(message)}</div>` : ''}<form id="access-form"><label class="form-label" for="access-code">Access code</label><input class="form-input" id="access-code" type="password" autocomplete="current-password" required autofocus><button class="btn btn-primary btn-full" type="submit">Open Field Tool</button></form><div class="credential-footer"><span>OTRA • ROAD CREW</span><span>AUTHORIZED FIELD USE</span></div></section></main>`;
  document.getElementById('access-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const input = document.getElementById('access-code') as HTMLInputElement;
    const button = (event.currentTarget as HTMLFormElement).querySelector('button') as HTMLButtonElement;
    button.disabled = true; button.textContent = 'Opening...';
    try {
      const session = await signIn(input.value);
      if (!session.authenticated) throw new Error('Private access was not granted.');
      fieldState = await loadFieldState();
      setupShell();
      routeIds = fieldState.routeIds.length ? fieldState.routeIds : loadRoute();
      void loadData();
      void getInstalledAppInfo().then(info => { installedAppInfo = info; renderUpdateBanner(); });
      void checkForUpdates();
    } catch (error: unknown) {
      renderAccessGate(error instanceof Error ? error.message : 'Private access was not granted.');
    }
  });
}

window.addEventListener('online', () => { void flushOfflineOperations(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    persistFieldContext();
    void flushOfflineOperations();
    void loadData();
    void checkForUpdates();
  }
});
void bootstrap();
