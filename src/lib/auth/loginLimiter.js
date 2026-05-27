const MAX_FAILS_BEFORE_LOCK = 5;
const LOCK_STEPS_MS = [30_000, 120_000, 600_000, 1_800_000];
const FAIL_WINDOW_MS = 60 * 60 * 1000;

const attempts = new Map();

function now() {
  return Date.now();
}

function getEntry(ip) {
  const entry = attempts.get(ip);
  if (!entry) return null;
  if (entry.lastFailAt && now() - entry.lastFailAt > FAIL_WINDOW_MS && (!entry.lockUntil || now() >= entry.lockUntil)) {
    attempts.delete(ip);
    return null;
  }
  return entry;
}

export function checkLock(ip) {
  const entry = getEntry(ip);
  if (!entry?.lockUntil) return { locked: false };
  const remaining = entry.lockUntil - now();
  if (remaining <= 0) return { locked: false };
  return { locked: true, retryAfter: Math.ceil(remaining / 1000) };
}

export function recordFail(ip) {
  const entry = getEntry(ip) || { fails: 0, lockUntil: 0, lockLevel: 0, lastFailAt: 0 };
  entry.fails += 1;
  entry.lastFailAt = now();
  if (entry.fails >= MAX_FAILS_BEFORE_LOCK) {
    const step = LOCK_STEPS_MS[Math.min(entry.lockLevel, LOCK_STEPS_MS.length - 1)];
    entry.lockUntil = now() + step;
    entry.lockLevel += 1;
    entry.fails = 0;
  }
  attempts.set(ip, entry);
  return { remainingBeforeLock: Math.max(0, MAX_FAILS_BEFORE_LOCK - entry.fails) };
}

export function recordSuccess(ip) {
  attempts.delete(ip);
}

export function getClientIp(request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}
