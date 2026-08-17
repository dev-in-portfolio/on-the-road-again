export type ClosureObservation = {
  id: string;
  prospect_id: string;
  weekday: number;
  minute_of_day: number;
  observed_at: string;
  note: string | null;
  created_at: string;
};

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function minuteOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

export function isClosureConflict(observation: ClosureObservation, date = new Date(), toleranceMinutes = 90): boolean {
  if (observation.weekday !== date.getDay()) return false;
  return Math.abs(observation.minute_of_day - minuteOfDay(date)) <= toleranceMinutes;
}

export function formatClosureTime(observation: ClosureObservation): string {
  const hours24 = Math.floor(observation.minute_of_day / 60);
  const minutes = observation.minute_of_day % 60;
  const suffix = hours24 >= 12 ? 'PM' : 'AM';
  const hour = hours24 % 12 || 12;
  const minuteText = minutes ? `:${String(minutes).padStart(2, '0')}` : '';
  return `${DAYS[observation.weekday] || 'Unknown day'} ~${hour}${minuteText} ${suffix}`;
}
