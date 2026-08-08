import {
  fetchProspects,
  createProspect,
  updateProspect,
  toggleDroppedOff,
  archiveProspect,
  restoreProspect,
  deleteProspect,
  geocodeAutocomplete,
  geocodeSearch,
} from './api/client';
import {
  Prospect,
  AutocompleteSuggestion,
  CreateProspectInput,
} from './types/prospect';

// ─── State ──────────────────────────────────────────────
const appEl = document.getElementById('app')!;

let prospects: Prospect[] = [];
let archivedProspects: Prospect[] = [];
let loading = true;
let errorMessage: string | null = null;
let submitting = false;

// View routing
type View =
  | 'list'
  | 'add'
  | 'detail'
  | 'edit'
  | 'archived';
let view: View = 'list';
let selectedProspectId: string | null = null;
let searchQuery = '';

// Add-prospect flow state
let addStep: 'entry' | 'confirm' | 'duplicate' = 'entry';
let addName = '';
let addAddress = '';
let addNormalized = '';
let addLat: number | null = null;
let addLon: number | null = null;
let addPlaceId = '';
let addDuplicates: Prospect[] = [];
let addAddressSelected = false;

// Autocomplete state
let autocompleteSuggestions: AutocompleteSuggestion[] = [];
let autocompleteVisible = false;
let autocompleteAbort: AbortController | null = null;
let autocompleteDebounce: ReturnType<typeof setTimeout> | null = null;

// Edit state
let editName = '';
let editAddress = '';
let editNormalized = '';
let editLat: number | null = null;
let editLon: number | null = null;
let editPlaceId = '';
let editDuplicates: Prospect[] = [];
let editStep: 'entry' | 'confirm' | 'duplicate' = 'entry';
let editAutocompleteSuggestions: AutocompleteSuggestion[] = [];
let editAutocompleteVisible = false;
let editAutocompleteAbort: AbortController | null = null;
let editAutocompleteDebounce: ReturnType<typeof setTimeout> | null = null;

// ─── Data Loading ──────────────────────────────────────
async function loadData() {
  loading = true;
  errorMessage = null;
  render();

  try {
    prospects = await fetchProspects(searchQuery || undefined, false);
    archivedProspects = await fetchProspects(undefined, true);
  } catch (err: unknown) {
    errorMessage = err instanceof Error ? err.message : 'Failed to load prospects.';
  } finally {
    loading = false;
    render();
  }
}

// ─── Autocomplete ──────────────────────────────────────
function triggerAutocomplete(
  text: string,
  setter: (s: AutocompleteSuggestion[]) => void,
  setVisible: (v: boolean) => void,
  abortRef: { current: AbortController | null },
  debounceRef: { current: ReturnType<typeof setTimeout> | null }
) {
  if (debounceRef.current) clearTimeout(debounceRef.current);
  if (text.trim().length < 2) {
    setter([]);
    setVisible(false);
    return;
  }

  debounceRef.current = setTimeout(async () => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const results = await geocodeAutocomplete(text.trim(), controller.signal);
      setter(results);
      setVisible(results.length > 0);
    } catch {
      // Silently ignore aborted or failed autocomplete
      setter([]);
      setVisible(false);
    }
  }, 300);
}

function selectSuggestion(s: AutocompleteSuggestion) {
  addAddress = s.formatted;
  addNormalized = s.formatted;
  addLat = s.lat;
  addLon = s.lon;
  addPlaceId = s.placeId;
  addAddressSelected = true;
  autocompleteSuggestions = [];
  autocompleteVisible = false;
  addStep = 'confirm';
  render();
}

function selectEditSuggestion(s: AutocompleteSuggestion) {
  editAddress = s.formatted;
  editNormalized = s.formatted;
  editLat = s.lat;
  editLon = s.lon;
  editPlaceId = s.placeId;
  editAutocompleteSuggestions = [];
  editAutocompleteVisible = false;
  editStep = 'confirm';
  render();
}

