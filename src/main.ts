import * as maplibregl from 'maplibre-gl';
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

type View = 'panel-list' | 'panel-add' | 'panel-detail' | 'panel-edit' | 'panel-archived';
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

// ─── Map ───────────────────────────────────────────────
let map: maplibregl.Map | null = null;
let markers: Map<string, maplibregl.Marker> = new Map();
let mapPopup: maplibregl.Popup | null = null;

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
  map.on('load', () => refreshMarkers());
}

function fitMap() {
  if (!map) return;
  const v = prospects.filter(p => p.latitude != null && p.longitude != null);
  if (!v.length) { map.flyTo({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM }); return; }
  if (v.length === 1) { map.flyTo({ center: [v[0].longitude!, v[0].latitude!], zoom: SINGLE_ZOOM }); return; }
  const b = new maplibregl.LngLatBounds();
  for (const p of v) b.extend([p.longitude!, p.latitude!]);
  map.fitBounds(b, { padding: 60, maxZoom: 14 });
}

function mkEl(p: Prospect): HTMLElement {
  const el = document.createElement('div');
  el.className = `map-marker ${p.dropped_off ? 'marker-dropped' : 'marker-active'}`;
  el.setAttribute('aria-label', `${p.restaurant_name}${p.dropped_off ? ' — Dropped Off' : ''}`);
  el.innerHTML = p.dropped_off
    ? `<svg width="30" height="40" viewBox="0 0 30 40"><path d="M15 1C7.3 1 1 7.3 1 15c0 10 14 24 14 24s14-14 14-24C29 7.3 22.7 1 15 1z" fill="#10b981" stroke="#047857" stroke-width="1.5"/><text x="15" y="19" text-anchor="middle" fill="white" font-size="15" font-weight="bold">✓</text></svg>`
    : `<svg width="30" height="40" viewBox="0 0 30 40"><path d="M15 1C7.3 1 1 7.3 1 15c0 10 14 24 14 24s14-14 14-24C29 7.3 22.7 1 15 1z" fill="#2563eb" stroke="#1e40af" stroke-width="1.5"/><circle cx="15" cy="13" r="6" fill="white"/></svg>`;
  el.style.cursor = 'pointer';
  return el;
}

function refreshMarkers() {
  if (!map) return;
  const ids = new Set(prospects.map(p => p.id));
  for (const [id, m] of markers) { if (!ids.has(id)) { m.remove(); markers.delete(id); } }
  for (const p of prospects) {
    if (p.latitude == null || p.longitude == null) continue;
    const ex = markers.get(p.id);
    if (ex) {
      const nel = mkEl(p);
      const old = ex.getElement();
      nel.addEventListener('click', () => openPopup(p, ex));
      if (old.parentNode) old.parentNode.replaceChild(nel, old);
    } else {
      const nel = mkEl(p);
      const mk = new maplibregl.Marker({ element: nel, anchor: 'bottom' }).setLngLat([p.longitude, p.latitude]).addTo(map!);
      nel.addEventListener('click', () => openPopup(p, mk));
      markers.set(p.id, mk);
    }
  }
  fitMap();
}

function openPopup(p: Prospect, mk: maplibregl.Marker) {
  if (!map) return;
  if (mapPopup) mapPopup.remove();
  const a = p.address_normalized || p.address_input;
  const html = `<div class="map-popup">
    <div class="popup-name">${esc(p.restaurant_name)}</div>
    <div class="popup-addr">${esc(a)}</div>
    <div class="${p.dropped_off ? 'popup-dropped' : 'popup-pending'}">${p.dropped_off ? '✓ Dropped Off ' + (p.dropped_off_at ? new Date(p.dropped_off_at).toLocaleDateString() : '') : 'Not Dropped Off'}</div>
    <div class="popup-actions">
      <button class="popup-btn popup-btn-primary" data-act="pop-view" data-id="${p.id}">View</button>
      <button class="popup-btn ${p.dropped_off ? 'popup-btn-dropped' : 'popup-btn-pending'}" data-act="pop-toggle" data-id="${p.id}" data-dr="${p.dropped_off}">${p.dropped_off ? 'Undo' : 'Mark Dropped Off'}</button>
    </div></div>`;
  mapPopup = new maplibregl.Popup({ offset: [0, -32], closeButton: true, maxWidth: '280px' }).setLngLat(mk.getLngLat()).setHTML(html).addTo(map);
  mapPopup.on('open', () => {
    document.querySelector('[data-act="pop-view"]')?.addEventListener('click', (e) => { const id = (e.target as HTMLElement).getAttribute('data-id'); if (id) { selectedProspectId = id; panelView = 'panel-detail'; renderPanel(); } });
    document.querySelector('[data-act="pop-toggle"]')?.addEventListener('click', (e) => { const id = (e.target as HTMLElement).getAttribute('data-id'); const dr = (e.target as HTMLElement).getAttribute('data-dr') === 'true'; if (id) mapToggleDropped(id, dr); });
  });
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
  finally { loading = false; refreshMarkers(); renderPanel(); }
}

