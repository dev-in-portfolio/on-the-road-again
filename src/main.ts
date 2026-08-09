import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  fetchProspects, createProspect, updateProspect,
  toggleDroppedOff, archiveProspect, restoreProspect, deleteProspect,
  geocodeAutocomplete, geocodeSearch,
} from './api/client';
import { Prospect, AutocompleteSuggestion, CreateProspectInput } from './types/prospect';

// ─── Constants ─────────────────────────────────────────
const DEFAULT_CENTER: [number, number] = [-95.7129, 37.0902];
const DEFAULT_ZOOM = 3.5;
const SINGLE_ZOOM = 15;

// ─── State ─────────────────────────────────────────────
let prospects: Prospect[] = [];
let loading = true;
let errorMessage: string | null = null;
let submitting = false;

type View = 'panel-list' | 'panel-add' | 'panel-detail' | 'panel-edit' | 'panel-archived' | 'panel-import';
let panelView: View = 'panel-list';
let selectedProspectId: string | null = null;
let searchQuery = '';

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
type ImportRow = { name: string; address: string; status: 'pending' | 'geocoding' | 'ready' | 'duplicate' | 'needs_review' | 'error' | 'imported'; normalized?: string; lat?: number; lon?: number; placeId?: string; errorMsg?: string; duplicates?: Prospect[]; };
let importRows: ImportRow[] = [];
let importPhase: 'paste' | 'preview' | 'geocoding' | 'results' = 'paste';
let importText = '';
let importRunning = false;
const IMPORT_CONCURRENCY = 3;

function parseImportText(text: string): ImportRow[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const rows: ImportRow[] = [];
  let headerSkipped = false;
  for (const line of lines) {
    // Try common delimiters: | , tab
    let parts: string[] | null = null;
    if (line.includes('|')) parts = line.split('|');
    else if (line.includes('\t')) parts = line.split('\t');
    else if (line.includes(',')) {
      // Only use comma if | and tab not found, and there are exactly 2+ parts
      const csvParts = line.split(',');
      if (csvParts.length >= 2) parts = csvParts;
    }
    if (!parts || parts.length < 2) continue;

    const name = parts[0].trim();
    const address = parts.slice(1).join(' ').trim().replace(/\s+/g, ' ');
    if (!name || !address) continue;

    // Skip header row
    if (!headerSkipped && rows.length === 0 &&
        /^(restaurant|business|name|商户|店名)/i.test(name) &&
        /^(address|addr|地址|street)/i.test(address)) {
      headerSkipped = true;
      continue;
    }
    headerSkipped = true;

    rows.push({ name, address, status: 'pending' });
  }
  return rows;
}

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
        prospects.unshift(result as Prospect);
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
const ROUTE_KEY = 'otra.currentRoute';
const MAX_ROUTE = 10;
let routeIds: string[] = [];

function loadRoute(): string[] {
  try { const raw = localStorage.getItem(ROUTE_KEY); return raw ? JSON.parse(raw) as string[] : []; }
  catch { return []; }
}
function saveRoute() { try { localStorage.setItem(ROUTE_KEY, JSON.stringify(routeIds)); } catch { /* storage unavailable */ } }
function getRouteIndex(id: string): number { return routeIds.indexOf(id); }
function isInRoute(id: string): boolean { return routeIds.indexOf(id) >= 0; }

function reconcileRoute() {
  // Remove stale IDs: prospects that are no longer active (archived, deleted, or missing coords)
  const activeIds = new Set(prospects.filter(p => p.latitude != null && p.longitude != null).map(p => p.id));
  const cleaned = routeIds.filter(id => activeIds.has(id));
  if (cleaned.length !== routeIds.length) { routeIds = cleaned; saveRoute(); }
}