// ─── Add Prospect Flow ─────────────────────────────────
async function handleAddProspect(e: SubmitEvent) {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const nameInput = form.querySelector('#restaurant_name') as HTMLInputElement;
  const addressInput = form.querySelector('#address_input') as HTMLInputElement;

  addName = nameInput.value.trim();
  if (!addAddressSelected) {
    addAddress = addressInput.value.trim();
  }

  if (!addName || !addAddress) return;

  errorMessage = null;

  // If address wasn't picked from autocomplete, try geocoding it
  if (!addAddressSelected && addAddress) {
    submitting = true;
    render();

    try {
      const result = await geocodeSearch(addAddress);
      if (result.results.length > 0 && result.isPrecise) {
        const best = result.best;
        addNormalized = best.formatted;
        addLat = best.lat;
        addLon = best.lon;
        addPlaceId = best.placeId;
        addStep = 'confirm';
        submitting = false;
        render();
        return;
      } else if (result.results.length > 0 && !result.isPrecise) {
        errorMessage =
          "We couldn't confidently locate this address. The result may be too broad. Please enter a more specific street address.";
        submitting = false;
        render();
        return;
      } else {
        errorMessage =
          "We couldn't locate this address. Check the address and try again.";
        submitting = false;
        render();
        return;
      }
    } catch (err: unknown) {
      errorMessage =
        err instanceof Error
          ? err.message
          : 'Address search is temporarily unavailable. Try again.';
      submitting = false;
      render();
      return;
    }
  }

  // If we got here with addStep !== 'confirm', go to confirm step
  if (addAddressSelected && addStep !== 'confirm') {
    addStep = 'confirm';
    render();
    return;
  }
}

async function confirmAddProspect() {
  submitting = true;
  errorMessage = null;
  render();

  const input: CreateProspectInput = {
    restaurant_name: addName,
    address_input: addAddress,
    address_normalized: addNormalized || null,
    latitude: addLat,
    longitude: addLon,
    geocode_provider: addLat !== null ? 'Geoapify' : null,
    geocode_reference: addPlaceId || null,
  };

  try {
    const result = await createProspect(input);

    if ('code' in result && result.code === 'DUPLICATE_DETECTED') {
      addDuplicates = result.duplicates;
      addStep = 'duplicate';
      submitting = false;
      render();
      return;
    }

    // Success
    const newProspect = result as Prospect;
    prospects.unshift(newProspect);
    resetAddState();
    view = 'list';
    submitting = false;
    render();
  } catch (err: unknown) {
    errorMessage =
      err instanceof Error ? err.message : "We couldn't save this prospect.";
    submitting = false;
    render();
  }
}

async function confirmAddDespiteDuplicate() {
  submitting = true;
  render();

  const input: CreateProspectInput = {
    restaurant_name: addName,
    address_input: addAddress,
    address_normalized: addNormalized || null,
    latitude: addLat,
    longitude: addLon,
    geocode_provider: addLat !== null ? 'Geoapify' : null,
    geocode_reference: addPlaceId || null,
    skip_duplicate_check: true,
  };

  try {
    const result = await createProspect(input);
    const newProspect = result as Prospect;
    prospects.unshift(newProspect);
    resetAddState();
    view = 'list';
    submitting = false;
    render();
  } catch (err: unknown) {
    errorMessage =
      err instanceof Error ? err.message : "We couldn't save this prospect.";
    submitting = false;
    render();
  }
}

function resetAddState() {
  addStep = 'entry';
  addName = '';
  addAddress = '';
  addNormalized = '';
  addLat = null;
  addLon = null;
  addPlaceId = '';
  addDuplicates = [];
  addAddressSelected = false;
  autocompleteSuggestions = [];
  autocompleteVisible = false;
}

// ─── Edit Flow ─────────────────────────────────────────
function startEdit(prospect: Prospect) {
  editName = prospect.restaurant_name;
  editAddress = prospect.address_input;
  editNormalized = prospect.address_normalized || '';
  editLat = prospect.latitude;
  editLon = prospect.longitude;
  editPlaceId = prospect.geocode_reference || '';
  editDuplicates = [];
  editStep = 'entry';
  editAutocompleteSuggestions = [];
  editAutocompleteVisible = false;
  view = 'edit';
  render();
}

