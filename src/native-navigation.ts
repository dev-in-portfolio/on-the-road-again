import { Capacitor, registerPlugin } from '@capacitor/core';

type OtraNavigationPlugin = {
  openGoogleMaps(options: { url: string }): Promise<{ opened: 'google_maps' | 'fallback' }>;
};

const OtraNavigation = registerPlugin<OtraNavigationPlugin>('OtraNavigation');

export function assertGoogleMapsUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Google Maps handoff URL is invalid.');
  }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || !['www.google.com', 'google.com', 'maps.google.com'].includes(host) || !parsed.pathname.startsWith('/maps/')) {
    throw new Error('Only Google Maps HTTPS URLs can be opened by the native handoff.');
  }
}

export async function openGoogleMapsUrl(url: string): Promise<void> {
  assertGoogleMapsUrl(url);

  if (Capacitor.getPlatform() === 'android') {
    try {
      await OtraNavigation.openGoogleMaps({ url });
      return;
    } catch {
      // Fall through to the universal URL only if the native bridge itself is unavailable.
    }
  }

  const mapsWindow = window.open(url, '_blank', 'noopener');
  if (!mapsWindow) window.location.assign(url);
}
