describe("Table Editor complete input budgets", () => {
  let main, models;
  beforeEach(async () => {
    models = [];
    main = (await lumine.packages.activatePackage("table-editor")).mainModule;
  });
  afterEach(async () => {
    for (const model of models) model.destroy();
    await lumine.packages.deactivatePackage("table-editor");
  });
  function create() {
    const { Table, TableEditor } = main.provideTableEditor();
    const table = new Table({ columns: ["A", "B"], rows: [["keep", "other"]] });
    const editor = new TableEditor({ table });
    models.push(editor);
    const view = lumine.views.getView(editor);
    jasmine.attachToDOM(view);
    table.initializeAfterSetup();
    return { table, editor, view };
  }
  for (const kind of ["Cell", "Column"]) {
    it(`keeps an oversized ${kind.toLowerCase()} draft and checks metadata before reading`, () => {
      const { table, editor, view } = create();
      view[`start${kind}Edit`]();
      const limit = kind === "Cell" ? 1024 * 1024 : 65536;
      view.editor.setText("x".repeat(limit + 1));
      const reading = spyOn(view.editor, "getText").and.throwError(
        "Oversized draft read",
      );
      const before = editor.getCursorScreenPosition();
      lumine.commands.dispatch(
        view.editorElement,
        "table-editor:move-right-in-selection",
      );
      expect(reading).not.toHaveBeenCalled();
      expect(view.isEditing()).toBe(true);
      expect(view.editor.getBuffer().getLength()).toBe(limit + 1);
      expect(editor.getCursorScreenPosition()).toEqual(before);
      expect(table.getRows()).toEqual([["keep", "other"]]);
      reading.and.callThrough();
      view.editor.setText("ż😀\r\nexact");
      view[`confirm${kind}Edit`]();
      expect(view.isEditing()).toBe(false);
      if (kind === "Cell") expect(table.getRows()[0][0]).toBe("ż😀\r\nexact");
      else expect(editor.getScreenColumn(0).name).toBe("ż😀\r\nexact");
    });
  }
  it("checks rectangle metadata before copying and never cuts after rejection", async () => {
    const { table, editor, view } = create();
    editor.getLastSelection().getRange().end.column = 10001;
    const reading = spyOn(editor.getLastSelection(), "getValue").and.throwError(
      "Oversized rectangle read",
    );
    const write = spyOn(lumine.clipboard, "write");
    expect(await view.cutSelectedCells()).toBe(false);
    expect(reading).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(table.getRows()).toEqual([["keep", "other"]]);
  });
  it("validates every pasted block before changing the first selection", async () => {
    const { table, editor, view } = create();
    editor.setSelectedRanges([
      [
        [0, 0],
        [1, 1],
      ],
      [
        [0, 1],
        [1, 2],
      ],
    ]);
    spyOn(lumine.clipboard, "readWithMetadata").and.returnValue({
      text: "first",
      metadata: { values: [[["first"]], [["x".repeat(1024 * 1024 + 1)]]] },
    });
    expect(await view.pasteClipboard()).toBe(false);
    expect(table.getRows()).toEqual([["keep", "other"]]);
    expect(table.isModified()).toBe(false);
  });
});