async function handleEditSubmit(e: SubmitEvent) {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const nameInput = form.querySelector('#edit_restaurant_name') as HTMLInputElement;
  const addressInput = form.querySelector('#edit_address_input') as HTMLInputElement;

  const newName = nameInput.value.trim();
  const newAddress = addressInput.value.trim();

  if (!newName || !newAddress || !selectedProspectId) return;

  errorMessage = null;

  // If address changed and hasn't been geocoded via autocomplete
  const geoChanged = newAddress !== editAddress || editLat === null;
  if (geoChanged && !editAutocompleteVisible && editStep === 'entry') {
    submitting = true;
    render();

    try {
      const result = await geocodeSearch(newAddress);
      if (result.results.length > 0 && result.isPrecise) {
        const best = result.best;
        editName = newName;
        editAddress = newAddress;
        editNormalized = best.formatted;
        editLat = best.lat;
        editLon = best.lon;
        editPlaceId = best.placeId;
        editStep = 'confirm';
        submitting = false;
        render();
        return;
      } else if (result.results.length > 0 && !result.isPrecise) {
        errorMessage = "The new address couldn't be precisely located. Try a more specific address.";
        submitting = false;
        render();
        return;
      } else {
        errorMessage = "We couldn't locate the new address. Check and try again.";
        submitting = false;
        render();
        return;
      }
    } catch (err: unknown) {
      errorMessage =
        err instanceof Error ? err.message : 'Address search is temporarily unavailable.';
      submitting = false;
      render();
      return;
    }
  }

  editStep = 'confirm';
  render();
  return;
}

async function confirmEditProspect() {
  if (!selectedProspectId) return;
  submitting = true;
  errorMessage = null;
  render();

  try {
    const result = await updateProspect({
      id: selectedProspectId,
      restaurant_name: editName,
      address_input: editAddress,
      address_normalized: editNormalized || null,
      latitude: editLat,
      longitude: editLon,
      geocode_provider: editLat !== null ? 'Geoapify' : null,
      geocode_reference: editPlaceId || null,
    });

    if ('code' in result && result.code === 'DUPLICATE_DETECTED') {
      editDuplicates = result.duplicates;
      editStep = 'duplicate';
      submitting = false;
      render();
      return;
    }

    const updated = result as Prospect;
    prospects = prospects.map((p) => (p.id === updated.id ? updated : p));
    selectedProspectId = updated.id;
    view = 'detail';
    submitting = false;
    render();
  } catch (err: unknown) {
    errorMessage =
      err instanceof Error ? err.message : 'Failed to update prospect.';
    submitting = false;
    render();
  }
}

async function confirmEditDespiteDuplicate() {
  if (!selectedProspectId) return;
  submitting = true;
  render();

  try {
    const result = await updateProspect({
      id: selectedProspectId,
      restaurant_name: editName,
      address_input: editAddress,
      address_normalized: editNormalized || null,
      latitude: editLat,
      longitude: editLon,
      geocode_provider: editLat !== null ? 'Geoapify' : null,
      geocode_reference: editPlaceId || null,
      skip_duplicate_check: true,
    });

    const updated = result as Prospect;
    prospects = prospects.map((p) => (p.id === updated.id ? updated : p));
    selectedProspectId = updated.id;
    view = 'detail';
    submitting = false;
    render();
  } catch (err: unknown) {
    errorMessage =
      err instanceof Error ? err.message : 'Failed to update prospect.';
    submitting = false;
    render();
  }
}

// ─── Detail View Actions ───────────────────────────────
async function handleToggleStatus(id: string, currentDroppedOff: boolean) {
  try {
    const updated = await toggleDroppedOff(id, currentDroppedOff);
    prospects = prospects.map((p) => (p.id === id ? updated : p));
    if (selectedProspectId === id) {
      selectedProspectId = id;
    }
    render();
  } catch (err: unknown) {
    errorMessage = err instanceof Error ? err.message : 'Failed to update status.';
    render();
  }
}

async function handleArchive(id: string) {
  try {
    await archiveProspect(id);
    prospects = prospects.filter((p) => p.id !== id);
    if (selectedProspectId === id) {
      selectedProspectId = null;
      view = 'list';
    }
    render();
  } catch (err: unknown) {
    errorMessage = err instanceof Error ? err.message : 'Failed to archive prospect.';
    render();
  }
}

async function handleRestore(id: string) {
  try {
    const updated = await restoreProspect(id);
    prospects.unshift(updated);
    if (selectedProspectId === id) {
      selectedProspectId = id;
      view = 'detail';
    }
    render();
  } catch (err: unknown) {
    errorMessage = err instanceof Error ? err.message : 'Failed to restore prospect.';
    render();
  }
}

