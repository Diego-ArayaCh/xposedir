const fs = require("fs");
const path = require("path");

const BLOCK = 512;
const MAX_OCTAL_11 = 0o77777777777; // 8589934591 (~8 GiB)

const roundBlock = (n) => Math.ceil(n / BLOCK) * BLOCK;

function writeOctal(buf, off, len, value) {
  const digits = len - 1;
  let s = Math.floor(value).toString(8);
  if (s.length > digits) s = s.slice(-digits);
  s = s.padStart(digits, "0");
  buf.write(s, off, digits, "ascii");
  buf[off + len - 1] = 0x00;
}

function writeSize(buf, off, len, value) {
  if (value <= MAX_OCTAL_11) {
    writeOctal(buf, off, len, value);
    return;
  }
  // GNU base-256 (big-endian, high bit of first byte set for >8 GiB entries)
  let v = BigInt(value);
  const bytes = Buffer.alloc(len);
  for (let i = len - 1; i >= 0; i--) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  bytes[0] |= 0x80;
  bytes.copy(buf, off);
}

function splitUstarName(name) {
  const bytes = Buffer.byteLength(name, "utf8");
  if (bytes <= 100) return { name, prefix: "" };
  // try to split at '/' so that prefix <= 155 and suffix <= 100
  for (let i = bytes - 101; i >= 0; i--) {
    if (name[i] === "/") {
      const prefix = name.slice(0, i);
      const suffix = name.slice(i + 1);
      if (
        Buffer.byteLength(prefix, "utf8") <= 155 &&
        Buffer.byteLength(suffix, "utf8") <= 100
      ) {
        return { name: suffix, prefix };
      }
    }
  }
  return null;
}

function makeChecksum(header) {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += header[i];
  const cs = sum.toString(8).padStart(6, "0");
  header.write(cs, 148, 6, "ascii");
  header[154] = 0x00;
  header[155] = 0x20;
}

function buildHeader(entry) {
  const h = Buffer.alloc(BLOCK, 0);
  let name = entry.archivePath;
  if (entry.type === "dir") name = name.replace(/\/+$/, "") + "/";

  const split = splitUstarName(name);
  if (!split) throw new Error("Tar name too long (no ustar split): " + name);
  h.write(split.name, 0, 100, "utf8");

  writeOctal(h, 100, 8, (entry.mode & 0o777) | (entry.type === "dir" ? 0o700 : 0o600));
  writeOctal(h, 108, 8, 0);
  writeOctal(h, 116, 8, 0);
  writeSize(h, 124, 12, entry.type === "file" ? entry.size : 0);
  writeOctal(h, 136, 12, entry.mtime);
  h.fill(0x20, 148, 156); // checksum placeholder (spaces)
  h[156] = entry.type === "dir" ? 0x35 : 0x30; // '5' : '0'
  h.write("ustar", 257, 6, "ascii");
  h.write("00", 263, 2, "ascii");
  if (split.prefix) h.write(split.prefix, 345, 155, "utf8");
  makeChecksum(h);
  return h;
}

function addEntry(entries, source, archivePath, type, size, mode, mtime) {
  const first = entries.find((e) => e.archivePath === archivePath);
  if (first) return;
  entries.push({ source, archivePath, type, size, mode, mtime });
}

function collectTree(dir, archiveBase, entries) {
  const seen = new Set();
  const walk = (current, archivePath) => {
    const real = fs.realpathSync.native(current);
    const key = process.platform === "win32" ? real.toLowerCase() : real;
    if (seen.has(key)) return; // avoid cycles (junctions/symlinks)
    seen.add(key);

    let st;
    try {
      st = fs.lstatSync(current);
    } catch {
      return;
    }
    const mtime = Math.floor(st.mtimeMs / 1000);
    if (st.isDirectory()) {
      addEntry(entries, current, archivePath, "dir", 0, st.mode, mtime);
      let dirents;
      try {
        dirents = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        return;
      }
      dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const d of dirents) {
        if (d.isSymbolicLink()) continue;
        walk(path.join(current, d.name), archivePath + "/" + d.name);
      }
    } else if (st.isFile()) {
      addEntry(entries, current, archivePath, "file", st.size, st.mode, mtime);
    }
  };
  walk(dir, archiveBase);
}

function buildIndex(folderPath, items) {
  const root = path.resolve(folderPath);
  const rootLower = root.toLowerCase();

  const entries = [];
  for (const item of items) {
    const full = path.resolve(path.join(folderPath, item));
    const lower = full.toLowerCase();
    if (lower !== rootLower && !lower.startsWith(rootLower + path.sep)) {
      throw new Error("Path outside shared folder: " + item);
    }
    let stat;
    try {
      stat = fs.lstatSync(full);
    } catch (e) {
      throw new Error("Cannot read: " + item);
    }
    const base = path.basename(full);
    if (stat.isDirectory()) {
      collectTree(full, base, entries);
    } else if (stat.isFile()) {
      addEntry(entries, full, base, "file", stat.size, stat.mode, Math.floor(stat.mtimeMs / 1000));
    }
  }

  entries.sort((a, b) =>
    a.archivePath < b.archivePath ? -1 : a.archivePath > b.archivePath ? 1 : 0,
  );

  let offset = 0;
  for (const e of entries) {
    e.header = buildHeader(e);
    e.offset = offset;
    if (e.type === "file") {
      e.dataOffset = offset + BLOCK;
      e.end = e.dataOffset + roundBlock(e.size);
    } else {
      e.end = offset + BLOCK;
    }
    offset = e.end;
  }

  const totalBytes = offset + BLOCK * 2; // two terminating zero blocks

  return {
    entries,
    totalBytes,
    files: entries.filter((e) => e.type === "file").length,
    folders: entries.filter((e) => e.type === "dir").length,
  };
}

async function* streamRange(index, start, end) {
  const entries = index.entries;

  let lo = 0;
  let hi = entries.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid].end <= start) lo = mid + 1;
    else hi = mid;
  }

  for (let i = lo; i < entries.length; i++) {
    const e = entries[i];
    if (e.offset > end) break;

    // header block overlap
    const hStart = Math.max(start, e.offset);
    const hEnd = Math.min(end, e.offset + BLOCK - 1);
    if (hStart <= hEnd) {
      yield e.header.subarray(hStart - e.offset, hEnd - e.offset + 1);
    }

    if (e.type === "file" && e.size > 0) {
      const dStart = e.dataOffset;
      const dEnd = e.dataOffset + e.size - 1;
      const s = Math.max(start, dStart);
      const t = Math.min(end, dEnd);
      if (s <= t) {
        const stream = fs.createReadStream(e.source, {
          start: s - dStart,
          end: t - dStart,
        });
        for await (const chunk of stream) yield chunk;
      }
      // zero padding to a 512 boundary, if the range includes it
      const pStart = e.dataOffset + e.size;
      const pEnd = e.end - 1;
      const ps = Math.max(start, pStart);
      const pe = Math.min(end, pEnd);
      if (ps <= pe) yield Buffer.alloc(pe - ps + 1);
    }
  }

  // end-of-archive terminator (two zero blocks)
  const termStart = index.totalBytes - BLOCK * 2;
  const ts = Math.max(start, termStart);
  const te = Math.min(end, index.totalBytes - 1);
  if (ts <= te) yield Buffer.alloc(te - ts + 1);
}

module.exports = { buildIndex, streamRange, BLOCK };