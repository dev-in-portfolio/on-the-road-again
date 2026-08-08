export interface Prospect {
  id: string;
  restaurant_name: string;
  address_input: string;
  address_normalized: string | null;
  latitude: number | null;
  longitude: number | null;
  geocode_provider: string | null;
  geocode_reference: string | null;
  dropped_off: boolean;
  dropped_off_at: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateProspectInput {
  restaurant_name: string;
  address_input: string;
  address_normalized?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  geocode_provider?: string | null;
  geocode_reference?: string | null;
  skip_duplicate_check?: boolean;
}

export interface UpdateProspectInput {
  id: string;
  restaurant_name?: string;
  address_input?: string;
  address_normalized?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  geocode_provider?: string | null;
  geocode_reference?: string | null;
  dropped_off?: boolean;
  archived?: boolean;
  skip_duplicate_check?: boolean;
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

export interface GeocodeSearchResponse {
  results: GeocodeResult[];
  isPrecise: boolean;
  best: GeocodeResult;
}

export interface DuplicateResponse {
  error: string;
  duplicates: Prospect[];
  code: string;
}