async function handleDelete(id: string) {
  if (!confirm('Permanently delete this prospect? This cannot be undone.')) return;
  try {
    await deleteProspect(id);
    prospects = prospects.filter((p) => p.id !== id);
    archivedProspects = archivedProspects.filter((p) => p.id !== id);
    if (selectedProspectId === id) {
      selectedProspectId = null;
      view = 'list';
    }
    render();
  } catch (err: unknown) {
    errorMessage = err instanceof Error ? err.message : 'Failed to delete prospect.';
    render();
  }
}

// ─── View Helpers ──────────────────────────────────────
function getProspectById(id: string): Prospect | undefined {
  return prospects.find((p) => p.id === id) || archivedProspects.find((p) => p.id === id);
}

// ─── Render ────────────────────────────────────────────
function render() {
  if (!appEl) return;

  switch (view) {
    case 'list':
      renderList();
      break;
    case 'add':
      renderAdd();
      break;
    case 'detail':
      renderDetail();
      break;
    case 'edit':
      renderEdit();
      break;
    case 'archived':
      renderArchived();
      break;
  }
}

// ─── Render: List ──────────────────────────────────────
function renderList() {
  const filtered = prospects;
  const activeCount = filtered.length;

  appEl.innerHTML = `
    <header class="app-header">
      <h1 class="app-title">ON THE ROAD AGAIN</h1>
      <p class="app-subtitle">Field Sales Restaurant Prospecting</p>
    </header>

    ${errorMessage ? `<div class="error-banner">${esc(errorMessage)}</div>` : ''}

    <div class="search-bar">
      <input
        type="search"
        id="search-input"
        class="form-input search-input"
        placeholder="Search prospects..."
        value="${esc(searchQuery)}"
        autocomplete="off"
      />
      ${searchQuery ? `<button class="btn btn-small btn-secondary" id="clear-search">✕</button>` : ''}
    </div>

    <button class="btn btn-primary btn-full" id="btn-add">
      + Add Prospect
    </button>

    <section class="card">
      <div class="card-title">
        <span>Prospects</span>
        <span class="badge badge-pending">${activeCount} active</span>
      </div>

      ${
        loading
          ? '<div class="empty-state">Loading...</div>'
          : filtered.length === 0
          ? `<div class="empty-state">${
              searchQuery
                ? 'No prospects match your search.'
                : 'No prospects saved yet. Add one to get started.'
            }</div>`
          : `<div class="prospect-list">
              ${filtered
                .map(
                  (p) => `
                <div class="prospect-item" data-id="${p.id}">
                  <div class="prospect-info">
                    <div class="prospect-name">${esc(p.restaurant_name)}</div>
                    <div class="prospect-address">${esc(p.address_input)}</div>
                    ${p.address_normalized && p.address_normalized !== p.address_input ? `<div class="prospect-normalized">${esc(p.address_normalized)}</div>` : ''}
                  </div>
                  <div class="prospect-actions-row">
                    ${p.dropped_off ? '<span class="badge badge-dropped">Dropped</span>' : ''}
                    <button class="btn btn-small btn-secondary" data-action="view" data-id="${p.id}">View</button>
                    <button class="btn btn-small btn-status ${p.dropped_off ? 'dropped' : 'pending'}" data-action="toggle-status" data-id="${p.id}" data-dropped="${p.dropped_off}">
                      ${p.dropped_off ? '✓' : 'Drop'}
                    </button>
                  </div>
                </div>
              `
                )
                .join('')}
            </div>`
      }

      <button class="btn btn-secondary btn-full btn-small-text" id="btn-archived">
        📦 Show Archived (${archivedProspects.filter(p => p.archived).length})
      </button>
    </section>
  `;

  attachListEvents();
}

function attachListEvents() {
  document.getElementById('btn-add')?.addEventListener('click', () => {
    resetAddState();
    view = 'add';
    render();
  });

  const searchInput = document.getElementById('search-input') as HTMLInputElement;
  searchInput?.addEventListener('input', (e) => {
    searchQuery = (e.target as HTMLInputElement).value;
    loadData();
  });
  document.getElementById('clear-search')?.addEventListener('click', () => {
    searchQuery = '';
    loadData();
  });

  document.getElementById('btn-archived')?.addEventListener('click', () => {
    view = 'archived';
    render();
  });

  document.querySelectorAll('[data-action="view"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedProspectId = btn.getAttribute('data-id');
      view = 'detail';
      render();
    });
  });

  document.querySelectorAll('[data-action="toggle-status"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id')!;
      const isDropped = btn.getAttribute('data-dropped') === 'true';
      handleToggleStatus(id, isDropped);
    });
  });
}

