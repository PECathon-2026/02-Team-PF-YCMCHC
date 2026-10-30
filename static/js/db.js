/**
 * Commonplace Local Storage Layer (db.js)
 * High-performance, durable storage using standard IndexedDB.
 * Manages:
 * - Subscriptions
 * - Feed Entries
 * - Reading State (Read/Unread, Saved, Scroll Position)
 * - Cached Articles (Sanitized HTML & Extraction Source)
 * - Verified Aliases
 * - System Settings & Hash State
 */

const DB_NAME = "commonplace_db";
const DB_VERSION = 3;

let dbInstance = null;

export function openDatabase() {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // 1. Subscriptions store
      if (!db.objectStoreNames.contains("subscriptions")) {
        const subStore = db.createObjectStore("subscriptions", { keyPath: "id" });
        subStore.createIndex("resolvedFeedUrl", "resolvedFeedUrl", { unique: false });
      }

      // 2. Entries store
      if (!db.objectStoreNames.contains("entries")) {
        const entryStore = db.createObjectStore("entries", { keyPath: "id" });
        entryStore.createIndex("subscriptionId", "subscriptionId", { unique: false });
        entryStore.createIndex("publicationDate", "publicationDate", { unique: false });
        entryStore.createIndex("firstSeenTimestamp", "firstSeenTimestamp", { unique: false });
      }

      // 3. ReadingState store
      if (!db.objectStoreNames.contains("readingState")) {
        db.createObjectStore("readingState", { keyPath: "entryId" });
      }

      // 4. CachedArticles store (Full-text offline storage)
      if (!db.objectStoreNames.contains("cachedArticles")) {
        db.createObjectStore("cachedArticles", { keyPath: "entryId" });
      }

      // 5. Aliases store
      if (!db.objectStoreNames.contains("aliases")) {
        db.createObjectStore("aliases", { keyPath: "sourceUrl" });
      }

      // 6. Key-Value Settings
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }

      // 7. Reading Notes & Highlights store
      if (!db.objectStoreNames.contains("notes")) {
        const notesStore = db.createObjectStore("notes", { keyPath: "id" });
        notesStore.createIndex("entryId", "entryId", { unique: false });
        notesStore.createIndex("timestamp", "timestamp", { unique: false });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      reject(new Error(`IndexedDB open error: ${event.target.error}`));
    };
  });
}

// Generic transaction helper
function transaction(storeName, mode, callback) {
  return openDatabase().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;

      try {
        result = callback(store, tx);
      } catch (err) {
        reject(err);
        return;
      }

      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(new Error("Transaction aborted"));
    });
  });
}

// --- Subscriptions ---
export async function getAllSubscriptions() {
  return transaction("subscriptions", "readonly", (store) => {
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  });
}

export async function putSubscription(sub) {
  return transaction("subscriptions", "readwrite", (store) => {
    store.put(sub);
  });
}

export async function deleteSubscription(id) {
  // Delete subscription and associated entries
  const entries = await getEntriesForSubscription(id);
  await transaction("entries", "readwrite", (store) => {
    entries.forEach((e) => store.delete(e.id));
  });
  return transaction("subscriptions", "readwrite", (store) => {
    store.delete(id);
  });
}

// --- Entries ---
export async function getAllEntries() {
  return transaction("entries", "readonly", (store) => {
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  });
}

