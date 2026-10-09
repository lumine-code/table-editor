const fs = require("fs");
const os = require("os");
const path = require("path");
const { parse } = require("csv-parse/sync");

describe("Table Editor actual data boundaries", () => {
  let main, models, directory, temporaryRoot;
  function model(rows) {
    const { Table, TableEditor } = main.provideTableEditor();
    const table = new Table({ columns: ["A", "B"], rows });
    const editor = new TableEditor({ table });
    models.push(editor);
    const view = lumine.views.getView(editor);
    jasmine.attachToDOM(view);
    table.initializeAfterSetup();
    return { table, editor, view };
  }
  beforeEach(async () => {
    models = [];
    temporaryRoot = fs.realpathSync.native(os.tmpdir());
    directory = fs.realpathSync.native(
      fs.mkdtempSync(path.join(temporaryRoot, "table-data-boundary-")),
    );
    const pack = await lumine.packages.activatePackage("table-editor");
    main = pack.mainModule;
    jasmine.attachToDOM(lumine.views.getView(lumine.workspace));
  });
  afterEach(async () => {
    for (const item of models) if (!item.isDestroyed()) item.destroy();
    await lumine.packages.deactivatePackage("table-editor");
    await lumine.fileWatchClient.settlePendingTeardown();
    const relative = path.relative(temporaryRoot, directory);
    if (
      !relative ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      throw Error("Unsafe scratch cleanup");
    fs.rmSync(directory, { recursive: true, force: true });
  });
  it("keeps a readonly actual table unchanged on Delete", () => {
    const { table, view } = model([["keep", "value"]]);
    view.setAttribute("read-only", "");
    lumine.commands.dispatch(view, "core:delete");
    expect(table.getRows()).toEqual([["keep", "value"]]);
    expect(table.isModified()).toBe(false);
  });
  it("copies newline, tab and quote cells as a rectangular spreadsheet text payload", () => {
    const rows = [
      ["one\ntwo", 'a"b'],
      ["one\ttwo", "plain"],
    ];
    const { editor, view } = model(rows.map((row) => [...row]));
    editor.setSelectedRange([
      [0, 0],
      [2, 2],
    ]);
    let copied;
    spyOn(lumine.clipboard, "write").and.callFake((text) => (copied = text));
    lumine.commands.dispatch(view, "core:copy");
    expect(parse(copied, { delimiter: "\t" })).toEqual(rows);
  });
  it("deletes the originally selected separated rows in one undoable command", () => {
    const rows = Array.from({ length: 6 }, (_, index) => [
      String(index),
      "value",
    ]);
    const { table, editor, view } = model(rows.map((row) => [...row]));
    editor.setSelectedRanges([
      [
        [1, 0],
        [2, 2],
      ],
      [
        [3, 0],
        [4, 2],
      ],
    ]);
    lumine.commands.dispatch(view, "table-editor:delete-row");
    expect(table.getRows()).toEqual([rows[0], rows[2], rows[4], rows[5]]);
    lumine.commands.dispatch(view, "core:undo");
    expect(table.getRows()).toEqual(rows);
  });
  it("undoes sorted row deletion using numeric model indices", () => {
    const rows = Array.from({ length: 12 }, (_, index) => [
      String(index),
      "value",
    ]);
    const { table, editor, view } = model(rows.map((row) => [...row]));
    editor.sortBy((a, b) => {
      const rank = (row) =>
        row[0] === "2" ? -2 : row[0] === "10" ? -1 : Number(row[0]);
      return rank(a) - rank(b);
    });
    editor.setSelectedRange([
      [0, 0],
      [2, 2],
    ]);
    lumine.commands.dispatch(view, "table-editor:delete-row");
    expect(table.getRows()).toEqual(
      rows.filter((_, index) => index !== 2 && index !== 10),
    );
    lumine.commands.dispatch(view, "core:undo");
    expect(table.getRows()).toEqual(rows);
  });
  it("keeps an edit made during an actual atomic save marked as unsaved", async () => {
    const filePath = path.join(directory, "save.csv");
    fs.writeFileSync(filePath, "initial,value\n");
    const { DelimitedTextEditor } = main.provideTableEditor();
    const item = new DelimitedTextEditor({ filePath });
    models.push(item);
    await item.openTableEditor();
    item.editor.setValueAtPosition([0, 0], "saved");
    const rename = fs.promises.rename.bind(fs.promises);
    let release, entered;
    const arrival = new Promise((resolve) => (entered = resolve));
    const held = new Promise((resolve) => (release = resolve));
    spyOn(fs.promises, "rename").and.callFake(async (...args) => {
      entered();
      await held;
      return rename(...args);
    });
    const saving = item.save();
    try {
      await arrival;
      item.editor.setValueAtPosition([0, 0], "unsaved");
    } finally {
      release();
      await saving;
    }
    expect(fs.readFileSync(filePath, "utf8")).toBe("saved,value\n");
    expect(item.isModified()).toBe(true);
    expect(item.getFileState()).toBe("modified");
  });
  it("pastes through the actual Core asynchronous clipboard read contract", async () => {
    const { table, view } = model([["initial", "value"]]);
    spyOn(lumine.clipboard, "read").and.returnValue(
      Promise.resolve("pasted\tsecond"),
    );
    await lumine.commands.dispatch(view, "core:paste");
    expect(table.getRows()).toEqual([["pasted", "second"]]);
  });
  it("copies separated ranges with one native write and complete current Core metadata", async () => {
    const { editor, view } = model([
      ["one", "value"],
      ["two", "value"],
    ]);
    editor.setSelectedRanges([
      [
        [0, 0],
        [1, 1],
      ],
      [
        [1, 1],
        [2, 2],
      ],
    ]);
    spyOn(lumine.clipboard, "read").and.returnValue(
      Promise.resolve("unrelated"),
    );
    const write = spyOn(lumine.clipboard, "write").and.returnValue(
      Promise.resolve(),
    );
    await lumine.commands.dispatch(view, "core:copy");
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.calls.mostRecent().args[0]).toBe("one\nvalue");
    expect(write.calls.mostRecent().args[1].values).toEqual([
      [["one"]],
      [["value"]],
    ]);
  });
  it("parses quoted spreadsheet text without splitting cells and permits one undo", async () => {
    const { table, editor, view } = model([
      ["", ""],
      ["", ""],
    ]);
    editor.setSelectedRange([
      [0, 0],
      [2, 2],
    ]);
    spyOn(lumine.clipboard, "read").and.returnValue(
      Promise.resolve('"one\ntwo"\t"a""b"\n"one\ttwo"\tplain'),
    );
    await lumine.commands.dispatch(view, "core:paste");
    expect(table.getRows()).toEqual([
      ["one\ntwo", 'a"b'],
      ["one\ttwo", "plain"],
    ]);
    lumine.commands.dispatch(view, "core:undo");
    expect(table.getRows()).toEqual([
      ["", ""],
      ["", ""],
    ]);
  });
  it("declines a pending clipboard read after the target selection changes", async () => {
    const { table, editor, view } = model([["one", "two"]]);
    let release;
    spyOn(lumine.clipboard, "read").and.returnValue(
      new Promise((resolve) => (release = resolve)),
    );
    const pasting = lumine.commands.dispatch(view, "core:paste");
    editor.setCursorAtScreenPosition([0, 1]);
    release("late");
    await pasting;
    expect(table.getRows()).toEqual([["one", "two"]]);
  });
  it("declines an accepted clipboard read if its actual view becomes readonly", async () => {
    const { table, view } = model([["one", "two"]]);
    let release;
    spyOn(lumine.clipboard, "read").and.returnValue(
      new Promise((resolve) => (release = resolve)),
    );
    const pasting = lumine.commands.dispatch(view, "core:paste");
    view.setAttribute("read-only", "");
    release("late");
    await pasting;
    expect(table.getRows()).toEqual([["one", "two"]]);
  });
  it("keeps separated column deletion tied to its original ranges", () => {
    const { Table, TableEditor } = main.provideTableEditor();
    const table = new Table({
      columns: ["A", "B", "C", "D", "E"],
      rows: [["a", "b", "c", "d", "e"]],
    });
    const editor = new TableEditor({ table });
    models.push(editor);
    const view = lumine.views.getView(editor);
    jasmine.attachToDOM(view);
    table.initializeAfterSetup();
    editor.setSelectedRanges([
      [
        [0, 1],
        [1, 2],
      ],
      [
        [0, 3],
        [1, 4],
      ],
    ]);
    lumine.commands.dispatch(view, "table-editor:delete-column");
    expect(table.getRows()).toEqual([["a", "c", "e"]]);
    lumine.commands.dispatch(view, "core:undo");
    expect(table.getRows()).toEqual([["a", "b", "c", "d", "e"]]);
  });
  it("keeps readonly movement and applied sorting from rewriting stored data", () => {
    const { table, editor, view } = model([
      ["b", "value"],
      ["a", "value"],
    ]);
    view.setAttribute("read-only", "");
    lumine.commands.dispatch(view, "table-editor:move-row-down");
    expect(table.getRows()).toEqual([
      ["b", "value"],
      ["a", "value"],
    ]);
    editor.sortBy(0);
    lumine.commands.dispatch(view, "table-editor:apply-sort");
    expect(table.getRows()).toEqual([
      ["b", "value"],
      ["a", "value"],
    ]);
  });
  it("serializes accepted save snapshots and lets their filesystem job finish after retirement", async () => {
    const filePath = path.join(directory, "queued.csv");
    fs.writeFileSync(filePath, "initial,value\n");
    const { DelimitedTextEditor } = main.provideTableEditor();
    const item = new DelimitedTextEditor({ filePath });
    models.push(item);
    await item.openTableEditor();
    item.editor.setValueAtPosition([0, 0], "first");
    const rename = fs.promises.rename.bind(fs.promises);
    let release, entered;
    const arrival = new Promise((resolve) => (entered = resolve));
    const held = new Promise((resolve) => (release = resolve));
    let replacements = 0;
    const replacement = spyOn(fs.promises, "rename").and.callFake(
      async (...args) => {
        if (++replacements === 1) {
          entered();
          await held;
        }
        return rename(...args);
      },
    );
    const first = item.save();
    let second;
    try {
      await arrival;
      item.editor.setValueAtPosition([0, 0], "second");
      second = item.save();
      await new Promise((resolve) =>
        require("node:timers").setTimeout(resolve, 30),
      );
      expect(replacement.calls.count()).toBe(1);
      const document = item.document;
      item.destroy();
      const reset = spyOn(document, "resetWatcher").and.callThrough();
      release();
      await Promise.all([first, second]);
      expect(reset).not.toHaveBeenCalled();
      expect(fs.readFileSync(filePath, "utf8")).toBe("second,value\n");
    } finally {
      release();
      await Promise.all([first, second]);
    }
  });
  it("waits for the actual Core memory clipboard flush before cutting its current cells", async () => {
    const { table, view } = model([["one", "two"]]);
    let release;
    spyOn(lumine.clipboard, "write").and.returnValue(
      new Promise((resolve) => (release = resolve)),
    );
    const cutting = lumine.commands.dispatch(view, "core:cut");
    expect(table.getRows()).toEqual([["one", "two"]]);
    release();
    await cutting;
    expect(table.getRows()).toEqual([[undefined, "two"]]);
  });
  it("preserves cells and reports a rejected native clipboard write", async () => {
    const { table, view } = model([["one", "two"]]);
    const failure = new Error("Owned clipboard write refused");
    const failed = Promise.reject(failure);
    failed.catch(() => {});
    spyOn(lumine.clipboard, "write").and.returnValue(failed);
    let rejected;
    try {
      await lumine.commands.dispatch(view, "core:cut");
    } catch (error) {
      rejected = error;
    }
    expect(rejected).toBe(failure);
    expect(table.getRows()).toEqual([["one", "two"]]);
  });
  it("does not cut a replacement selection after a pending native clipboard write", async () => {
    const { table, editor, view } = model([["one", "two"]]);
    let release;
    spyOn(lumine.clipboard, "write").and.returnValue(
      new Promise((resolve) => (release = resolve)),
    );
    const cutting = lumine.commands.dispatch(view, "core:cut");
    editor.setCursorAtScreenPosition([0, 1]);
    release();
    await cutting;
    expect(table.getRows()).toEqual([["one", "two"]]);
  });
});