// ─── Render: Add ───────────────────────────────────────
function renderAdd() {
  if (addStep === 'duplicate') {
    renderAddDuplicate();
    return;
  }

  if (addStep === 'confirm') {
    renderAddConfirm();
    return;
  }

  appEl.innerHTML = `
    <header class="app-header">
      <button class="btn btn-back" id="btn-back-add">← Back</button>
      <h1 class="app-title" style="font-size:1.25rem;">Add Prospect</h1>
    </header>

    ${errorMessage ? `<div class="error-banner">${esc(errorMessage)}</div>` : ''}

    <section class="card">
      <form id="add-prospect-form">
        <div class="form-group">
          <label class="form-label" for="restaurant_name">Restaurant / Business Name</label>
          <input
            type="text"
            id="restaurant_name"
            class="form-input"
            placeholder="e.g. Lupie's Cafe"
            required
            maxlength="200"
            value="${esc(addName)}"
            ${submitting ? 'disabled' : ''}
          />
        </div>

        <div class="form-group autocomplete-wrapper">
          <label class="form-label" for="address_input">Address</label>
          <input
            type="text"
            id="address_input"
            class="form-input"
            placeholder="Start typing an address..."
            required
            maxlength="500"
            value="${esc(addAddress)}"
            autocomplete="off"
            ${submitting ? 'disabled' : ''}
          />
          ${
            autocompleteVisible
              ? `<div class="autocomplete-dropdown">
                  ${autocompleteSuggestions
                    .map(
                      (s) => `
                    <button type="button" class="autocomplete-item" data-index="${autocompleteSuggestions.indexOf(s)}">
                      <span class="autocomplete-label">${esc(s.formatted)}</span>
                    </button>
                  `
                    )
                    .join('')}
                </div>`
              : ''
          }
          <div class="form-hint">Select a suggestion for best results, or type a full address.</div>
        </div>

        <button type="submit" class="btn btn-primary" style="width:100%;" ${submitting ? 'disabled' : ''}>
          ${submitting ? 'Searching address...' : 'Continue'}
        </button>
      </form>
    </section>
  `;

  // Attach events
  document.getElementById('btn-back-add')?.addEventListener('click', () => {
    resetAddState();
    view = 'list';
    render();
  });

  const form = document.getElementById('add-prospect-form');
  form?.addEventListener('submit', (e) => handleAddProspect(e as SubmitEvent));

  const addrInput = document.getElementById('address_input') as HTMLInputElement;
  addrInput?.addEventListener('input', () => {
    addAddressSelected = false;
    addAddress = addrInput.value;
    triggerAutocomplete(
      addrInput.value,
      (s) => {
        autocompleteSuggestions = s;
      },
      (v) => {
        autocompleteVisible = v;
      },
      { current: autocompleteAbort },
      { current: autocompleteDebounce }
    );
    render();
  });

  // Attach autocomplete item clicks after render
  document.querySelectorAll('.autocomplete-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-index') || '0');
      if (autocompleteSuggestions[idx]) {
        selectSuggestion(autocompleteSuggestions[idx]);
      }
    });
  });

  // Keyboard navigation for autocomplete
  addrInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      autocompleteVisible = false;
      autocompleteSuggestions = [];
      render();
    }
  });

  // Close autocomplete on outside click
  document.addEventListener('click', function closeAutocomplete(e: Event) {
    const target = e.target as HTMLElement;
    if (!target.closest('.autocomplete-wrapper')) {
      autocompleteVisible = false;
      render();
    }
  }, { once: true });
}

