// Converse — Conversation Storage
// IndexedDB layer for indexing and searching Claude conversations.
// Exposed as window.converseStorage for consumption by content.js.

const DB_NAME = "ConverseSearch";
const DB_VERSION = 1;
const STORE_CONVERSATIONS = "conversations";
const STORE_METADATA = "metadata";

class ConversationStorage {
  constructor() {
    this._db = null;
    this._ready = this._open();
  }

  // -------------------------------------------------------------------------
  // Init
  // -------------------------------------------------------------------------

  async _open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onerror = () => reject(req.error);

      req.onsuccess = () => {
        this._db = req.result;
        resolve();
      };

      req.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains(STORE_CONVERSATIONS)) {
          const store = db.createObjectStore(STORE_CONVERSATIONS, { keyPath: "uuid" });
          store.createIndex("created_at", "created_at", { unique: false });
          store.createIndex("updated_at", "updated_at", { unique: false });
          store.createIndex("name", "name", { unique: false });
          // Denormalised full-text field — rebuilt on every write.
          store.createIndex("searchText", "searchText", { unique: false });
        }

        if (!db.objectStoreNames.contains(STORE_METADATA)) {
          db.createObjectStore(STORE_METADATA, { keyPath: "key" });
        }
      };
    });
  }

  async _ensureReady() {
    await this._ready;
  }

  // -------------------------------------------------------------------------
  // Write
  // -------------------------------------------------------------------------

  async saveConversation(conversation) {
    await this._ensureReady();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction([STORE_CONVERSATIONS], "readwrite");
      const store = tx.objectStore(STORE_CONVERSATIONS);
      const req = store.put({
        ...conversation,
        searchText: this._buildSearchText(conversation),
        cachedAt: new Date().toISOString(),
      });
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async saveConversations(conversations) {
    await this._ensureReady();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction([STORE_CONVERSATIONS], "readwrite");
      const store = tx.objectStore(STORE_CONVERSATIONS);
      let remaining = conversations.length;

      if (remaining === 0) {
        resolve(0);
        return;
      }

      for (const conv of conversations) {
        const req = store.put({
          ...conv,
          searchText: this._buildSearchText(conv),
          cachedAt: new Date().toISOString(),
        });
        req.onsuccess = () => {
          remaining -= 1;
          if (remaining === 0) resolve(conversations.length);
        };
        req.onerror = () => reject(req.error);
      }
    });
  }

  async setMetadata(key, value) {
    await this._ensureReady();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction([STORE_METADATA], "readwrite");
      const store = tx.objectStore(STORE_METADATA);
      const req = store.put({ key, value });
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  async getConversation(uuid) {
    await this._ensureReady();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction([STORE_CONVERSATIONS], "readonly");
      const req = tx.objectStore(STORE_CONVERSATIONS).get(uuid);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async getAllConversations() {
    await this._ensureReady();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction([STORE_CONVERSATIONS], "readonly");
      const req = tx.objectStore(STORE_CONVERSATIONS).getAll();
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error);
    });
  }

  // Returns { [uuid]: updated_at } — used for incremental sync diffing.
  async getTimestamps() {
    await this._ensureReady();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction([STORE_CONVERSATIONS], "readonly");
      const req = tx.objectStore(STORE_CONVERSATIONS).getAll();
      req.onsuccess = () => {
        const map = {};
        for (const conv of req.result ?? []) {
          map[conv.uuid] = conv.updated_at;
        }
        resolve(map);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async getConversationCount() {
    await this._ensureReady();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction([STORE_CONVERSATIONS], "readonly");
      const req = tx.objectStore(STORE_CONVERSATIONS).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async getMetadata(key) {
    await this._ensureReady();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction([STORE_METADATA], "readonly");
      const req = tx.objectStore(STORE_METADATA).get(key);
      req.onsuccess = () => resolve(req.result?.value ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  // Approximate storage footprint using the Storage API — no data loading needed.
  async getStorageSize() {
    if (navigator.storage && navigator.storage.estimate) {
      const { usage } = await navigator.storage.estimate();
      return usage ?? 0;
    }
    return 0;
  }

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  async search(query, options = {}) {
    const { limit = 50, sortBy = "relevance" } = options;
    const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 0);

    if (terms.length === 0) return [];

    const conversations = await this.getAllConversations();
    const results = [];

    for (const conv of conversations) {
      const text = conv.searchText ?? "";
      if (!terms.every((t) => text.includes(t))) continue;

      const matchingMessages = this._matchingMessages(conv, terms);
      results.push({
        uuid: conv.uuid,
        name: conv.name || "Untitled",
        created_at: conv.created_at,
        updated_at: conv.updated_at,
        matchingMessages,
        matchCount: matchingMessages.length,
      });
    }

    return this._sorted(results, sortBy).slice(0, limit);
  }

  // -------------------------------------------------------------------------
  // Mutation
  // -------------------------------------------------------------------------

  async deleteConversation(uuid) {
    await this._ensureReady();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction([STORE_CONVERSATIONS], "readwrite");
      const req = tx.objectStore(STORE_CONVERSATIONS).delete(uuid);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async clearAll() {
    await this._ensureReady();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction([STORE_CONVERSATIONS, STORE_METADATA], "readwrite");
      tx.objectStore(STORE_CONVERSATIONS).clear();
      tx.objectStore(STORE_METADATA).clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  _buildSearchText(conversation) {
    const parts = [];

    if (conversation.name) parts.push(conversation.name);

    for (const msg of conversation.chat_messages ?? []) {
      if (msg.text) {
        parts.push(msg.text);
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === "text" && block.text) parts.push(block.text);
        }
      }

      for (const att of msg.attachments ?? []) {
        if (att.file_name) parts.push(att.file_name);
        if (att.extracted_content) parts.push(att.extracted_content);
      }
    }

    return parts.join(" ").toLowerCase();
  }

  _matchingMessages(conversation, terms) {
    const matches = [];

    for (const msg of conversation.chat_messages ?? []) {
      // Gather all text surfaces for this message — body, content blocks,
      // and attachment extracted text (mirrors _buildSearchText).
      const parts = [];

      if (msg.text) {
        parts.push(msg.text);
      } else if (Array.isArray(msg.content)) {
        for (const b of msg.content) {
          if (b.type === "text" && b.text) parts.push(b.text);
        }
      }

      for (const att of msg.attachments ?? []) {
        if (att.extracted_content) parts.push(att.extracted_content);
      }

      const text = parts.join(" ");
      if (!text.trim()) continue;

      const lower = text.toLowerCase();
      if (!terms.some((t) => lower.includes(t))) continue;

      matches.push({
        sender: msg.sender,
        snippet: this._snippet(text, terms),
        uuid: msg.uuid,
      });
    }

    // The conversation passed the full-text filter but no individual message
    // surface matched (e.g. the term only appears in the title). Return a
    // synthetic entry so matchCount is never 0 for a result that did match.
    if (matches.length === 0 && conversation.name) {
      const nameLower = conversation.name.toLowerCase();
      if (terms.some((t) => nameLower.includes(t))) {
        matches.push({
          sender: null,
          snippet: conversation.name,
          uuid: null,
        });
      }
    }

    return matches;
  }

  _snippet(text, terms, length = 160) {
    const lower = text.toLowerCase();
    let firstMatch = text.length;

    for (const term of terms) {
      const idx = lower.indexOf(term);
      if (idx !== -1 && idx < firstMatch) firstMatch = idx;
    }

    const start = Math.max(0, firstMatch - Math.floor(length / 2));
    const end = Math.min(text.length, start + length);
    let snippet = text.slice(start, end).trim();

    if (start > 0) snippet = "\u2026" + snippet;
    if (end < text.length) snippet = snippet + "\u2026";

    return snippet;
  }

  _sorted(results, sortBy) {
    switch (sortBy) {
      case "created-desc":
        return results.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      case "created-asc":
        return results.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      case "modified-desc":
        return results.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
      case "modified-asc":
        return results.sort((a, b) => new Date(a.updated_at) - new Date(b.updated_at));
      default:
        return results.sort((a, b) => {
          if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
          return new Date(b.updated_at) - new Date(a.updated_at);
        });
    }
  }
}

window.converseStorage = new ConversationStorage();