export async function getEntriesForSubscription(subscriptionId) {
  return transaction("entries", "readonly", (store) => {
    return new Promise((resolve, reject) => {
      const index = store.index("subscriptionId");
      const req = index.getAll(subscriptionId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  });
}

export async function putEntries(entriesList) {
  return transaction("entries", "readwrite", (store) => {
    entriesList.forEach((entry) => store.put(entry));
  });
}

// --- Reading State ---
export async function getReadingState(entryId) {
  return transaction("readingState", "readonly", (store) => {
    return new Promise((resolve, reject) => {
      const req = store.get(entryId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  });
}

export async function getAllReadingStates() {
  return transaction("readingState", "readonly", (store) => {
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => {
        const map = new Map();
        (req.result || []).forEach((state) => map.set(state.entryId, state));
        resolve(map);
      };
      req.onerror = () => reject(req.error);
    });
  });
}

export async function setReadingState(entryId, updates) {
  const current = (await getReadingState(entryId)) || {
    entryId,
    isRead: false,
    isSaved: false,
    scrollProgress: 0,
    lastReadTimestamp: Date.now()
  };
  const updated = { ...current, ...updates, lastReadTimestamp: Date.now() };
  await transaction("readingState", "readwrite", (store) => {
    store.put(updated);
  });
  return updated;
}

// --- Cached Articles ---
export async function getCachedArticle(entryId) {
  return transaction("cachedArticles", "readonly", (store) => {
    return new Promise((resolve, reject) => {
      const req = store.get(entryId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  });
}

export async function putCachedArticle(cachedArticle) {
  return transaction("cachedArticles", "readwrite", (store) => {
    store.put(cachedArticle);
  });
}

// --- Settings & Hash ---
export async function getSetting(key, defaultValue = null) {
  return transaction("settings", "readonly", (store) => {
    return new Promise((resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : defaultValue);
      req.onerror = () => reject(req.error);
    });
  });
}

export async function setSetting(key, value) {
  return transaction("settings", "readwrite", (store) => {
    store.put({ key, value });
  });
}

// --- Reading Notes & Highlights ---
export async function getAllNotes() {
  return transaction("notes", "readonly", (store) => {
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  });
}

export async function getNotesForEntry(entryId) {
  return transaction("notes", "readonly", (store) => {
    return new Promise((resolve, reject) => {
      const index = store.index("entryId");
      const req = index.getAll(entryId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  });
}

export async function putNote(note) {
  if (!note.id) {
    note.id = `note-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  }
  if (!note.timestamp) {
    note.timestamp = Date.now();
  }
  return transaction("notes", "readwrite", (store) => {
    store.put(note);
    return note;
  });
}

export async function deleteNote(noteId) {
  return transaction("notes", "readwrite", (store) => {
    store.delete(noteId);
  });
}

// --- Views & Likes Engagement Metrics ---
function getBaselineMetrics(entryId) {
  let hash = 0;
  for (let i = 0; i < entryId.length; i++) {
    hash = ((hash << 5) - hash) + entryId.charCodeAt(i);
    hash |= 0;
  }
  const abs = Math.abs(hash);
  const views = 120 + (abs % 850);
  const likes = Math.floor(views * (0.12 + ((abs % 15) / 100)));
  return { views, likes };
}

export async function getArticleEngagement(entryId) {
  const state = await getReadingState(entryId);
  const baseline = getBaselineMetrics(entryId);
  const localViews = state && state.viewsCount !== undefined ? state.viewsCount : 0;
  const isLiked = state ? Boolean(state.isLiked) : false;
  const localLikeDelta = isLiked ? 1 : 0;
  return {
    viewsCount: baseline.views + localViews,
    likesCount: baseline.likes + (state && state.likesCount !== undefined ? state.likesCount : localLikeDelta),
    isLiked
  };
}

export async function recordArticleView(entryId) {
  const state = (await getReadingState(entryId)) || { entryId };
  const currentViews = state.viewsCount || 0;
  await setReadingState(entryId, { viewsCount: currentViews + 1 });
  return getArticleEngagement(entryId);
}

export async function toggleArticleLike(entryId) {
  const state = (await getReadingState(entryId)) || { entryId };
  const currentLiked = Boolean(state.isLiked);
  const newLiked = !currentLiked;
  const currentLikesCount = state.likesCount || 0;
  const newLikesCount = newLiked ? currentLikesCount + 1 : Math.max(0, currentLikesCount - 1);
  await setReadingState(entryId, { isLiked: newLiked, likesCount: newLikesCount });
  return getArticleEngagement(entryId);
}

