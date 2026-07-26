// Converse — Skill Archive Extraction
// Decodes the download-dot-skill-file response (base64 or raw bytes) into a zip,
// then extracts its text entries for indexing.
// Exposed as window.converseSkills for consumption by content.js.

(function () {
  "use strict";

  const MAX_ENTRY_BYTES = 2 * 1024 * 1024;
  const MAX_ENTRY_TEXT_CHARS = 100000;

  // Extensions that never contain searchable text — skipped before decompression.
  const BINARY_EXTENSIONS = new Set([
    "png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "svg",
    "pdf", "zip", "gz", "tgz", "tar", "bz2", "7z", "rar",
    "woff", "woff2", "ttf", "otf", "eot",
    "mp3", "mp4", "m4a", "wav", "ogg", "mov", "avi", "webm",
    "exe", "dll", "so", "dylib", "bin", "dat", "pyc", "wasm", "class", "jar",
  ]);

  const SIG_EOCD = 0x06054b50;
  const SIG_CENTRAL = 0x02014b50;

  function looksLikeZip(bytes) {
    return bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  }

  function base64ToBytes(base64) {
    const binary = atob(base64.replace(/\s+/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  // Deep-scans a parsed JSON value for a string that decodes to a zip archive.
  function findZipString(value) {
    if (typeof value === "string" && value.length > 8 && /^[A-Za-z0-9+/=\s]+$/.test(value)) {
      try {
        const bytes = base64ToBytes(value);
        if (looksLikeZip(bytes)) return bytes;
      } catch {
        // Not valid base64 — keep scanning.
      }
    }
    if (value && typeof value === "object") {
      for (const inner of Object.values(value)) {
        const hit = findZipString(inner);
        if (hit) return hit;
      }
    }
    return null;
  }

  // The endpoint's encoding is not guaranteed — accept a raw zip, a bare base64
  // body (optionally quoted), or a JSON envelope carrying the base64 somewhere.
  function toZipBytes(buffer) {
    const raw = new Uint8Array(buffer);
    if (looksLikeZip(raw)) return raw;

    let text = new TextDecoder().decode(buffer).trim();

    if (text.startsWith("{") || text.startsWith("[")) {
      const fromJson = findZipString(JSON.parse(text));
      if (fromJson) return fromJson;
      throw new Error("No skill archive found in response");
    }

    if (text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1);
    const decoded = base64ToBytes(text);
    if (!looksLikeZip(decoded)) throw new Error("Response is not a zip archive");
    return decoded;
  }

  function isBinaryPath(path) {
    if (path.startsWith("__MACOSX/")) return true;
    const dot = path.lastIndexOf(".");
    if (dot === -1) return false;
    return BINARY_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
  }

  function parseCentralDirectory(bytes, view) {
    let eocd = -1;
    const scanEnd = Math.max(0, bytes.length - 22 - 65535);
    for (let i = bytes.length - 22; i >= scanEnd; i--) {
      if (view.getUint32(i, true) === SIG_EOCD) {
        eocd = i;
        break;
      }
    }
    if (eocd === -1) throw new Error("Missing zip directory");

    const count = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);
    const entries = [];

    for (let i = 0; i < count; i++) {
      if (offset + 46 > bytes.length || view.getUint32(offset, true) !== SIG_CENTRAL) break;

      const flags = view.getUint16(offset + 8, true);
      const method = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const uncompressedSize = view.getUint32(offset + 24, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      const name = new TextDecoder().decode(
        bytes.subarray(offset + 46, offset + 46 + nameLength),
      );

      entries.push({ name, flags, method, compressedSize, uncompressedSize, localOffset });
      offset += 46 + nameLength + extraLength + commentLength;
    }

    return entries;
  }

  async function readEntryData(bytes, view, entry) {
    // The local header repeats name/extra with possibly different extra length,
    // so the data offset must be computed from the local copy.
    const local = entry.localOffset;
    const nameLength = view.getUint16(local + 26, true);
    const extraLength = view.getUint16(local + 28, true);
    const start = local + 30 + nameLength + extraLength;
    const data = bytes.subarray(start, start + entry.compressedSize);

    if (entry.method === 0) return data;
    if (entry.method === 8) {
      const stream = new Blob([data])
        .stream()
        .pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    throw new Error(`Unsupported compression method ${entry.method}`);
  }

  // Returns [{ path, text }] for every searchable entry in the archive.
  async function extractFromResponse(buffer) {
    const bytes = toZipBytes(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const files = [];

    for (const entry of parseCentralDirectory(bytes, view)) {
      const isEncrypted = (entry.flags & 0x1) !== 0;
      if (isEncrypted || entry.name.endsWith("/") || entry.uncompressedSize === 0) continue;
      if (entry.uncompressedSize > MAX_ENTRY_BYTES || isBinaryPath(entry.name)) continue;

      let data;
      try {
        data = await readEntryData(bytes, view, entry);
      } catch {
        continue;
      }

      const text = new TextDecoder("utf-8", { fatal: false }).decode(data);
      if (text.includes(String.fromCharCode(0))) continue;

      files.push({ path: entry.name, text: text.slice(0, MAX_ENTRY_TEXT_CHARS) });
    }

    return files;
  }

  window.converseSkills = { extractFromResponse };
})();
