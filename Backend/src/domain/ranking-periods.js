// Stage 31 — Ranking period boundaries.
//
// Pure functions only, same boundary as family-level-curve.js /
// family-titles.js: no I/O, no Date.now() default baked in silently --
// every function takes `now` explicitly so callers (and tests) always
// control the clock instead of the code reaching for the real clock on
// its own. ../../services/ranking.service.js is the only caller.
//
// All boundaries are UTC-based (using the Date object's UTC getters/
// setters), so a period boundary never depends on the server's local
// timezone -- two servers in different timezones must agree on when
// "today" starts and ends for a global leaderboard.

const PERIODS = Object.freeze(['daily', 'weekly', 'monthly', 'all']);

function assertValidPeriod(period) {
  if (!PERIODS.includes(period)) {
    throw Object.assign(new Error(`period must be one of ${PERIODS.join(', ')}`), { status: 400 });
  }
}

// Start-of-day in UTC for the given instant.
function startOfUtcDay(now) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// Start of the ISO week (Monday) in UTC containing `now`.
function startOfUtcWeek(now) {
  const day = startOfUtcDay(now);
  const weekday = day.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const daysSinceMonday = weekday === 0 ? 6 : weekday - 1;
  day.setUTCDate(day.getUTCDate() - daysSinceMonday);
  return day;
}

// Start of the calendar month in UTC containing `now`.
function startOfUtcMonth(now) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

// Returns the inclusive lower bound (a Date) for aggregating a ranking
// over `period`, as of `now`. Returns `null` for 'all' -- there is no
// lower bound, every gift/contribution ever recorded counts.
function periodStart(period, now = new Date()) {
  assertValidPeriod(period);
  if (period === 'daily') return startOfUtcDay(now);
  if (period === 'weekly') return startOfUtcWeek(now);
  if (period === 'monthly') return startOfUtcMonth(now);
  return null; // 'all'
}

module.exports = { PERIODS, assertValidPeriod, periodStart };
