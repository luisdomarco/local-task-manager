// A fixed "today" for the date logic: Thursday 2026-10-15 (ISO week 2026-W42), local time.
import { mock } from 'node:test';

export const TODAY = '2026-10-15';

export function freezeDate() {
  mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 15, 12, 0, 0) });
}

export function unfreezeDate() {
  mock.timers.reset();
}