function addToRoute(id: string): string | null {
  if (isInRoute(id)) return null;
  if (routeIds.length >= MAX_ROUTE) return `Route is full — maximum ${MAX_ROUTE} stops.`;
  routeIds.push(id);
  saveRoute();
  refreshMarkers();
  return null;
}
function removeFromRoute(id: string) {
  routeIds = routeIds.filter(rid => rid !== id);
  saveRoute();
  refreshMarkers();
}
function moveRouteItem(idx: number, dir: -1 | 1) {
  const nxt = idx + dir; if (nxt < 0 || nxt >= routeIds.length) return;
  [routeIds[idx], routeIds[nxt]] = [routeIds[nxt], routeIds[idx]];
  saveRoute();
  refreshMarkers();
}
function clearRoute() {
  if (!routeIds.length) return;
  if (!confirm(`Clear all ${routeIds.length} selected stops?`)) return;
  routeIds = [];
  saveRoute();
  refreshMarkers();
}

// ─── Google Maps Handoff ───────────────────────────────

function buildGoogleMapsUrl(): string | { error: string } {
  const items = routeIds.map(id => getById(id)).filter(Boolean) as Prospect[];
  if (items.length === 0) return { error: 'No stops selected.' };

  // Validate all stops have coordinates
  const invalid = items.filter(p => p.latitude == null || p.longitude == null);
  if (invalid.length > 0) {
    return { error: `${invalid[0].restaurant_name} needs a valid mapped address before this route can be sent.` };
  }

  // Separate waypoints and destination
  const dest = items[items.length - 1];
  const waypoints = items.slice(0, -1);

  // Build URL with coordinates
  const wpStr = waypoints.map(p => `${p.latitude},${p.longitude}`).join('|');
  let url = `https://www.google.com/maps/dir/?api=1&travelmode=driving`;
  if (wpStr) url += `&waypoints=${encodeURIComponent(wpStr)}`;
  url += `&destination=${encodeURIComponent(`${dest.latitude},${dest.longitude}`)}`;

  // URL length check (safe limit for browsers ~2000 chars; coords should keep us well under)
  if (url.length > 2000) return { error: 'Route URL is too long. This is unexpected with coordinate-based stops.' };

  return url;
}

function handleSendToGoogleMaps() {
  const result = buildGoogleMapsUrl();
  if (typeof result === 'object' && 'error' in result) {
    errorMessage = result.error;
    renderPanel();
    return;
  }
  // Open in new tab/window — on mobile this typically opens Google Maps app
  window.open(result as string, '_blank', 'noopener');
}

// ─── Map ───────────────────────────────────────────────
let map: maplibregl.Map | null = null;
let markers: Map<string, maplibregl.Marker> = new Map();
let mapPopup: maplibregl.Popup | null = null;
let mapReady = false;
let initialMapFitApplied = false;
let mapResizeObserver: ResizeObserver | null = null;

function createMap() {
  if (map) return;
  map = new maplibregl.Map({
    container: 'map-container',
    style: {
      version: 8,
      sources: { 'osm': { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '&copy; OpenStreetMap' } },
      layers: [{ id: 'osm-layer', type: 'raster', source: 'osm' }],
    },
    center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, attributionControl: false,
  });
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
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
  map.on('moveend', refreshMarkers);
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
  const b = new maplibregl.LngLatBounds();
  for (const p of v) b.extend([p.longitude!, p.latitude!]);
  map.fitBounds(b, { padding, maxZoom: 14 });
}

