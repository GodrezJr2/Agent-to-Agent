import { machineIdSync } from 'node-machine-id';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from '@/lib/dataDir';

const MACHINE_ID_FILE = path.join(DATA_DIR, 'machine-id');
let cachedRawId = null;

// Persist raw machine ID to file → guarantees CLI/server/middleware see same value
// even when machineIdSync fails or returns inconsistent values across runtimes.
function loadRawMachineId() {
  if (cachedRawId) return cachedRawId;
  try {
    cachedRawId = fs.readFileSync(MACHINE_ID_FILE, 'utf8').trim();
    if (cachedRawId) return cachedRawId;
  } catch {}
  try {
    cachedRawId = machineIdSync();
  } catch {
    cachedRawId = crypto.randomUUID();
  }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(MACHINE_ID_FILE, cachedRawId, { mode: 0o600 });
  } catch {}
  return cachedRawId;
}

export async function getConsistentMachineId(salt = null) {
  const saltValue = salt || process.env.MACHINE_ID_SALT || 'endpoint-proxy-salt';
  const raw = loadRawMachineId();
  return crypto.createHash('sha256').update(raw + saltValue).digest('hex').substring(0, 16);
}

export async function getRawMachineId() {
  return loadRawMachineId();
}

/**
 * Check if we're running in browser or server environment
 * @returns {boolean} True if in browser, false if in server
 */
export function isBrowser() {
  return typeof window !== 'undefined';
}
