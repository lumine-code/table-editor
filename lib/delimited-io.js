"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Readable, Transform } = require("stream");
const { pipeline } = require("stream/promises");
const iconv = require("iconv-lite");
const { parse } = require("csv-parse");
const { stringify } = require("csv-stringify");

const SAMPLE_BYTES = 64 * 1024;
const DELIMITER_CANDIDATES = [",", ";", "\t", "|"];

function decodeEscapes(value) {
  if (value == null) return value;
  return String(value)
    .replaceAll("\\t", "\t")
    .replaceAll("\\r", "\r")
    .replaceAll("\\n", "\n");
}

function encodingFromBom(buffer, fallback = "utf8") {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
    return { encoding: "utf8", bom: Buffer.from([0xef, 0xbb, 0xbf]) };
  }
  if (buffer.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))) {
    return { encoding: "utf16-le", bom: Buffer.from([0xff, 0xfe]) };
  }
  if (buffer.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]))) {
    return { encoding: "utf16-be", bom: Buffer.from([0xfe, 0xff]) };
  }
  return {
    encoding: fallback === "auto" ? "utf8" : fallback,
    bom: Buffer.alloc(0),
  };
}

function countOutsideQuotes(line, delimiter, quote = '"') {
  let count = 0;
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    if (line[index] === quote) {
      if (quoted && line[index + 1] === quote) index++;
      else quoted = !quoted;
    } else if (!quoted && line[index] === delimiter) count++;
  }
  return count;
}

function detectDelimiter(text, quote = '"') {
  const lines = text
    .split(/\r\n|\n|\r/)
    .filter((line) => line.trim())
    .slice(0, 25);
  let winner = ",";
  let winnerScore = 0;
  for (const delimiter of DELIMITER_CANDIDATES) {
    const counts = lines.map((line) =>
      countOutsideQuotes(line, delimiter, quote),
    );
    const nonzero = counts.filter(Boolean);
    if (!nonzero.length) continue;
    const frequency = new Map();
    for (const count of nonzero)
      frequency.set(count, (frequency.get(count) || 0) + 1);
    const [columns, matches] = [...frequency].sort(
      (a, b) => b[1] - a[1] || b[0] - a[0],
    )[0];
    const score = columns * (matches / Math.max(1, lines.length)) ** 2;
    if (score > winnerScore) {
      winner = delimiter;
      winnerScore = score;
    }
  }
  return winner;
}

function detectRecordDelimiter(text) {
  if (text.includes("\r\n")) return "\r\n";
  if (text.includes("\n")) return "\n";
  if (text.includes("\r")) return "\r";
  return process.platform === "win32" ? "\r\n" : "\n";
}

function trimOptions(value) {
  return {
    ltrim: value === "left" || value === "both",
    rtrim: value === "right" || value === "both",
  };
}

async function inspectDelimitedFile(filePath, options = {}) {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const stats = await handle.stat();
    const sampleBuffer = Buffer.alloc(Math.min(SAMPLE_BYTES, stats.size));
    if (sampleBuffer.length)
      await handle.read(sampleBuffer, 0, sampleBuffer.length, 0);
    const fallbackEncoding = options.encoding || options.fileEncoding || "utf8";
    const { encoding, bom } = encodingFromBom(sampleBuffer, fallbackEncoding);
    const text = iconv.decode(sampleBuffer.subarray(bom.length), encoding);
    const quote = decodeEscapes(options.quote || '"');
    const delimiterOption = decodeEscapes(options.delimiter || "auto");
    const recordOption = decodeEscapes(
      options.recordDelimiter || options.rowDelimiter || "auto",
    );
    const delimiter =
      delimiterOption === "auto"
        ? detectDelimiter(text, quote)
        : delimiterOption;
    const recordDelimiter =
      recordOption === "auto" ? detectRecordDelimiter(text) : recordOption;

    const tailLength = Math.min(16, stats.size);
    const tailBuffer = Buffer.alloc(tailLength);
    if (tailLength)
      await handle.read(tailBuffer, 0, tailLength, stats.size - tailLength);
    const tail = iconv.decode(tailBuffer, encoding);
    const hadFinalNewline = /(?:\r\n|\n|\r)$/.test(tail);
    return {
      stats,
      encoding,
      bom,
      delimiter,
      recordDelimiter,
      hadFinalNewline,
    };
  } finally {
    await handle.close();
  }
}

