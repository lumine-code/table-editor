describe("Table Editor application menu context", () => {
  beforeEach(async () => {
    await lumine.packages.activatePackage("table-editor");
    spyOn(lumine.notifications, "addWarning");
    spyOn(lumine.workspace, "getActiveTextEditor").and.returnValue(null);
  });

  afterEach(async () => {
    await lumine.packages.deactivatePackage("table-editor");
  });

  it("explains why a non-text pane item cannot be opened as a table", () => {
    spyOn(lumine.workspace, "getActivePaneItem").and.returnValue({});
    lumine.commands.dispatch(
      lumine.workspace.getElement(),
      "table-editor:open-as-table",
    );
    expect(lumine.notifications.addWarning).toHaveBeenCalledOnceWith(
      "Activate a saved text file before opening it as a table.",
    );
  });

  it("stays quiet when there is no active pane item", () => {
    spyOn(lumine.workspace, "getActivePaneItem").and.returnValue(null);
    lumine.commands.dispatch(
      lumine.workspace.getElement(),
      "table-editor:open-as-table",
    );
    expect(lumine.notifications.addWarning).not.toHaveBeenCalled();
  });
});