function renderAddConfirm() {
  appEl.innerHTML = `
    <header class="app-header">
      <button class="btn btn-back" id="btn-back-confirm">← Back</button>
      <h1 class="app-title" style="font-size:1.25rem;">Confirm Prospect</h1>
    </header>

    ${errorMessage ? `<div class="error-banner">${esc(errorMessage)}</div>` : ''}

    <section class="card">
      <div class="confirm-detail">
        <h2 class="confirm-name">${esc(addName)}</h2>
        <p class="confirm-address">${esc(addNormalized || addAddress)}</p>
        ${addLat !== null ? `<p class="confirm-coords">📍 ${addLat!.toFixed(5)}, ${addLon!.toFixed(5)}</p>` : ''}
      </div>

      <div class="btn-row">
        <button class="btn btn-secondary" id="btn-cancel-add" style="flex:1;">Cancel</button>
        <button class="btn btn-primary" id="btn-confirm-add" style="flex:1;" ${submitting ? 'disabled' : ''}>
          ${submitting ? 'Saving...' : 'Save Prospect'}
        </button>
      </div>
    </section>
  `;

  document.getElementById('btn-back-confirm')?.addEventListener('click', () => {
    addStep = 'entry';
    render();
  });
  document.getElementById('btn-cancel-add')?.addEventListener('click', () => {
    resetAddState();
    view = 'list';
    render();
  });
  document.getElementById('btn-confirm-add')?.addEventListener('click', confirmAddProspect);
}

function renderAddDuplicate() {
  appEl.innerHTML = `
    <header class="app-header">
      <h1 class="app-title" style="font-size:1.25rem;">Possible Duplicate</h1>
    </header>

    <section class="card">
      <div class="warning-banner">
        This prospect may already exist in your database.
      </div>

      ${addDuplicates
        .map(
          (d) => `
        <div class="duplicate-card">
          <div class="prospect-name">${esc(d.restaurant_name)}</div>
          <div class="prospect-address">${esc(d.address_normalized || d.address_input)}</div>
          <button class="btn btn-secondary btn-small" data-action="open-existing" data-id="${d.id}">Open Existing</button>
        </div>
      `
        )
        .join('')}

      <div class="btn-row">
        <button class="btn btn-secondary" id="btn-cancel-dup" style="flex:1;">Cancel</button>
        <button class="btn btn-primary" id="btn-save-anyway" style="flex:1;" ${submitting ? 'disabled' : ''}>
          ${submitting ? 'Saving...' : 'Save Anyway'}
        </button>
      </div>
    </section>
  `;

  document.getElementById('btn-cancel-dup')?.addEventListener('click', () => {
    resetAddState();
    view = 'list';
    render();
  });
  document.getElementById('btn-save-anyway')?.addEventListener('click', confirmAddDespiteDuplicate);

  document.querySelectorAll('[data-action="open-existing"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedProspectId = btn.getAttribute('data-id');
      resetAddState();
      view = 'detail';
      render();
    });
  });
}

// ─── Render: Detail ────────────────────────────────────
function renderDetail() {
  const prospect = getProspectById(selectedProspectId || '');
  if (!prospect) {
    view = 'list';
    render();
    return;
  }

  const displayAddr = prospect.address_normalized || prospect.address_input;

  appEl.innerHTML = `
    <header class="app-header">
      <button class="btn btn-back" id="btn-back-detail">← Back</button>
      <h1 class="app-title" style="font-size:1.25rem;">${esc(prospect.restaurant_name)}</h1>
    </header>

    ${errorMessage ? `<div class="error-banner">${esc(errorMessage)}</div>` : ''}

    <section class="card">
      <div class="detail-section">
        <div class="detail-label">Address</div>
        <div class="detail-value">${esc(displayAddr)}</div>
        ${prospect.address_input !== prospect.address_normalized && prospect.address_normalized ? `<div class="detail-muted">Original: ${esc(prospect.address_input)}</div>` : ''}
      </div>

      ${prospect.latitude !== null ? `
      <div class="detail-section">
        <div class="detail-label">Coordinates</div>
        <div class="detail-value detail-coords">📍 ${prospect.latitude.toFixed(5)}, ${prospect.longitude!.toFixed(5)}</div>
      </div>
      ` : ''}

      <div class="detail-section">
        <div class="detail-label">Status</div>
        <div class="detail-value">
          ${prospect.dropped_off
            ? `<span class="badge badge-dropped">✓ Dropped Off</span>
               <div class="detail-muted">${prospect.dropped_off_at ? new Date(prospect.dropped_off_at).toLocaleString() : ''}</div>`
            : `<span class="badge badge-pending">Not Dropped Off</span>`
          }
        </div>
      </div>

      ${prospect.archived ? `<div class="detail-section"><div class="detail-label"></div><div class="detail-value"><span class="badge badge-archived">Archived</span></div></div>` : ''}

      <div class="detail-section">
        <div class="detail-label">Created</div>
        <div class="detail-value detail-muted">${new Date(prospect.created_at).toLocaleString()}</div>
      </div>
    </section>

    <section class="card">
      <div class="detail-actions">
        ${!prospect.archived ? `
          <button class="btn btn-status ${prospect.dropped_off ? 'dropped' : 'pending'} btn-full" id="btn-toggle-status">
            ${prospect.dropped_off ? '✓ Dropped Off — Undo' : 'Mark Dropped Off'}
          </button>
          <button class="btn btn-secondary btn-full" id="btn-edit">✏️ Edit Prospect</button>
          <button class="btn btn-secondary btn-full" id="btn-archive">📦 Archive Prospect</button>
        ` : `
          <button class="btn btn-primary btn-full" id="btn-restore">↩️ Restore Prospect</button>
        `}
        <button class="btn btn-danger btn-full" id="btn-delete">🗑️ Delete Permanently</button>
      </div>
    </section>
  `;

  document.getElementById('btn-back-detail')?.addEventListener('click', () => {
    selectedProspectId = null;
    view = 'list';
    render();
  });
  document.getElementById('btn-toggle-status')?.addEventListener('click', () => {
    handleToggleStatus(prospect.id, prospect.dropped_off);
  });
  document.getElementById('btn-edit')?.addEventListener('click', () => {
    startEdit(prospect);
  });
  document.getElementById('btn-archive')?.addEventListener('click', () => {
    handleArchive(prospect.id);
  });
  document.getElementById('btn-restore')?.addEventListener('click', () => {
    handleRestore(prospect.id);
  });
  document.getElementById('btn-delete')?.addEventListener('click', () => {
    handleDelete(prospect.id);
  });
}

