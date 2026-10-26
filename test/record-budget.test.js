"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { recordBudget, validateRecordText } = require("../lib/record-budget");
const {
  readDelimitedFile,
  inspectDelimitedFile,
  writeDelimitedFileAtomically,
} = require("../lib/delimited-io");
const { CELL_UNITS } = require("../lib/text-budget");
const format = {
  delimiter: ",",
  recordDelimiter: "\r\n",
  quote: '"',
  escape: '"',
};

test("tracks escaped quotes and quoted newlines across every token boundary", async () => {
  const text = '"a""b\r\nc",d\r\nx,y\r\n';
  const chunks = [];
  await pipeline(
    Readable.from([...text], { objectMode: false }),
    recordBudget(format, { units: 12, columns: 2, cells: 4 }),
    async (source) => {
      for await (const chunk of source) chunks.push(chunk.toString());
    },
  );
  assert.equal(chunks.join(""), text);
  assert.throws(
    () => validateRecordText('"a\r\n0123456789",d', format, { units: 12 }),
    { code: "ERR_TABLE_TEXT_LIMIT" },
  );
  assert.throws(() => validateRecordText(",,,,", format, { columns: 3 }), {
    code: "ERR_TABLE_TEXT_LIMIT",
  });
  assert.throws(() => validateRecordText("a,b\r\nc,d", format, { cells: 3 }), {
    code: "ERR_TABLE_TEXT_LIMIT",
  });
});

test("supports multicharacter delimiters, comments, all clipboard newlines and split escapes", async () => {
  const custom = {
    ...format,
    delimiter: "||",
    recordDelimiter: "<END>",
    escape: "\\",
    commentPrefix: "#",
  };
  const text = '"ż😀\\"||a"||b<END>#ignored " || <END>x||y<END>';
  const chunks = [];
  await pipeline(
    Readable.from([...text], { objectMode: false }),
    recordBudget(custom, { units: 100, columns: 2 }),
    async (source) => {
      for await (const chunk of source) chunks.push(chunk.toString());
    },
  );
  assert.equal(chunks.join(""), text);
  validateRecordText(
    "a,b\rc,d\r\ne,f\ng,h",
    { ...format, recordDelimiter: ["\r\n", "\n", "\r"] },
    { columns: 2, cells: 8 },
  );
});

test("rejects enormous fields and empty-column records without changing the source", async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "table-bounded-source-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "input.csv");
  for (const text of [
    ",".repeat(10000),
    '"' + "x".repeat(CELL_UNITS + 1) + '"\n',
  ]) {
    fs.writeFileSync(file, text);
    await assert.rejects(
      readDelimitedFile(file, { delimiter: ",", recordDelimiter: "\n" }),
      { code: "ERR_TABLE_TEXT_LIMIT" },
    );
    assert.equal(fs.readFileSync(file, "utf8"), text);
    fs.renameSync(file, file + ".closed");
    fs.renameSync(file + ".closed", file);
  }
});

test("rejects unsafe save cells and escaped expansion before atomically publishing", async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "table-bounded-save-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "output.csv"),
    original = "saved\r\n";
  fs.writeFileSync(file, original);
  const metadata = await inspectDelimitedFile(file, { delimiter: "," });
  await assert.rejects(
    writeDelimitedFileAtomically(
      file,
      [["first"], ["x".repeat(CELL_UNITS + 1)]],
      {},
      metadata,
    ),
    { code: "ERR_TABLE_TEXT_LIMIT" },
  );
  await assert.rejects(
    writeDelimitedFileAtomically(
      file,
      [["x".repeat(CELL_UNITS)]],
      { escape: "x".repeat(64) },
      metadata,
    ),
  );
  assert.equal(fs.readFileSync(file, "utf8"), original);
  assert.deepEqual(fs.readdirSync(directory), ["output.csv"]);
});
