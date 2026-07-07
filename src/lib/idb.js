// Helper mínimo de IndexedDB key-value — usado para persistir o
// FileSystemDirectoryHandle do vault Obsidian entre sessões (handles são
// structured-cloneable no Chromium, mas NÃO serializam pra localStorage).

const DB_NAME = 'jarvis-os';
const STORE = 'kv';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet(key) {
  const db = await openDb();
  try { return await tx(db, 'readonly', s => s.get(key)); } finally { db.close(); }
}

export async function idbSet(key, value) {
  const db = await openDb();
  try { return await tx(db, 'readwrite', s => s.put(value, key)); } finally { db.close(); }
}

export async function idbDel(key) {
  const db = await openDb();
  try { return await tx(db, 'readwrite', s => s.delete(key)); } finally { db.close(); }
}