// ─── Autocomplete ──────────────────────────────────────
function triggerAc(
  text: string,
  setSug: (s: AutocompleteSuggestion[]) => void, setVis: (v: boolean) => void,
  abort: AbortController | null, setAbort: (a: AbortController | null) => void,
  timer: ReturnType<typeof setTimeout> | null, setTimer: (t: ReturnType<typeof setTimeout> | null) => void,
  rebuild: () => void,
) {
  if (timer) clearTimeout(timer);
  if (text.trim().length < 2) { setSug([]); setVis(false); return; }
  const t = setTimeout(async () => {
    if (abort) abort.abort();
    const ctrl = new AbortController(); setAbort(ctrl);
    try { const r = await geocodeAutocomplete(text.trim(), ctrl.signal); setSug(r); setVis(r.length > 0); } catch { setSug([]); setVis(false); }
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
  try { await archiveProspect(id); prospects = prospects.filter(p => p.id !== id); refreshMarkers(); if (selectedProspectId === id) { selectedProspectId = null; panelView = 'panel-list'; } renderPanel(); }
  catch (e: unknown) { errorMessage = e instanceof Error ? e.message : 'Failed.'; renderPanel(); }
}

async function handleRestore(id: string) {
  try { const u = await restoreProspect(id); prospects.unshift(u); refreshMarkers(); if (selectedProspectId === id) { selectedProspectId = id; panelView = 'panel-detail'; } renderPanel(); }
  catch (e: unknown) { errorMessage = e instanceof Error ? e.message : 'Failed.'; renderPanel(); }
}

async function handleDelete(id: string) {
  if (!confirm('Permanently delete?')) return;
  try { await deleteProspect(id); prospects = prospects.filter(p => p.id !== id); refreshMarkers(); if (selectedProspectId === id) { selectedProspectId = null; panelView = 'panel-list'; } renderPanel(); }
  catch (e: unknown) { errorMessage = e instanceof Error ? e.message : 'Failed.'; renderPanel(); }
}

function getById(id: string): Prospect | undefined { return prospects.find(p => p.id === id); }

// ─── Panel Render ──────────────────────────────────────
function renderPanel() {
  const p = document.getElementById('panel-container'); if (!p) return;
  switch (panelView) { case 'panel-list': rList(p); break; case 'panel-add': rAdd(p); break; case 'panel-detail': rDetail(p); break; case 'panel-edit': rEdit(p); break; case 'panel-archived': rArch(p); break; }
}

function rList(p: HTMLElement) {
  const nc = prospects.filter(x => x.latitude == null || x.longitude == null).length;
  p.innerHTML = `<div class="panel-header"><h1 class="app-title">ON THE ROAD AGAIN</h1><p class="app-subtitle">${prospects.length} prospect${prospects.length !== 1 ? 's' : ''}</p></div>
    ${errorMessage ? `<div class="error-banner">${esc(errorMessage)}</div>` : ''}
    ${nc > 0 && !loading ? `<div class="info-banner">${nc} prospect${nc !== 1 ? 's' : ''} need${nc === 1 ? 's' : ''} an address update for the map.</div>` : ''}
    <div class="panel-actions-row"><button class="btn btn-primary" id="btn-pl-add">+ Add Prospect</button><button class="btn btn-secondary" id="btn-pl-arch">📦 Archived</button></div>
    <div class="prospect-list">${loading ? '<div class="empty-state">Loading...</div>' : !prospects.length ? `<div class="empty-state">${searchQuery ? 'No matches.' : 'No prospects saved yet.'}</div>` : prospects.map(x => `<div class="prospect-item" data-id="${x.id}"><div class="prospect-info"><div class="prospect-name">${esc(x.restaurant_name)}</div><div class="prospect-address">${esc(x.address_normalized || x.address_input)}</div></div><div class="prospect-actions-row">${x.dropped_off ? '<span class="badge badge-dropped">Dropped</span>' : ''}<button class="btn btn-small btn-secondary pl-view" data-id="${x.id}">View</button><button class="btn btn-small btn-status ${x.dropped_off ? 'dropped' : 'pending'} pl-toggle" data-id="${x.id}" data-dr="${x.dropped_off}">${x.dropped_off ? '✓' : 'Drop'}</button></div></div>`).join('')}</div>`;
  document.getElementById('btn-pl-add')?.addEventListener('click', () => { resetAdd(); panelView = 'panel-add'; renderPanel(); });
  document.getElementById('btn-pl-arch')?.addEventListener('click', () => { panelView = 'panel-archived'; renderPanel(); });
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
    ${!x.archived ? `<button class="btn btn-status ${x.dropped_off ? 'dropped' : 'pending'} btn-full" id="btn-dt-tog">${x.dropped_off ? '✓ Dropped Off — Undo' : 'Mark Dropped Off'}</button><button class="btn btn-secondary btn-full" id="btn-dt-ed">✏️ Edit</button><button class="btn btn-secondary btn-full" id="btn-dt-arch">📦 Archive</button>` : '<button class="btn btn-primary btn-full" id="btn-dt-rest">↩️ Restore</button>'}
    <button class="btn btn-danger btn-full" id="btn-dt-del">🗑️ Delete Permanently</button></div></div>`;
  document.getElementById('btn-bk-dt')?.addEventListener('click', () => { selectedProspectId = null; panelView = 'panel-list'; renderPanel(); });
  document.getElementById('btn-dt-fly')?.addEventListener('click', () => flyTo(x));
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

function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }

// ─── Bootstrap ─────────────────────────────────────────
setupShell();
loadData();
