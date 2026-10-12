describe("table pane copies", () => {
  let main, items;

  beforeEach(async () => {
    items = [];
    main = (await lumine.packages.activatePackage("table-editor")).mainModule;
  });

  afterEach(() => {
    for (const item of items) if (!item.isDestroyed()) item.destroy();
  });

  it("copies standalone presentation and selections while retaining shared writable data", () => {
    const { Table, TableEditor } = main.provideTableEditor();
    const table = new Table({ columns: ["value"], rows: [["b"], ["a"]] });
    table.initializeAfterSetup();
    const original = new TableEditor({ table });
    items.push(original);
    original.sortBy(0, -1);
    original.setScreenColumnWidthAt(0, 270);
    original.setRowHeightAt(1, 65);
    original.setCursorAtScreenPosition([1, 0]);
    const copy = original.copy();
    items.push(copy);
    expect(copy.table).toBe(table);
    expect(copy.displayTable).not.toBe(original.displayTable);
    expect(copy.order).toBe(original.order);
    expect(copy.direction).toBe(original.direction);
    expect(copy.getScreenColumnWidthAt(0)).toBe(270);
    expect(copy.getRowHeightAt(1)).toBe(65);
    expect(copy.getCursorScreenPosition()).toEqual(
      original.getCursorScreenPosition(),
    );
    expect(copy.getLastCursor()).not.toBe(original.getLastCursor());
    expect(lumine.views.getView(copy)).not.toBe(lumine.views.getView(original));
    copy.setScreenColumnWidthAt(0, 310);
    expect(original.getScreenColumnWidthAt(0)).toBe(270);
    original.destroy();
    expect(table.isDestroyed()).not.toBe(true);
    copy.setValueAtPosition([0, 0], "changed");
    expect(table.getRows()[0][0]).toBe("changed");
  });

  it("rejects an aborted copy before retaining resources", () => {
    const { TableEditor } = main.provideTableEditor();
    const original = new TableEditor();
    items.push(original);
    const controller = new AbortController();
    controller.abort();
    expect(() => original.copy({ signal: controller.signal })).toThrow();
  });
});
