import { fetchProspects, createProspect, toggleDroppedOff } from './api/client';
import { Prospect } from './types/prospect';

const appEl = document.getElementById('app');

let prospects: Prospect[] = [];
let loading = true;
let errorMessage: string | null = null;
let submitting = false;

async function loadData() {
  loading = true;
  errorMessage = null;
  render();

  try {
    prospects = await fetchProspects();
  } catch (err: unknown) {
    errorMessage = err instanceof Error ? err.message : 'Failed to connect to database API.';
  } finally {
    loading = false;
    render();
  }
}

async function handleAddProspect(e: SubmitEvent) {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const nameInput = form.querySelector('#restaurant_name') as HTMLInputElement;
  const addressInput = form.querySelector('#address_input') as HTMLInputElement;

  const name = nameInput.value.trim();
  const address = addressInput.value.trim();

  if (!name || !address) return;

  submitting = true;
  errorMessage = null;
  render();

  try {
    const newProspect = await createProspect({
      restaurant_name: name,
      address_input: address,
    });
    prospects.unshift(newProspect);
    form.reset();
  } catch (err: unknown) {
    errorMessage = err instanceof Error ? err.message : 'Failed to save prospect.';
  } finally {
    submitting = false;
    render();
  }
}

async function handleToggleStatus(id: string, currentDroppedOff: boolean) {
  try {
    const updated = await toggleDroppedOff(id, currentDroppedOff);
    prospects = prospects.map((p) => (p.id === id ? updated : p));
    render();
  } catch (err: unknown) {
    errorMessage = err instanceof Error ? err.message : 'Failed to update status.';
    render();
  }
}

function render() {
  if (!appEl) return;

  const prospectCount = prospects.length;

  appEl.innerHTML = `
    <header class="app-header">
      <h1 class="app-title">ON THE ROAD AGAIN</h1>
      <p class="app-subtitle">Field Sales Restaurant Prospecting</p>
    </header>

    ${errorMessage ? `<div class="error-banner">${escapeHtml(errorMessage)}</div>` : ''}

    <section class="card">
      <h2 class="card-title">Add Prospect</h2>
      <form id="add-prospect-form">
        <div class="form-group" style="margin-bottom: 0.75rem;">
          <label class="form-label" for="restaurant_name">Restaurant / Business Name</label>
          <input
            type="text"
            id="restaurant_name"
            class="form-input"
            placeholder="e.g. Luigi's Trattoria"
            required
            ${submitting ? 'disabled' : ''}
          />
        </div>
        <div class="form-group" style="margin-bottom: 1rem;">
          <label class="form-label" for="address_input">Address</label>
          <input
            type="text"
            id="address_input"
            class="form-input"
            placeholder="e.g. 123 Main St, San Francisco, CA"
            required
            ${submitting ? 'disabled' : ''}
          />
        </div>
        <button type="submit" class="btn btn-primary" style="width: 100%;" ${submitting ? 'disabled' : ''}>
          ${submitting ? 'Saving...' : '+ Add Prospect'}
        </button>
      </form>
    </section>

    <section class="card">
      <div class="card-title">
        <span>Prospects</span>
        <span class="badge badge-pending">${prospectCount} saved</span>
      </div>

      ${
        loading
          ? '<div class="empty-state">Loading prospects from database...</div>'
          : prospects.length === 0
          ? '<div class="empty-state">No prospects saved yet. Add one above to get started.</div>'
          : `<div class="prospect-list">
              ${prospects
                .map(
                  (p) => `
                <div class="prospect-item" data-id="${p.id}">
                  <div class="prospect-info">
                    <div class="prospect-name">${escapeHtml(p.restaurant_name)}</div>
                    <div class="prospect-address">${escapeHtml(p.address_input)}</div>
                  </div>
                  <button
                    class="btn btn-status ${p.dropped_off ? 'dropped' : 'pending'}"
                    data-action="toggle-status"
                    data-id="${p.id}"
                    data-dropped="${p.dropped_off}"
                  >
                    ${p.dropped_off ? '✓ Dropped Off' : 'Mark Dropped Off'}
                  </button>
                </div>
              `
                )
                .join('')}
            </div>`
      }
    </section>
  `;

  // Attach event listeners
  const form = document.getElementById('add-prospect-form');
  if (form) {
    form.addEventListener('submit', (e) => handleAddProspect(e as SubmitEvent));
  }

  const buttons = document.querySelectorAll('[data-action="toggle-status"]');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const isDropped = btn.getAttribute('data-dropped') === 'true';
      if (id) {
        handleToggleStatus(id, isDropped);
      }
    });
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Initial load
loadData();
