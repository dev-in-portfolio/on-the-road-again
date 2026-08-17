import assert from 'node:assert/strict';
import test from 'node:test';
import { formatClosureTime, isClosureConflict, minuteOfDay, type ClosureObservation } from './closure-windows.ts';

const mondayOne: ClosureObservation = {
  id: 'x', prospect_id: 'p', weekday: 1, minute_of_day: 780,
  observed_at: '2026-08-17T13:08:00-04:00', note: null, created_at: '2026-08-17T17:08:00Z',
};

test('minuteOfDay uses local clock time', () => {
  const date = new Date(2026, 7, 17, 13, 8);
  assert.equal(minuteOfDay(date), 788);
});

test('same weekday within 90 minutes is a closure conflict', () => {
  assert.equal(isClosureConflict(mondayOne, new Date(2026, 7, 17, 14, 20)), true);
  assert.equal(isClosureConflict(mondayOne, new Date(2026, 7, 17, 15, 0)), false);
  assert.equal(isClosureConflict(mondayOne, new Date(2026, 7, 18, 13, 0)), false);
});

test('closure labels are field friendly', () => {
  assert.equal(formatClosureTime(mondayOne), 'Monday ~1 PM');
});
