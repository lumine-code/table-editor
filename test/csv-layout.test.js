"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const FilePreferences = require("../lib/csv-config");
const { compactLayout, expandRowHeights } = require("../lib/csv-layout");

test("does not persist default layout slots for a million-row table", () => {
  const preferences = new FilePreferences();
  const filePath = path.resolve("large.csv");
  const layout = compactLayout({
    columns: [{}, { align: "left" }],
    rowHeights: new Array(1_000_000),
  });
  preferences.set(filePath, "options", { delimiter: ";", header: true });
  preferences.set(filePath, "choice", "TableEditor");
  preferences.set(filePath, "layout", layout);

  const state = JSON.parse(JSON.stringify(preferences.serialize()));
  assert.deepEqual(layout, {});
  assert.deepEqual(state.files[filePath], {
    options: { delimiter: ";", header: true },
    choice: "TableEditor",
  });
  assert.ok(JSON.stringify(state).length < 1000);
});

test("round-trips high-index row and column overrides without padding", () => {
  const rowHeights = new Array(1_000_000);
  rowHeights[0] = 0;
  rowHeights[999_999] = 52;
  const columns = new Array(100_000);
  columns[99_999] = { width: 220, align: "right" };
  const filePath = path.resolve("custom.csv");
  const preferences = new FilePreferences();
  preferences.set(filePath, "layout", { columns, rowHeights });

  const serialized = JSON.stringify(preferences.serialize());
  assert.ok(serialized.length < 1000);
  const restored = new FilePreferences(JSON.parse(serialized));
  const layout = restored.get(filePath, "layout");
  assert.deepEqual(layout, {
    columns: { 99_999: { width: 220, align: "right" } },
    rowHeights: { 0: 0, 999_999: 52 },
  });
  const runtimeHeights = expandRowHeights(layout.rowHeights, 1_000_000);
  assert.ok(Array.isArray(runtimeHeights));
  assert.equal(runtimeHeights[0], 0);
  assert.equal(runtimeHeights[999_999], 52);
  runtimeHeights.splice(1, 0, undefined);
  assert.equal(runtimeHeights[1_000_000], 52);
});

test("migrates old dense array layouts without changing remembered options", () => {
  const filePath = path.resolve("legacy.csv");
  const state = {
    version: 1,
    files: {
      [filePath]: {
        options: { delimiter: "\t", remember: true },
        choice: "TextEditor",
        layout: {
          columns: [{}, { width: 180, align: "left" }, { align: "center" }],
          rowHeights: [null, 36, null, 0],
        },
      },
    },
  };
  const preferences = new FilePreferences(state);
  const migrated = preferences.serialize();
  assert.deepEqual(migrated.files[filePath], {
    options: { delimiter: "\t", remember: true },
    choice: "TextEditor",
    layout: {
      columns: { 1: { width: 180 }, 2: { align: "center" } },
      rowHeights: { 1: 36, 3: 0 },
    },
  });
  const runtimeHeights = expandRowHeights(
    state.files[filePath].layout.rowHeights,
    4,
  );
  assert.equal(runtimeHeights[1], 36);
  assert.equal(runtimeHeights[3], 0);
  assert.equal(runtimeHeights[0], undefined);
  assert.equal(state.files[filePath].layout.rowHeights.length, 4);
});

test("drops old empty layout-only preferences even when the file stays closed", () => {
  const filePath = path.resolve("closed.csv");
  const preferences = new FilePreferences({
    version: 1,
    files: {
      [filePath]: {
        layout: { columns: [{}], rowHeights: new Array(1_000_000).fill(null) },
      },
    },
  });
  assert.deepEqual(preferences.serialize(), { version: 1, files: {} });
});
