const Table = require("../lib/table");
const DisplayTable = require("../lib/display-table");
const TableEditor = require("../lib/table-editor");
const Range = require("../lib/range");

describe("table-editor models", () => {
  beforeEach(async () => {
    await lumine.packages.activatePackage("table-editor");
    lumine.config.set("table-editor.tableEditor.columnWidth", 100);
    lumine.config.set("table-editor.tableEditor.minimumColumnWidth", 40);
    lumine.config.set("table-editor.tableEditor.rowHeight", 20);
    lumine.config.set("table-editor.tableEditor.minimumRowHeight", 10);
  });

  function tableWithData() {
    const table = new Table({
      columns: ["name", "value"],
      rows: [
        ["beta", "2"],
        ["alpha", "1"],
      ],
    });
    table.initializeAfterSetup();
    return table;
  }

  it("treats ranges as half-open rectangles", () => {
    const range = new Range([1, 2], [4, 6]);
    expect(range.getRowCount()).toBe(3);
    expect(range.getColumnCount()).toBe(4);
    expect(range.containsPoint([1, 2])).toBe(true);
    expect(range.containsPoint([4, 2])).toBe(false);
    expect(range.map((row, column) => `${row}:${column}`).flat().length).toBe(
      12,
    );
  });

  it("groups a batch into one undoable revision", () => {
    const table = tableWithData();
    table.batchTransaction(() => {
      table.setValueAtPosition([0, 0], "first");
      table.setValueAtPosition([0, 1], "second");
    });
    expect(table.getRow(0)).toEqual(["first", "second"]);
    expect(table.undoStack.length).toBe(1);
    table.undo();
    expect(table.getRow(0)).toEqual(["beta", "2"]);
    table.redo();
    expect(table.getRow(0)).toEqual(["first", "second"]);
    table.destroy();
  });

  it("keeps a divergent edit dirty after save and undo", async () => {
    const table = tableWithData();
    table.setSaveHandler(async () => {});
    table.setValueAtPosition([0, 1], "saved");
    await table.save();
    expect(table.isModified()).toBe(false);
    table.undo();
    expect(table.isModified()).toBe(true);
    table.setValueAtPosition([0, 1], "different");
    expect(table.isModified()).toBe(true);
    expect(table.currentRevision).not.toBe(table.savedRevision);
    table.destroy();
  });

  it("undoes row and column structure without losing cell values", () => {
    const table = tableWithData();
    table.addColumnAt(1, "middle");
    table.setValueAtPosition([0, 1], "kept");
    table.addRowAt(1, ["new", "cell", "3"]);
    expect(table.getColumnCount()).toBe(3);
    expect(table.getRowCount()).toBe(3);
    table.undo();
    table.undo();
    table.undo();
    expect(table.getColumns()).toEqual(["name", "value"]);
    expect(table.getRows()).toEqual([
      ["beta", "2"],
      ["alpha", "1"],
    ]);
    table.destroy();
  });

  it("keeps display sort and layout independent between editors", () => {
    const table = tableWithData();
    const first = new TableEditor({ table });
    const second = new TableEditor({ table });
    first.sortBy(0, 1);
    first.setScreenColumnWidthAt(0, 240);
    expect(first.getScreenRow(0)[0]).toBe("alpha");
    expect(first.getScreenRows().map((row) => row[0])).toEqual([
      "alpha",
      "beta",
    ]);
    expect(second.getScreenRow(0)[0]).toBe("beta");
    expect(first.getScreenColumnWidthAt(0)).toBe(240);
    expect(second.getScreenColumnWidthAt(0)).toBe(100);
    first.destroy();
    second.destroy();
  });

  it("limits standalone table editors to the workspace center", () => {
    const editor = new TableEditor({ table: tableWithData() });
    expect(editor.getDefaultLocation()).toBe("center");
    expect(editor.getAllowedLocations()).toEqual(["center"]);
    editor.destroy();
  });

  it("keeps 50,000-row layout and hit-testing within linear setup bounds", () => {
    const rows = Array.from({ length: 50_000 }, (_, row) => [
      String(row),
      String(50_000 - row),
    ]);
    const table = new Table({ columns: ["left", "right"], rows });
    const setupStart = performance.now();
    const display = new DisplayTable({ table });
    const setupMs = performance.now() - setupStart;
    expect(setupMs).toBeLessThan(250);
    expect(display.getScreenRowIndexAtPixelPosition(25_000 * 20 + 1)).toBe(
      25_000,
    );

    const resizeStart = performance.now();
    display.setRowHeightAt(25_000, 36);
    expect(performance.now() - resizeStart).toBeLessThan(25);
    expect(display.getScreenRowOffsetAt(25_001)).toBe(25_000 * 20 + 36);
    display.destroy();
    table.destroy();
  });

  it("maps custom stable sorts without searching the sorted rows repeatedly", () => {
    const table = new Table({
      columns: ["group", "value"],
      rows: [
        ["b", "first"],
        ["a", "second"],
        ["b", "third"],
      ],
    });
    const display = new DisplayTable({ table });
    display.sortBy((left, right) => left[0].localeCompare(right[0]));
    expect(display.getScreenRows()).toEqual([
      ["a", "second"],
      ["b", "first"],
      ["b", "third"],
    ]);
    expect(display.screenToModelRowsMap).toEqual([1, 0, 2]);
    display.destroy();
    table.destroy();
  });

  it("destroys each display model when its editor closes", () => {
    const table = tableWithData();
    const editor = new TableEditor({ table });
    const display = editor.displayTable;
    editor.destroy();
    expect(display.isDestroyed()).toBe(true);
    expect(table.isDestroyed()).toBe(true);
  });

  it("supports rectangular clipboard paste and structural editor commands", () => {
    const table = tableWithData();
    const editor = new TableEditor({ table });
    editor.setSelectedRange(new Range([0, 0], [2, 2]));
    lumine.clipboard.write("x\ty\nu\tv");
    editor.pasteClipboard();
    expect(table.getRows()).toEqual([
      ["x", "y"],
      ["u", "v"],
    ]);
    editor.setCursorAtScreenPosition([0, 0]);
    editor.insertRowAfter();
    editor.insertColumnAfter();
    expect(table.getRowCount()).toBe(3);
    expect(table.getColumnCount()).toBe(3);
    editor.destroy();
  });

  it("serializes models under namespaced versioned keys", () => {
    const table = tableWithData();
    const display = new DisplayTable({ table });
    const editor = new TableEditor({ table, displayTable: display });
    expect(table.serialize().deserializer).toBe("table-editor/Table");
    expect(display.serialize().deserializer).toBe("table-editor/DisplayTable");
    expect(editor.serialize().deserializer).toBe("table-editor/TableEditor");
    expect(editor.serialize().version).toBe(1);
    editor.destroy();
  });
});
