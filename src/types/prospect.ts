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
}

export interface UpdateProspectInput {
  restaurant_name?: string;
  address_input?: string;
  address_normalized?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  geocode_provider?: string | null;
  geocode_reference?: string | null;
  dropped_off?: boolean;
  archived?: boolean;
}
