"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const iconv = require("iconv-lite");
const {
  detectDelimiter,
  detectRecordDelimiter,
  inspectDelimitedFile,
  readDelimitedFile,
  writeDelimitedFileAtomically,
} = require("../lib/delimited-io");

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "table-editor-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("detects common field and record delimiters", () => {
  assert.equal(detectDelimiter("a;b;c\r\n1;2;3\r\n"), ";");
  assert.equal(detectDelimiter("a\tb\n1\t2\n"), "\t");
  assert.equal(detectRecordDelimiter("a,b\r\n1,2\r\n"), "\r\n");
});

test("reads quoted multiline records without relaxing inconsistent columns", async (t) => {
  const directory = temporaryDirectory(t);
  const validPath = path.join(directory, "valid.csv");
  fs.writeFileSync(validPath, 'name;note\r\nAda;"one\r\ntwo"', "utf8");
  const result = await readDelimitedFile(validPath, {
    delimiter: "auto",
    recordDelimiter: "auto",
    encoding: "utf8",
  });
  assert.deepEqual(result.rows, [
    ["name", "note"],
    ["Ada", "one\r\ntwo"],
  ]);
  assert.equal(result.metadata.delimiter, ";");
  assert.equal(result.metadata.recordDelimiter, "\r\n");
  assert.equal(result.metadata.hadFinalNewline, false);

  const invalidPath = path.join(directory, "invalid.csv");
  fs.writeFileSync(invalidPath, "a,b\n1,2,3\n", "utf8");
  await assert.rejects(() =>
    readDelimitedFile(invalidPath, { delimiter: ",", recordDelimiter: "\\n" }),
  );
});

test("preserves UTF-16 BOM, delimiter, record delimiter, and final newline policy", async (t) => {
  const directory = temporaryDirectory(t);
  const filePath = path.join(directory, "utf16.tsv");
  const source = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    iconv.encode("name\tvalue\r\nalpha\t42", "utf16-le"),
  ]);
  fs.writeFileSync(filePath, source);
  const options = {
    delimiter: "auto",
    recordDelimiter: "auto",
    encoding: "utf8",
    endOfFileNewline: "preserve",
  };
  const result = await readDelimitedFile(filePath, options);
  assert.equal(result.metadata.encoding, "utf16-le");
  assert.equal(result.metadata.bom.length, 2);
  assert.equal(result.metadata.delimiter, "\t");
  await writeDelimitedFileAtomically(
    filePath,
    result.rows,
    options,
    result.metadata,
  );
  const saved = fs.readFileSync(filePath);
  assert.deepEqual(saved.subarray(0, 2), Buffer.from([0xff, 0xfe]));
  assert.equal(
    iconv.decode(saved.subarray(2), "utf16-le"),
    "name\tvalue\r\nalpha\t42",
  );
});

test("leaves the target untouched and removes temporary files on save failure", async (t) => {
  const directory = temporaryDirectory(t);
  const filePath = path.join(directory, "safe.csv");
  fs.writeFileSync(filePath, "original\n", "utf8");
  const metadata = await inspectDelimitedFile(filePath, { encoding: "utf8" });
  metadata.encoding = "definitely-not-an-encoding";
  await assert.rejects(() =>
    writeDelimitedFileAtomically(filePath, [["replacement"]], {}, metadata),
  );
  assert.equal(fs.readFileSync(filePath, "utf8"), "original\n");
  assert.deepEqual(fs.readdirSync(directory), ["safe.csv"]);
});

test("honors an already-aborted read without returning partial records", async (t) => {
  const directory = temporaryDirectory(t);
  const filePath = path.join(directory, "cancel.csv");
  fs.writeFileSync(filePath, "a,b\n1,2\n", "utf8");
  const controller = new AbortController();
  controller.abort();
  assert.equal(
    await readDelimitedFile(filePath, {}, { signal: controller.signal }),
    null,
  );
});
