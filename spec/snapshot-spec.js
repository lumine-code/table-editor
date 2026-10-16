const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

describe("shared table state snapshots", () => {
  let directory;
  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.workspace.getElement());
    await lumine.packages.activatePackage("table-editor");
  });
  afterEach(async () => {
    await lumine.workspace.discardEditorWindows();
    for (const item of [...lumine.workspace.getPaneItems()])
      await lumine.workspace.paneForItem(item).destroyItem(item, true);
    await lumine.fileWatchClient.settlePendingTeardown();
    if (directory) {
      for (const file of fs.readdirSync(directory))
        fs.unlinkSync(path.join(directory, file));
      fs.rmdirSync(directory);
      directory = null;
    }
  });

  it("restores shared standalone data with independent sort, widths and cursors", async () => {
    const Table = require("../lib/table");
    const TableEditor = require("../lib/table-editor");
    const table = new Table({ columns: ["value"], rows: [["b"], ["a"]] });
    table.initializeAfterSetup();
    const first = new TableEditor({ table });
    await lumine.workspace.open(first);
    const second = first.copy();
    first.sortBy(0, -1);
    first.setScreenColumnWidthAt(0, 270);
    second.setScreenColumnWidthAt(0, 330);
    first.setCursorAtScreenPosition([1, 0]);
    second.setCursorAtScreenPosition([0, 0]);
    const extra = await lumine.workspace.openEditorWindow({ show: false });
    extra
      .getEditorContainer()
      .getActivePane()
      .activateItem(second, { activatePane: true });
    first.setValueAtPosition([0, 0], "changed");
    const state = JSON.parse(JSON.stringify(await lumine.captureState()));
    expect(
      Object.keys(state.documentStates["table-editor"].tables).length,
    ).toBe(1);
    await lumine.deserialize(state);
    const editors = lumine.workspace
      .getPaneItems()
      .filter((item) => item instanceof TableEditor);
    expect(editors.length).toBe(2);
    expect(editors[0].table).toBe(editors[1].table);
    expect(
      editors.map((item) => item.getScreenColumnWidthAt(0)).sort(),
    ).toEqual([270, 330]);
    expect(
      editors.map((item) => item.getCursorScreenPosition().row).sort(),
    ).toEqual([0, 1]);
    expect(editors[0].isModified()).toBe(true);
    editors[0].setValueAtPosition([0, 0], "next");
    expect(editors[1].getValueAtPosition([0, 0])).toBe("next");
    editors[1].undo();
    expect(editors[0].getValueAtPosition([0, 0])).toBe("changed");
    expect(editors[0].isModified()).toBe(true);
  });

  it("restores two file views over one modified delimited document", async () => {
    directory = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "table-snapshot-")),
    );
    const filePath = path.join(directory, "data.csv");
    fs.writeFileSync(filePath, "name,value\nfirst,1\nsecond,2");
    lumine.config.set("table-editor.showPreview", false);
    const first = await lumine.workspace.open(filePath);
    await globalThis.conditionPromise(() => first.editor);
    const second = await first.copy();
    const extra = await lumine.workspace.openEditorWindow({ show: false });
    extra
      .getEditorContainer()
      .getActivePane()
      .activateItem(second, { activatePane: true });
    const oldDocument = first.document;
    first.editor.setValueAtPosition([0, 0], "unsaved");
    const state = JSON.parse(JSON.stringify(await lumine.captureState()));
    expect(
      Object.keys(state.documentStates["table-editor"].tables).length,
    ).toBe(1);
    await lumine.deserialize(state);
    const views = lumine.workspace
      .getPaneItems()
      .filter((item) => item.getPath?.() === filePath);
    await globalThis.conditionPromise(
      () => views.length === 2 && views.every((item) => item.editor),
    );
    expect(oldDocument.destroyed).toBe(true);
    expect(views[0].document).toBe(views[1].document);
    expect(views[0].editor.table).toBe(views[1].editor.table);
    expect(views[0].editor.getValueAtPosition([0, 0])).toBe("unsaved");
    expect(views[0].getFileState()).toBe("modified");
    await views[0].save();
    expect(views[1].getFileState()).toBe("unmodified");
    expect(fs.readFileSync(filePath, "utf8")).toContain("unsaved");
  });
});
