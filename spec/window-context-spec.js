describe("Table Editor window presentation", () => {
  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.workspace.getElement());
    await lumine.packages.activatePackage("table-editor");
  });
  afterEach(async () => {
    await lumine.workspace.discardEditorWindows();
  });
  it("retains its grid and shared table while rebinding drawing and the cell picker", async () => {
    const Table = require("../lib/table");
    const TableEditor = require("../lib/table-editor");
    const workspace = lumine.workspace;
    const table = new Table({ columns: ["value"], rows: [["one"], ["two"]] });
    const item = new TableEditor({ table });
    await workspace.open(item);
    const view = lumine.views.getView(item);
    const grid = view.grid;
    const extra = await workspace.detachItem(item);
    expect(view.grid).toBe(grid);
    expect(item.getPaneItemDocument()).toBe(table);
    expect(grid.presentationWindow).toBe(extra.getDocument().defaultView);
    const dialog = view.openGoToCellModal();
    expect(dialog.ownerDocument).toBe(extra.getDocument());
    expect(extra.getElement().contains(dialog)).toBe(true);
    dialog.destroy();
    const copy = item.copy();
    expect(copy.getPaneItemDocument()).toBe(item.getPaneItemDocument());
    table.setValueAtPosition([0, 0], "edited");
    expect(copy.getValueAtPosition([0, 0])).toBe("edited");
    expect(item.shouldPromptToSave({ lastView: false })).toBe(false);
    copy.destroy();
    await workspace.attachWindow(extra);
    expect(view.grid).toBe(grid);
    expect(grid.presentationWindow).toBe(
      workspace.getMainWindow().getDocument().defaultView,
    );
  });
});
