describe("Table Editor native history and presentation", () => {
  let main, editors;

  function create(rows = [["b"], ["d"], ["a"], ["c"]]) {
    const { Table, TableEditor } = main.provideTableEditor();
    const table = new Table({
      columns: ["name"],
      rows: rows.map((row) => [...row]),
    });
    const editor = new TableEditor({ table });
    editors.push(editor);
    const view = lumine.views.getView(editor);
    jasmine.attachToDOM(view);
    table.initializeAfterSetup();
    return { table, editor, view };
  }

  beforeEach(async () => {
    editors = [];
    const shell = lumine.shell;
    for (const method of [
      "openPath",
      "openExternal",
      "openApplication",
      "showItemInFolder",
    ]) {
      spyOn(shell, method).and.callFake(() => {
        throw Error(`Unexpected shell ${method}`);
      });
    }
    spyOn(lumine.application, "openWindow").and.callFake(() => {
      throw Error("Unexpected window");
    });
    const pack = await lumine.packages.activatePackage("table-editor");
    main = pack.mainModule;
    jasmine.attachToDOM(lumine.workspace.getElement());
  });

  afterEach(async () => {
    for (const editor of editors) if (!editor.isDestroyed()) editor.destroy();
    await lumine.packages.deactivatePackage("table-editor");
  });

  it("restores the descending display order when undoing an applied sort", () => {
    const { table, editor, view } = create();
    editor.sortBy(0, -1);
    expect(editor.getScreenRows().flat()).toEqual(["d", "c", "b", "a"]);
    lumine.commands.dispatch(view, "table-editor:apply-sort");
    expect(table.getRows().flat()).toEqual(["d", "c", "b", "a"]);
    lumine.commands.dispatch(view, "core:undo");
    expect(table.getRows().flat()).toEqual(["b", "d", "a", "c"]);
    expect(editor.getScreenRows().flat()).toEqual(["d", "c", "b", "a"]);
    lumine.commands.dispatch(view, "core:redo");
    expect(table.getRows().flat()).toEqual(["d", "c", "b", "a"]);
  });

  it("restores row height overrides when undoing a nonzero model range deletion", () => {
    const { table, editor, view } = create();
    editor.setRowHeightAt(2, 70);
    editor.setRowHeightAt(3, 90);
    editor.removeRowsInRange([2, 4]);
    expect(table.getRows().flat()).toEqual(["b", "d"]);
    lumine.commands.dispatch(view, "core:undo");
    expect(table.getRows().flat()).toEqual(["b", "d", "a", "c"]);
    expect(editor.getRowHeightAt(2)).toBe(70);
    expect(editor.getRowHeightAt(3)).toBe(90);
  });

  it("updates the visible column header through rename undo and redo", () => {
    const { table, editor, view } = create();
    editor.getScreenColumn(0).name = "changed";
    expect(table.getColumns()).toEqual(["changed"]);
    lumine.commands.dispatch(view, "core:undo");
    expect(table.getColumns()).toEqual(["name"]);
    expect(editor.getScreenColumn(0).name).toBe("name");
    lumine.commands.dispatch(view, "core:redo");
    expect(table.getColumns()).toEqual(["changed"]);
    expect(editor.getScreenColumn(0).name).toBe("changed");
  });

  it("fits the selected visible row after sorting", async () => {
    const { editor, view } = create([["z"], ["a\nb\nc"]]);
    editor.sortBy(0, 1);
    editor.setCursorAtScreenPosition([0, 0]);
    const expected = Math.max(
      editor.getMinimumRowHeight(),
      3 * view.gridAdapter.getFontMetrics().lineHeight + 6,
    );
    lumine.commands.dispatch(view, "table-editor:fit-row-to-content");
    expect(editor.getScreenRowHeightAt(0)).toBe(expected);
  });

  it("keeps ordinary ascending sort undo and selected row deletion consistent", () => {
    const { table, editor, view } = create();
    editor.sortBy(0, 1);
    lumine.commands.dispatch(view, "table-editor:apply-sort");
    lumine.commands.dispatch(view, "core:undo");
    expect(editor.getScreenRows().flat()).toEqual(["a", "b", "c", "d"]);
    editor.setSelectedRange([
      [0, 0],
      [1, 1],
    ]);
    lumine.commands.dispatch(view, "table-editor:delete-row");
    expect(table.getRows().flat()).toEqual(["b", "d", "c"]);
    lumine.commands.dispatch(view, "core:undo");
    expect(table.getRows().flat()).toEqual(["b", "d", "a", "c"]);
  });
});
