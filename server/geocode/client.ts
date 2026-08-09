const GEOAPIFY_BASE = 'https://api.geoapify.com/v1/geocode';

export interface GeoapifyAddressFeature {
  type: 'Feature';
  properties: {
    datasource?: Record<string, unknown>;
    country?: string;
    country_code?: string;
    state?: string;
    county?: string;
    city?: string;
    postcode?: string;
    street?: string;
    housenumber?: string;
    name?: string;
    lon: number;
    lat: number;
    result_type?: string;
    formatted: string;
    address_line1: string;
    address_line2: string;
    rank?: {
      confidence?: number;
      confidence_city_level?: number;
      match_type?: string;
    };
    place_id?: string;
  };
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
}

export interface GeoapifyResponse {
  type: 'FeatureCollection';
  features: GeoapifyAddressFeature[];
}

export interface AutocompleteSuggestion {
  label: string;
  value: string;
  formatted: string;
  lat: number;
  lon: number;
  resultType: string;
  placeId: string;
  confidence: number;
}

export interface GeocodeResult {
  formatted: string;
  lat: number;
  lon: number;
  resultType: string;
  placeId: string;
  confidence: number;
  addressLine1: string;
  addressLine2: string;
}

const HIGH_PRECISION_TYPES = new Set([
  'building',
  'amenity',
  'house',
  'street',
  'office',
  'shop',
  'restaurant',
  'cafe',
  'hotel',
]);

export function isHighPrecisionResult(resultType: string | undefined): boolean {
  if (!resultType) return false;
  return HIGH_PRECISION_TYPES.has(resultType);
}

function getApiKey(): string {
  const key = process.env.GEOAPIFY_API_KEY;
  if (!key) {
    throw new Error(
      'GEOAPIFY_API_KEY is not configured. Please add it to your Netlify environment variables.'
    );
  }
  return key;
}

export async function geocodeAutocomplete(
  text: string
): Promise<AutocompleteSuggestion[]> {
  const apiKey = getApiKey();
  const url = `${GEOAPIFY_BASE}/autocomplete?text=${encodeURIComponent(text)}&apiKey=${apiKey}&format=geojson&limit=5`;

  const res = await fetch(url);
  if (!res.ok) {
    const errorText = await res.text().catch(() => 'Unknown error');
    throw new Error(`Geoapify autocomplete failed (${res.status}): ${errorText}`);
  }

  const data: GeoapifyResponse = await res.json();

  return data.features.map((f) => ({
    label: f.properties.formatted,
    value: f.properties.formatted,
    formatted: f.properties.formatted,
    lat: f.properties.lat,
    lon: f.properties.lon,
    resultType: f.properties.result_type || 'unknown',
    placeId: f.properties.place_id || '',
    confidence: f.properties.rank?.confidence ?? 0.5,
  }));
}

export async function geocodeSearch(
  text: string
): Promise<GeocodeResult[]> {
  const apiKey = getApiKey();
  const url = `${GEOAPIFY_BASE}/search?text=${encodeURIComponent(text)}&apiKey=${apiKey}&format=geojson&limit=3`;

  const res = await fetch(url);
  if (!res.ok) {
    const errorText = await res.text().catch(() => 'Unknown error');
    throw new Error(`Geoapify search failed (${res.status}): ${errorText}`);
  }

  const data: GeoapifyResponse = await res.json();

  return data.features.map((f) => ({
    formatted: f.properties.formatted,
    lat: f.properties.lat,
    lon: f.properties.lon,
    resultType: f.properties.result_type || 'unknown',
    placeId: f.properties.place_id || '',
    confidence: f.properties.rank?.confidence ?? 0.5,
    addressLine1: f.properties.address_line1,
    addressLine2: f.properties.address_line2,
  }));
}
