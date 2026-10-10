const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Every package activation in this full suite runs with the OS launchers blocked.
beforeEach(() => {
  for (const name of [
    "openExternal",
    "openPath",
    "showItemInFolder",
    "openApplication",
  ])
    spyOn(lumine.shell, name).and.resolveTo();
  spyOn(lumine.application, "openWindow").and.resolveTo();
});

describe("Quoted record delimiter detection", () => {
  let scratch, parent, service, edge, item;

  beforeEach(async () => {
    service = item = null;
    parent = fs.realpathSync.native(os.tmpdir());
    scratch = fs.realpathSync.native(
      fs.mkdtempSync(path.join(parent, "table-records-")),
    );
    await lumine.packages.activatePackage("table-editor");
    edge = lumine.packages.serviceHub.consume(
      "table-editor",
      "^1.0.0",
      (api) => {
        service = api;
      },
    );
    expect(service).toBeDefined();
  });

  afterEach(async () => {
    item?.destroy();
    edge?.dispose();
    await lumine.fileWatchClient.settlePendingTeardown();
    if (scratch && fs.existsSync(scratch)) {
      const current = fs.realpathSync.native(scratch);
      const relative = path.relative(parent, current);
      if (
        current !== scratch ||
        !relative ||
        relative.startsWith("..") ||
        path.isAbsolute(relative)
      )
        throw new Error("Refusing cleanup outside the owned record fixture");
      fs.rmSync(current, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 50,
      });
    }
  });

  async function openTable(text, options = {}) {
    const filePath = path.join(scratch, "records.csv");
    fs.writeFileSync(filePath, text, "utf8");
    item = new service.DelimitedTextEditor({
      filePath,
      options: {
        delimiter: ",",
        recordDelimiter: "auto",
        header: true,
        encoding: "utf8",
        ...options,
      },
    });
    const editor = await item.openTableEditor();
    expect(editor).not.toBeNull();
    return { editor, filePath };
  }

  it("keeps LF records when a quoted cell contains CRLF", async () => {
    const text = 'name,note\nAda,"one\r\ntwo"\nBob,plain\n';
    const { editor, filePath } = await openTable(text);
    if (!editor) return;
    expect(editor.getRows()).toEqual([
      ["Ada", "one\r\ntwo"],
      ["Bob", "plain"],
    ]);
    expect(item.document.metadata.recordDelimiter).toBe("\n");
    await item.save();
    expect(fs.readFileSync(filePath, "utf8")).toBe(text);
  });

  it("keeps CR records when a quoted cell contains LF", async () => {
    const text = 'name,note\rAda,"one\ntwo"\rBob,plain\r';
    const { editor, filePath } = await openTable(text);
    if (!editor) return;
    expect(editor.getRows()).toEqual([
      ["Ada", "one\ntwo"],
      ["Bob", "plain"],
    ]);
    expect(item.document.metadata.recordDelimiter).toBe("\r");
    await item.save();
    // LF is not this file's record delimiter, so the serializer may drop quotes.
    expect(fs.readFileSync(filePath, "utf8")).toBe(
      "name,note\rAda,one\ntwo\rBob,plain\r",
    );
  });

  it("preserves ordinary CRLF records and explicit LF settings", async () => {
    for (const [text, options, expected] of [
      ["name,note\r\nAda,ordinary\r\n", {}, "\r\n"],
      ['name,note\nAda,"one\r\ntwo"\n', { recordDelimiter: "\\n" }, "\n"],
    ]) {
      item?.destroy();
      item = null;
      await lumine.fileWatchClient.settlePendingTeardown();
      const { editor, filePath } = await openTable(text, options);
      if (!editor) continue;
      expect(editor.getRowCount()).toBe(1);
      expect(item.document.metadata.recordDelimiter).toBe(expected);
      await item.save();
      expect(fs.readFileSync(filePath, "utf8")).toBe(text);
    }
  });

  it("ignores escaped quotes and embedded newlines before the first record separator", async () => {
    for (const [text, options, firstCell] of [
      ['"one""\r\ntwo",1\nplain,2\n', {}, 'one"\r\ntwo'],
      [
        "'one\\'\r\ntwo',1\nplain,2\n",
        { quote: "'", escape: "\\" },
        "one'\r\ntwo",
      ],
    ]) {
      item?.destroy();
      item = null;
      await lumine.fileWatchClient.settlePendingTeardown();
      const { editor, filePath } = await openTable(text, {
        ...options,
        header: false,
      });
      if (!editor) continue;
      expect(editor.getRows()).toEqual([
        [firstCell, "1"],
        ["plain", "2"],
      ]);
      expect(item.document.metadata.recordDelimiter).toBe("\n");
      await item.save();
      expect(fs.readFileSync(filePath, "utf8")).toBe(text);
    }
  });
});