function markerHTML(p: Prospect): string {
  const ri = getRouteIndex(p.id);
  const numBadge = ri >= 0 ? `<text x="15" y="19" text-anchor="middle" fill="white" font-size="13" font-weight="bold">${ri + 1}</text>` : '';
  if (p.dropped_off) {
    return `<svg width="30" height="40" viewBox="0 0 30 40"><path d="M15 1C7.3 1 1 7.3 1 15c0 10 14 24 14 24s14-14 14-24C29 7.3 22.7 1 15 1z" fill="#10b981" stroke="#047857" stroke-width="1.5"/>${numBadge || '<text x="15" y="19" text-anchor="middle" fill="white" font-size="14" font-weight="bold">✓</text>'}</svg>`;
  }
  return `<svg width="30" height="40" viewBox="0 0 30 40"><path d="M15 1C7.3 1 1 7.3 1 15c0 10 14 24 14 24s14-14 14-24C29 7.3 22.7 1 15 1z" fill="${ri >= 0 ? '#f59e0b' : '#2563eb'}" stroke="${ri >= 0 ? '#b45309' : '#1e40af'}" stroke-width="1.5"/>${numBadge || '<circle cx="15" cy="13" r="6" fill="white"/>'}</svg>`;
}

function markerAria(p: Prospect): string {
  const ri = getRouteIndex(p.id);
  const parts = [p.restaurant_name];
  if (ri >= 0) parts.unshift(`Stop ${ri + 1} —`);
  if (p.dropped_off) parts.push('— Dropped Off');
  return parts.join(' ');
}

function refreshMarkers() {
  if (!map) return;
  const ids = new Set(prospects.map(p => p.id));
  for (const [id, m] of markers) { if (!ids.has(id)) { m.remove(); markers.delete(id); } }
  for (const p of prospects) {
    if (p.latitude == null || p.longitude == null) continue;
    const ex = markers.get(p.id);
    const rCls = getRouteIndex(p.id) >= 0 ? ' marker-routed' : '';
    if (ex) {
      const el = ex.getElement();
      el.className = `map-marker ${p.dropped_off ? 'marker-dropped' : 'marker-active'}${rCls}`;
      el.setAttribute('aria-label', markerAria(p));
      el.innerHTML = markerHTML(p);
      ex.setLngLat([p.longitude, p.latitude]);
    } else {
      const el = document.createElement('div');
      el.className = `map-marker ${p.dropped_off ? 'marker-dropped' : 'marker-active'}${rCls}`;
      el.setAttribute('aria-label', markerAria(p));
      el.innerHTML = markerHTML(p);
      el.style.cursor = 'pointer';
      const mk = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([p.longitude, p.latitude]).addTo(map!);
      el.addEventListener('click', () => openPopup(p, mk));
      markers.set(p.id, mk);
    }
  }
  // NOTE: fitMap() intentionally NOT called here (ISSUE 3 fix).
  // Call fitMap() explicitly only on initial load or explicit user action.
}

function openPopup(p: Prospect, mk: maplibregl.Marker) {
  if (!map) return;
  if (mapPopup) mapPopup.remove();
  const a = p.address_normalized || p.address_input;
  const inRt = isInRoute(p.id);
  const ri = getRouteIndex(p.id);
  const html = `<div class="map-popup">
    <div class="popup-name">${ri >= 0 ? `<span class="route-badge-sm">${ri + 1}</span> ` : ''}${esc(p.restaurant_name)}</div>
    <div class="popup-addr">${esc(a)}</div>
    <div class="${p.dropped_off ? 'popup-dropped' : 'popup-pending'}">${p.dropped_off ? '✓ Dropped Off ' + (p.dropped_off_at ? new Date(p.dropped_off_at).toLocaleDateString() : '') : 'Not Dropped Off'}</div>
    <div class="popup-actions">
      <button class="popup-btn popup-btn-primary" data-act="pop-view" data-id="${p.id}">View</button>
      <button class="popup-btn ${p.dropped_off ? 'popup-btn-dropped' : 'popup-btn-pending'}" data-act="pop-toggle" data-id="${p.id}" data-dr="${p.dropped_off}">${p.dropped_off ? 'Undo' : 'Drop'}</button>
    </div>
    <div class="popup-actions" style="margin-top:4px;">
      <button class="popup-btn ${inRt ? 'popup-btn-danger' : 'popup-btn-route'}" data-act="pop-route" data-id="${p.id}">${inRt ? 'Remove from Route' : '+ Add to Route'}</button>
    </div></div>`;
  mapPopup = new maplibregl.Popup({ offset: [0, -32], closeButton: true, maxWidth: '280px' }).setLngLat(mk.getLngLat()).setHTML(html).addTo(map);
  mapPopup.on('open', () => {
    document.querySelector('[data-act="pop-view"]')?.addEventListener('click', (e) => { const id = (e.target as HTMLElement).getAttribute('data-id'); if (id) { selectedProspectId = id; panelView = 'panel-detail'; renderPanel(); } });
    document.querySelector('[data-act="pop-toggle"]')?.addEventListener('click', (e) => { const id = (e.target as HTMLElement).getAttribute('data-id'); const dr = (e.target as HTMLElement).getAttribute('data-dr') === 'true'; if (id) mapToggleDropped(id, dr); });
    document.querySelector('[data-act="pop-route"]')?.addEventListener('click', (e) => { const id = (e.target as HTMLElement).getAttribute('data-id'); if (id) toggleRouteSelection(id); });
  });
}

