// Module P5 (Caisse Terrain): a minimal LocalStorage-backed offline queue.
// Caisse Express runs on field agents' phones where connectivity can drop
// mid-day; every quick entry is written here first, then flushed to
// POST /transactions/batch once back online. No IndexedDB/idb dependency --
// the payload is tiny (a handful of pending cash entries) so localStorage's
// synchronous API keeps this simple and dependency-free.
import type { TransactionInput } from "@workspace/api-client-react"

const STORAGE_KEY = "m15audit.caisse.offlineQueue"

export interface QueuedEntry {
  localId: string
  queuedAt: string
  input: TransactionInput
}

function readAll(): QueuedEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAll(entries: QueuedEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
}

export function listQueuedEntries(): QueuedEntry[] {
  return readAll()
}

export function enqueueEntry(input: TransactionInput): QueuedEntry {
  const entry: QueuedEntry = {
    localId: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    queuedAt: new Date().toISOString(),
    input,
  }
  writeAll([...readAll(), entry])
  return entry
}

export function removeQueuedEntries(localIds: string[]) {
  const idSet = new Set(localIds)
  writeAll(readAll().filter((e) => !idSet.has(e.localId)))
}

export function clearQueue() {
  writeAll([])
}
