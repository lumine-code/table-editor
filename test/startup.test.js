"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const { test, mock } = require("node:test");

test("keeps delimited documents and IO unloaded when only ordinary files are open", async () => {
  const originalLoad = Module._load;
  const lumineAPI = { Point: class Point {}, Emitter: class Emitter {} };
  const load = mock.method(Module, "_load", function (specifier, ...args) {
    return specifier === "lumine"
      ? lumineAPI
      : originalLoad.call(this, specifier, ...args);
  });
  global.lumine = {
    workspace: {
      getPaneItems: () => [{ getPath: () => "notes.txt" }],
    },
  };
  try {
    const main = require("../lib/main");
    main.initialize();
    await main.prepareToSerialize();
    assert.deepEqual(main.serialize(), { version: 1, files: {}, tables: {} });
    for (const filename of [
      "delimited-document.js",
      "delimited-io.js",
      "delimited-runtime.js",
      "csv-editor.js",
    ]) {
      assert.equal(
        require.cache[path.resolve(__dirname, "..", "lib", filename)],
        undefined,
        `${filename} should load only when a table file is used`,
      );
    }
  } finally {
    load.mock.restore();
    delete global.lumine;
  }
});