function toggleRouteSelection(id: string) {
  if (isInRoute(id)) { removeFromRoute(id); } else {
    const err = addToRoute(id);
    if (err) { errorMessage = err; renderPanel(); return; }
  }
  const mk = markers.get(id); const p = getById(id);
  if (mk && p) openPopup(p, mk);
}

async function mapToggleDropped(id: string, cur: boolean) {
  try { const u = await toggleDroppedOff(id, cur); prospects = prospects.map(p => p.id === id ? u : p); refreshMarkers(); if (panelView === 'panel-detail' && selectedProspectId === id) renderPanel(); } catch (e: unknown) { errorMessage = e instanceof Error ? e.message : 'Failed'; renderPanel(); }
}

function flyTo(p: Prospect) {
  if (!map || p.latitude == null || p.longitude == null) return;
  map.flyTo({ center: [p.longitude, p.latitude], zoom: SINGLE_ZOOM });
  const m = markers.get(p.id);
  if (m) setTimeout(() => openPopup(p, m), 600);
}

function handleLocate() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(pos => { if (map) map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 14 }); }, () => {}, { timeout: 5000, enableHighAccuracy: false });
}

// ─── Shell ─────────────────────────────────────────────
function setupShell() {
  const app = document.getElementById('app')!;
  app.innerHTML = `<div id="map-container"></div><div id="top-bar"><div id="search-bar"></div></div><div id="panel-container"></div>`;
  createMap();
  setupMapControls();
  renderPanel();
  updateSearchBar();
}

function setupMapControls() {
  const mc = document.getElementById('map-container');
  if (!mc) return;
  const div = document.createElement('div'); div.id = 'map-controls';
  div.innerHTML = `<button class="map-ctrl-btn" id="btn-locate" title="Locate Me" aria-label="Locate Me">📍</button><button class="map-ctrl-btn" id="btn-map-add" title="Add Prospect" aria-label="Add Prospect">＋</button>`;
  mc.appendChild(div);
  document.getElementById('btn-locate')?.addEventListener('click', handleLocate);
  document.getElementById('btn-map-add')?.addEventListener('click', () => { resetAdd(); panelView = 'panel-add'; renderPanel(); });
}

function updateSearchBar() {
  const sb = document.getElementById('search-bar'); if (!sb) return;
  sb.innerHTML = `<input type="search" id="shell-search" class="form-input search-input" placeholder="Search prospects..." autocomplete="off" value="${esc(searchQuery)}">${searchQuery ? '<button class="btn btn-small btn-secondary" id="shell-clear">✕</button>' : ''}`;
  document.getElementById('shell-search')?.addEventListener('input', e => { searchQuery = (e.target as HTMLInputElement).value; loadData(); });
  document.getElementById('shell-clear')?.addEventListener('click', () => { searchQuery = ''; loadData(); });
}