function parserOptions(options, metadata) {
  const trim = trimOptions(options.trim || "no");
  return {
    delimiter: metadata.delimiter,
    record_delimiter: metadata.recordDelimiter,
    quote: decodeEscapes(options.quote || '"'),
    escape: decodeEscapes(options.escape || '"'),
    comment: options.commentPrefix || undefined,
    skip_empty_lines: Boolean(options.skipEmptyLines),
    relax_column_count: false,
    bom: true,
    ...trim,
  };
}

async function readDelimitedFile(filePath, options = {}, controls = {}) {
  if (controls.signal?.aborted) return null;
  const metadata = await inspectDelimitedFile(filePath, options);
  const rows = [];
  const source = fs.createReadStream(filePath);
  const decoder = iconv.decodeStream(metadata.encoding, { stripBOM: true });
  const parser = parse(parserOptions(options, metadata));
  let bytes = 0;
  let cancelled = false;
  const abort = () => {
    cancelled = true;
    source.destroy(new Error("Delimited-text read cancelled"));
  };
  controls.signal?.addEventListener("abort", abort, { once: true });
  source.on("data", (chunk) => {
    bytes += chunk.length;
    controls.onProgress?.({
      bytes,
      total: metadata.stats.size,
      rows: rows.length,
    });
  });
  source.pipe(decoder).pipe(parser);

  try {
    for await (const record of parser) {
      rows.push(record);
      controls.onRecord?.(record, rows.length);
      if (controls.limit && rows.length >= controls.limit) {
        source.destroy();
        decoder.destroy();
        parser.destroy();
        break;
      }
    }
  } catch (error) {
    if (!cancelled) throw error;
    return null;
  } finally {
    controls.signal?.removeEventListener("abort", abort);
  }
  return { rows, metadata };
}

function finalNewlineTransform(recordDelimiter, keepFinalNewline) {
  let pending = "";
  return new Transform({
    decodeStrings: false,
    transform(chunk, _encoding, callback) {
      pending += chunk.toString();
      if (pending.length > recordDelimiter.length) {
        const emitLength = pending.length - recordDelimiter.length;
        this.push(pending.slice(0, emitLength));
        pending = pending.slice(emitLength);
      }
      callback();
    },
    flush(callback) {
      if (!keepFinalNewline && pending.endsWith(recordDelimiter)) {
        pending = pending.slice(0, -recordDelimiter.length);
      }
      if (pending) this.push(pending);
      callback();
    },
  });
}

async function writeDelimitedFileAtomically(filePath, rows, options, metadata) {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`,
  );
  const previousStats = await fs.promises.stat(filePath).catch(() => null);
  const handle = await fs.promises.open(
    temporaryPath,
    "wx",
    previousStats?.mode ?? 0o666,
  );
  let committed = false;
  try {
    if (metadata.bom?.length)
      await handle.write(metadata.bom, 0, metadata.bom.length, 0);
    await handle.close();
    const writeStream = fs.createWriteStream(temporaryPath, {
      flags: "r+",
      start: metadata.bom?.length || 0,
    });
    const stringifier = stringify({
      delimiter: metadata.delimiter,
      record_delimiter: metadata.recordDelimiter,
      quote: decodeEscapes(options.quote || '"'),
      escape: decodeEscapes(options.escape || '"'),
      quoted: Boolean(options.quoteAll),
    });
    const policy = options.endOfFileNewline || "preserve";
    const keepFinalNewline =
      policy === "always" ||
      (policy === "preserve" && metadata.hadFinalNewline);
    const finalizer = finalNewlineTransform(
      metadata.recordDelimiter,
      keepFinalNewline,
    );
    finalizer.setEncoding("utf8");
    const encoder = iconv.encodeStream(metadata.encoding, { addBOM: false });
    await pipeline(
      Readable.from(rows, { objectMode: true }),
      stringifier,
      finalizer,
      encoder,
      writeStream,
    );
    const syncHandle = await fs.promises.open(temporaryPath, "r+");
    await syncHandle.sync();
    await syncHandle.close();
    if (previousStats)
      await fs.promises.chmod(temporaryPath, previousStats.mode);
    await fs.promises.rename(temporaryPath, filePath);
    committed = true;
  } finally {
    await handle.close().catch(() => {});
    if (!committed)
      await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

module.exports = {
  decodeEscapes,
  detectDelimiter,
  detectRecordDelimiter,
  encodingFromBom,
  inspectDelimitedFile,
  readDelimitedFile,
  writeDelimitedFileAtomically,
};