// ─── Render: Edit ──────────────────────────────────────
function renderEdit() {
  const prospect = getProspectById(selectedProspectId || '');
  if (!prospect) { view = 'list'; render(); return; }

  if (editStep === 'duplicate') {
    renderEditDuplicate();
    return;
  }
  if (editStep === 'confirm') {
    renderEditConfirm();
    return;
  }

  appEl.innerHTML = `
    <header class="app-header">
      <button class="btn btn-back" id="btn-back-edit">← Cancel</button>
      <h1 class="app-title" style="font-size:1.25rem;">Edit Prospect</h1>
    </header>

    ${errorMessage ? `<div class="error-banner">${esc(errorMessage)}</div>` : ''}

    <section class="card">
      <form id="edit-prospect-form">
        <div class="form-group">
          <label class="form-label" for="edit_restaurant_name">Restaurant / Business Name</label>
          <input type="text" id="edit_restaurant_name" class="form-input" value="${esc(editName)}" required maxlength="200" ${submitting ? 'disabled' : ''} />
        </div>

        <div class="form-group autocomplete-wrapper">
          <label class="form-label" for="edit_address_input">Address</label>
          <input type="text" id="edit_address_input" class="form-input" value="${esc(editAddress)}" required maxlength="500" autocomplete="off" ${submitting ? 'disabled' : ''} />
          ${editAutocompleteVisible
            ? `<div class="autocomplete-dropdown">
                ${editAutocompleteSuggestions.map(s => `
                  <button type="button" class="autocomplete-item" data-index="${editAutocompleteSuggestions.indexOf(s)}">
                    <span class="autocomplete-label">${esc(s.formatted)}</span>
                  </button>
                `).join('')}
              </div>`
            : ''}
        </div>

        <button type="submit" class="btn btn-primary" style="width:100%;" ${submitting ? 'disabled' : ''}>
          ${submitting ? 'Checking address...' : 'Save Changes'}
        </button>
      </form>
    </section>
  `;

  document.getElementById('btn-back-edit')?.addEventListener('click', () => {
    view = 'detail';
    render();
  });

  const form = document.getElementById('edit-prospect-form');
  form?.addEventListener('submit', (e) => handleEditSubmit(e as SubmitEvent));

  const addrInput = document.getElementById('edit_address_input') as HTMLInputElement;
  addrInput?.addEventListener('input', () => {
    editAddress = addrInput.value;
    triggerAutocomplete(
      addrInput.value,
      (s) => { editAutocompleteSuggestions = s; },
      (v) => { editAutocompleteVisible = v; },
      { current: editAutocompleteAbort },
      { current: editAutocompleteDebounce }
    );
    render();
  });

  document.querySelectorAll('#edit-prospect-form .autocomplete-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-index') || '0');
      if (editAutocompleteSuggestions[idx]) {
        selectEditSuggestion(editAutocompleteSuggestions[idx]);
      }
    });
  });
}