// ─── Data ──────────────────────────────────────────────
async function loadData() {
  loading = true; errorMessage = null; renderPanel();
  try { prospects = await fetchProspects(searchQuery || undefined, false); }
  catch (e: unknown) { errorMessage = e instanceof Error ? e.message : 'Failed to load.'; }
  finally {
    loading = false;
    reconcileRoute();
    refreshMarkers();
    // Render first: fitMap uses the panel's real overlay height.
    renderPanel();
    applyInitialMapFit();
  }
}

// ─── Autocomplete ──────────────────────────────────────
let acSeq = 0; // monotonically increasing sequence to reject stale responses

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

  const seq = ++acSeq; // capture current sequence number
  const query = text.trim();

  const t = setTimeout(async () => {
    const ctrl = new AbortController(); setAbort(ctrl);
    try {
      const r = await geocodeAutocomplete(query, ctrl.signal);
      // Only accept result if no newer input has arrived (ISSUE 4 guard)
      if (seq !== acSeq) return;
      setSug(r); setVis(r.length > 0);
    } catch {
      // Silently ignore aborted/failed — only if still current
      if (seq !== acSeq) return;
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
    prospects.unshift(r as Prospect); resetAdd(); panelView = 'panel-list'; refreshMarkers(); submitting = false; renderPanel();
  } catch (er: unknown) { errorMessage = er instanceof Error ? er.message : "Couldn't save."; submitting = false; renderPanel(); }
}

async function confirmAddDup() {
  submitting = true; renderPanel();
  const inp: CreateProspectInput = { restaurant_name: addName, address_input: addAddress, address_normalized: addNormalized || null, latitude: addLat, longitude: addLon, geocode_provider: addLat !== null ? 'Geoapify' : null, geocode_reference: addPlaceId || null, skip_duplicate_check: true };
  try { prospects.unshift(await createProspect(inp) as Prospect); resetAdd(); panelView = 'panel-list'; refreshMarkers(); submitting = false; renderPanel(); }
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
    const u = r as Prospect; prospects = prospects.map(p => p.id === u.id ? u : p); selectedProspectId = u.id; panelView = 'panel-detail'; refreshMarkers(); submitting = false; renderPanel();
  } catch (er: unknown) { errorMessage = er instanceof Error ? er.message : 'Failed to update.'; submitting = false; renderPanel(); }
}

async function confirmEditDup() {
  if (!selectedProspectId) return; submitting = true; renderPanel();
  try { const r = await updateProspect({ id: selectedProspectId, restaurant_name: edName, address_input: edAddr, address_normalized: edNorm || null, latitude: edLat, longitude: edLon, geocode_provider: edLat !== null ? 'Geoapify' : null, geocode_reference: edPid || null, skip_duplicate_check: true }); const u = r as Prospect; prospects = prospects.map(p => p.id === u.id ? u : p); selectedProspectId = u.id; panelView = 'panel-detail'; refreshMarkers(); submitting = false; renderPanel(); }
  catch (er: unknown) { errorMessage = er instanceof Error ? er.message : 'Failed to update.'; submitting = false; renderPanel(); }
}

// ─── Actions ───────────────────────────────────────────
async function handleToggleDropped(id: string, cur: boolean) {
  try { const u = await toggleDroppedOff(id, cur); prospects = prospects.map(p => p.id === id ? u : p); refreshMarkers(); if (panelView === 'panel-detail' && selectedProspectId === id) renderPanel(); else if (panelView === 'panel-list') renderPanel(); }
  catch (e: unknown) { errorMessage = e instanceof Error ? e.message : 'Failed.'; renderPanel(); }
}

async function handleArchive(id: string) {
  try { await archiveProspect(id); removeFromRoute(id); prospects = prospects.filter(p => p.id !== id); refreshMarkers(); if (selectedProspectId === id) { selectedProspectId = null; panelView = 'panel-list'; } renderPanel(); }
  catch (e: unknown) { errorMessage = e instanceof Error ? e.message : 'Failed.'; renderPanel(); }
}

