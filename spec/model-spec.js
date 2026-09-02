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
    expect(second.getScreenRow(0)[0]).toBe("beta");
    expect(first.getScreenColumnWidthAt(0)).toBe(240);
    expect(second.getScreenColumnWidthAt(0)).toBe(100);
    first.destroy();
    second.destroy();
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