function renderEditConfirm() {
  appEl.innerHTML = `
    <header class="app-header">
      <button class="btn btn-back" id="btn-back-edit-confirm">← Back</button>
      <h1 class="app-title" style="font-size:1.25rem;">Confirm Changes</h1>
    </header>

    <section class="card">
      <div class="confirm-detail">
        <h2 class="confirm-name">${esc(editName)}</h2>
        <p class="confirm-address">${esc(editNormalized || editAddress)}</p>
        ${editLat !== null ? `<p class="confirm-coords">📍 ${editLat!.toFixed(5)}, ${editLon!.toFixed(5)}</p>` : ''}
      </div>

      <div class="btn-row">
        <button class="btn btn-secondary" id="btn-cancel-edit" style="flex:1;">Cancel</button>
        <button class="btn btn-primary" id="btn-confirm-edit" style="flex:1;" ${submitting ? 'disabled' : ''}>
          ${submitting ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </section>
  `;

  document.getElementById('btn-back-edit-confirm')?.addEventListener('click', () => {
    editStep = 'entry';
    render();
  });
  document.getElementById('btn-cancel-edit')?.addEventListener('click', () => {
    view = 'detail';
    render();
  });
  document.getElementById('btn-confirm-edit')?.addEventListener('click', confirmEditProspect);
}

function renderEditDuplicate() {
  appEl.innerHTML = `
    <header class="app-header">
      <h1 class="app-title" style="font-size:1.25rem;">Possible Duplicate</h1>
    </header>

    <section class="card">
      <div class="warning-banner">This change would create what appears to be a duplicate.</div>

      ${editDuplicates.map(d => `
        <div class="duplicate-card">
          <div class="prospect-name">${esc(d.restaurant_name)}</div>
          <div class="prospect-address">${esc(d.address_normalized || d.address_input)}</div>
        </div>
      `).join('')}

      <div class="btn-row">
        <button class="btn btn-secondary" id="btn-cancel-edit-dup" style="flex:1;">Cancel</button>
        <button class="btn btn-primary" id="btn-save-edit-anyway" style="flex:1;" ${submitting ? 'disabled' : ''}>
          ${submitting ? 'Saving...' : 'Save Anyway'}
        </button>
      </div>
    </section>
  `;

  document.getElementById('btn-cancel-edit-dup')?.addEventListener('click', () => {
    view = 'detail';
    render();
  });
  document.getElementById('btn-save-edit-anyway')?.addEventListener('click', confirmEditDespiteDuplicate);
}

// ─── Render: Archived ──────────────────────────────────
function renderArchived() {
  const archived = archivedProspects.filter((p) => p.archived);

  appEl.innerHTML = `
    <header class="app-header">
      <button class="btn btn-back" id="btn-back-archived">← Back</button>
      <h1 class="app-title" style="font-size:1.25rem;">Archived Prospects</h1>
    </header>

    <section class="card">
      <div class="card-title">
        <span>Archived</span>
        <span class="badge badge-pending">${archived.length} archived</span>
      </div>

      ${archived.length === 0
        ? '<div class="empty-state">No archived prospects.</div>'
        : `<div class="prospect-list">
            ${archived.map(p => `
              <div class="prospect-item" data-id="${p.id}">
                <div class="prospect-info">
                  <div class="prospect-name">${esc(p.restaurant_name)}</div>
                  <div class="prospect-address">${esc(p.address_normalized || p.address_input)}</div>
                </div>
                <div class="prospect-actions-row">
                  <button class="btn btn-small btn-primary" data-action="restore" data-id="${p.id}">Restore</button>
                </div>
              </div>
            `).join('')}
          </div>`
      }
    </section>
  `;

  document.getElementById('btn-back-archived')?.addEventListener('click', () => {
    view = 'list';
    render();
  });

  document.querySelectorAll('[data-action="restore"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      handleRestore(btn.getAttribute('data-id')!);
    });
  });
}

// ─── Utilities ─────────────────────────────────────────
function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── Bootstrap ─────────────────────────────────────────
loadData();