async function handleRestore(id: string) {
  try { const u = await restoreProspect(id); prospects.unshift(u); refreshMarkers(); if (selectedProspectId === id) { selectedProspectId = id; panelView = 'panel-detail'; } renderPanel(); }
  catch (e: unknown) { errorMessage = e instanceof Error ? e.message : 'Failed.'; renderPanel(); }
}

async function handleDelete(id: string) {
  if (!confirm('Permanently delete?')) return;
  try { await deleteProspect(id); removeFromRoute(id); prospects = prospects.filter(p => p.id !== id); refreshMarkers(); if (selectedProspectId === id) { selectedProspectId = null; panelView = 'panel-list'; } renderPanel(); }
  catch (e: unknown) { errorMessage = e instanceof Error ? e.message : 'Failed.'; renderPanel(); }
}

function getById(id: string): Prospect | undefined { return prospects.find(p => p.id === id); }

// ─── Panel Render ──────────────────────────────────────
function renderPanel() {
  const p = document.getElementById('panel-container'); if (!p) return;
  switch (panelView) { case 'panel-list': rList(p); break; case 'panel-add': rAdd(p); break; case 'panel-detail': rDetail(p); break; case 'panel-edit': rEdit(p); break; case 'panel-archived': rArch(p); break; case 'panel-import': rImport(p); break; }
}

