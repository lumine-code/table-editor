describe("Table Editor Go To Cell", () => {
  let item, view, dialog;

  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.workspace.getElement());
    await lumine.packages.activatePackage("table-editor");
    const Table = require("../lib/table");
    const TableEditor = require("../lib/table-editor");
    item = new TableEditor({
      table: new Table({
        columns: ["name", "value"],
        rows: [
          ["one", 1],
          ["two", 2],
        ],
      }),
    });
    await lumine.workspace.open(item);
    view = lumine.views.getView(item);
    dialog = view.openGoToCellModal();
  });

  afterEach(async () => {
    dialog?.destroy();
    await dialog?.inputDialogHost.destroy();
    item?.destroy();
  });

  it("uses the shared mini input and navigates the captured table by column name", async () => {
    const navigate = spyOn(view, "goToCell").and.callThrough();
    dialog.miniEditor.setText("2:value");
    lumine.commands.dispatch(dialog.miniEditor.element, "core:confirm");
    expect(navigate).toHaveBeenCalledOnceWith([2, "value"]);
    expect(item.getCursorPosition().row).toBe(1);
    expect(item.getCursorPosition().column).toBe(1);
    expect(dialog.destroyed).toBe(true);
    await dialog.inputDialogHost.destroy();
    expect(dialog.miniEditor.isDestroyed()).toBe(true);
  });

  it("keeps an oversized draft editable without reading it or moving the table", () => {
    dialog.miniEditor.setText("x".repeat(65537));
    const read = spyOn(dialog.miniEditor, "getText").and.throwError(
      "Oversized input read",
    );
    const navigate = spyOn(view, "goToCell");
    lumine.commands.dispatch(dialog.miniEditor.element, "core:confirm");
    expect(read).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(dialog.inputDialogHost.isVisible()).toBe(true);
    read.and.callThrough();
    dialog.miniEditor.setText("1:2");
    lumine.commands.dispatch(dialog.miniEditor.element, "core:confirm");
    expect(navigate).toHaveBeenCalledOnceWith([1, 2]);
  });

  it("destroys its shared input when cancelled or when the panel is destroyed", async () => {
    lumine.commands.dispatch(dialog.miniEditor.element, "core:cancel");
    expect(dialog.destroyed).toBe(true);
    await dialog.inputDialogHost.destroy();
    expect(dialog.miniEditor.isDestroyed()).toBe(true);
    dialog = view.openGoToCellModal();
    dialog.panel.destroy();
    await dialog.inputDialogHost.destroy();
    expect(dialog.destroyed).toBe(true);
    expect(dialog.miniEditor.isDestroyed()).toBe(true);
  });
});