function rList(p: HTMLElement) {
  const nc = prospects.filter(x => x.latitude == null || x.longitude == null).length;
  const routeItems = routeIds.map(id => getById(id)).filter(Boolean) as Prospect[];
  p.innerHTML = `<div class="panel-header"><h1 class="app-title">ON THE ROAD AGAIN</h1><p class="app-subtitle">${prospects.length} prospect${prospects.length !== 1 ? 's' : ''}</p></div>
    ${errorMessage ? `<div class="error-banner">${esc(errorMessage)}</div>` : ''}
    ${nc > 0 && !loading ? `<div class="info-banner">${nc} prospect${nc !== 1 ? 's' : ''} need${nc === 1 ? 's' : ''} an address update for the map.</div>` : ''}
    <div class="panel-actions-row"><button class="btn btn-primary" id="btn-pl-add">+ Add Prospect</button><button class="btn btn-secondary" id="btn-pl-arch">📦 Archived</button><button class="btn btn-secondary" id="btn-pl-import">📋 Import</button></div>
    ${routeItems.length > 0 ? `<div class="card route-tray">
      <div class="card-title"><span>🚚 Current Route</span><span class="badge badge-pending">${routeItems.length} / ${MAX_ROUTE}</span></div>
      <div class="route-list">${routeItems.map((x, i) => `<div class="route-item">
        <span class="route-num">${i + 1}.</span>
        <div class="route-info"><div class="route-name">${esc(x.restaurant_name)}</div><div class="route-addr">${esc(x.address_normalized || x.address_input)}</div></div>
        <div class="route-ctrls">
          <button class="btn btn-small btn-secondary route-up" data-idx="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move ${esc(x.restaurant_name)} up">↑</button>
          <button class="btn btn-small btn-secondary route-dn" data-idx="${i}" ${i === routeItems.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(x.restaurant_name)} down">↓</button>
          <button class="btn btn-small btn-danger route-rm" data-id="${x.id}" aria-label="Remove ${esc(x.restaurant_name)} from route">✕</button>
        </div>
      </div>`).join('')}</div>
      <button class="btn btn-secondary btn-full" id="btn-clear-route">Clear Route</button>
      <button class="btn btn-primary btn-full" id="btn-send-gmaps">🚀 Send ${routeItems.length} Stop${routeItems.length !== 1 ? 's' : ''} to Google Maps</button>
    </div>` : ''}
    <div class="prospect-list">${loading ? '<div class="empty-state">Loading...</div>' : !prospects.length ? `<div class="empty-state">${searchQuery ? 'No matches.' : 'No prospects saved yet.'}</div>` : prospects.map(x => `<div class="prospect-item" data-id="${x.id}"><div class="prospect-info"><div class="prospect-name">${esc(x.restaurant_name)}</div><div class="prospect-address">${esc(x.address_normalized || x.address_input)}</div></div><div class="prospect-actions-row">${x.dropped_off ? '<span class="badge badge-dropped">Dropped</span>' : ''}<button class="btn btn-small btn-secondary pl-view" data-id="${x.id}">View</button><button class="btn btn-small btn-status ${x.dropped_off ? 'dropped' : 'pending'} pl-toggle" data-id="${x.id}" data-dr="${x.dropped_off}">${x.dropped_off ? '✓' : 'Drop'}</button></div></div>`).join('')}</div>`;
  document.getElementById('btn-pl-add')?.addEventListener('click', () => { resetAdd(); panelView = 'panel-add'; renderPanel(); });
  document.getElementById('btn-pl-arch')?.addEventListener('click', () => { panelView = 'panel-archived'; renderPanel(); });
  document.getElementById('btn-pl-import')?.addEventListener('click', () => { resetImport(); panelView = 'panel-import'; renderPanel(); });
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
    <div class="detail-section"><div class="detail-label">Status</div><div class="detail-value">${x.dropped_off ? `<span class="badge badge-dropped">✓ Dropped Off</span><div class="detail-muted">${x.dropped_off_at ? new Date(x.dropped_off_at).toLocaleString() : ''}</div>` : '<span class="badge badge-pending">Not Dropped Off</span>'}</div></div>
    ${x.archived ? '<div class="detail-section"><div class="detail-label"></div><div class="detail-value"><span class="badge badge-archived">Archived</span></div></div>' : ''}
    <div class="detail-section"><div class="detail-label">Created</div><div class="detail-value detail-muted">${new Date(x.created_at).toLocaleString()}</div></div></div>
    <div class="card"><div class="detail-actions">
    <button class="btn btn-secondary btn-full" id="btn-dt-fly">📍 Show on Map</button>
    ${!x.archived ? `<button class="btn ${isInRoute(x.id) ? 'btn-danger' : 'btn-primary'} btn-full" id="btn-dt-route">${isInRoute(x.id) ? 'Remove from Route' : '+ Add to Route'}</button><button class="btn btn-status ${x.dropped_off ? 'dropped' : 'pending'} btn-full" id="btn-dt-tog">${x.dropped_off ? '✓ Dropped Off — Undo' : 'Mark Dropped Off'}</button><button class="btn btn-secondary btn-full" id="btn-dt-ed">✏️ Edit</button><button class="btn btn-secondary btn-full" id="btn-dt-arch">📦 Archive</button>` : '<button class="btn btn-primary btn-full" id="btn-dt-rest">↩️ Restore</button>'}
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
  const ar = prospects.filter(x => x.archived);
  p.innerHTML = `<div class="panel-header"><button class="btn btn-back" id="btn-bk-ar">← Back</button><h1 class="app-title" style="font-size:1.15rem;">Archived</h1></div>
    <div class="card"><div class="card-title"><span>Archived</span><span class="badge badge-pending">${ar.length} archived</span></div>
    ${!ar.length ? '<div class="empty-state">No archived prospects.</div>' : `<div class="prospect-list">${ar.map(x => `<div class="prospect-item" data-id="${x.id}"><div class="prospect-info"><div class="prospect-name">${esc(x.restaurant_name)}</div><div class="prospect-address">${esc(x.address_normalized || x.address_input)}</div></div><div class="prospect-actions-row"><button class="btn btn-small btn-primary ar-rest" data-id="${x.id}">Restore</button></div></div>`).join('')}</div>`}</div>`;
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
setupShell();
routeIds = loadRoute();
loadData();
