const fs = require("fs");
const os = require("os");
const path = require("path");
const { FileState } = require("lumine");
const DelimitedTextEditor = require("../lib/csv-editor");

function pollUntil(condition, timeoutMs = 15000) {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (condition()) resolve();
      else if (performance.now() - start > timeoutMs) {
        reject(new Error("Timed out waiting for Table Editor"));
      } else requestAnimationFrame(check);
    };
    check();
  });
}

describe("delimited text pane item", () => {
  let directory, filePath, mainModule, workspaceElement;

  beforeEach(async () => {
    directory = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "table-editor-spec-")),
    );
    filePath = path.join(directory, "sample.csv");
    fs.writeFileSync(filePath, "name;value\r\nalpha;1\r\nbeta;2", "utf8");
    lumine.config.set("table-editor.showPreview", false);
    lumine.config.set("table-editor.delimitedText.header", true);
    lumine.config.set("table-editor.delimitedText.delimiter", "auto");
    lumine.config.set("table-editor.delimitedText.recordDelimiter", "auto");
    lumine.config.set("table-editor.delimitedText.encoding", "utf8");
    workspaceElement = lumine.views.getView(lumine.workspace);
    jasmine.attachToDOM(workspaceElement);
    const pkg = await lumine.packages.activatePackage("table-editor");
    mainModule = pkg.mainModule;
    mainModule.filePreferences.clear();
  });

  afterEach(async () => {
    for (const item of lumine.workspace.getPaneItems()) {
      const pane = lumine.workspace.paneForItem(item);
      if (pane) await pane.destroyItem(item, true);
      else item.destroy?.();
    }
    // Let asynchronous native watcher startup observe disposal before its
    // parent directory is removed; otherwise the worker reports a false ENOENT.
    await timeoutPromise(300);
    fs.rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 50,
    });
  });

  async function openTable() {
    const item = await lumine.workspace.open(filePath);
    await pollUntil(() => item.editor != null);
    return item;
  }

  it("opens configured extensions and leaves unrelated files to the text editor", async () => {
    const item = await openTable();
    expect(item instanceof DelimitedTextEditor).toBe(true);
    expect(item.editor.getColumns()).toEqual(["name", "value"]);
    expect(item.editor.getRows()).toEqual([
      ["alpha", "1"],
      ["beta", "2"],
    ]);

    const textPath = path.join(directory, "notes.txt");
    fs.writeFileSync(textPath, "plain text");
    const textItem = await lumine.workspace.open(textPath);
    expect(lumine.workspace.isTextEditor(textItem)).toBe(true);
  });

  it("keeps delimited-text pane items in the workspace center", async () => {
    const item = await lumine.workspace.open(filePath, { location: "bottom" });
    await pollUntil(() => item.editor != null);
    const pane = lumine.workspace.paneForItem(item);

    expect(item.getDefaultLocation()).toBe("center");
    expect(item.getAllowedLocations()).toEqual(["center"]);
    expect(item.getIconName).toBeUndefined();
    expect(pane.getContainer().getLocation()).toBe("center");
    expect(lumine.workspace.getBottomDock().getPaneItems()).not.toContain(item);
    expect(
      lumine.workspace.getBottomDock().getActivePane().isItemAllowed(item),
    ).toBe(false);
  });

  it("shows the parsing preview before an unremembered choice", async () => {
    lumine.config.set("table-editor.showPreview", true);
    const item = await lumine.workspace.open(filePath);
    const element = lumine.views.getView(item);
    await pollUntil(() => element.querySelector("table-editor-form") != null);
    expect(item.editor).toBeUndefined();
    expect(element.querySelector("table-editor-preview")).not.toBeNull();
    expect(
      element.querySelector(".table-editor-normalization-warning").hidden,
    ).toBe(true);
  });

  it("lays out the opening form without legacy absolute positioning", async () => {
    lumine.config.set("table-editor.showPreview", true);
    const item = await lumine.workspace.open(filePath);
    const element = lumine.views.getView(item);
    await pollUntil(() => element.querySelector("table-editor-form") != null);
    const form = element.querySelector("table-editor-form");
    const grid = form.querySelector(".table-editor-settings-grid");
    const preview = form.querySelector("table-editor-preview");
    const customDelimiter = form.delimiterCustomField;
    const syntax = form.querySelector(
      ".table-editor-settings-column:not(.table-editor-settings-behavior)",
    );
    const behavior = form.querySelector(".table-editor-settings-behavior");
    const toggles = form.querySelector(".table-editor-toggle-row");
    const messages = form.querySelector(".table-editor-messages");
    const warning = form.querySelector(".table-editor-normalization-warning");

    expect(getComputedStyle(form).display).toBe("block");
    expect(getComputedStyle(grid).display).toBe("grid");
    expect(getComputedStyle(preview).position).toBe("static");
    expect(customDelimiter.hidden).toBe(true);
    expect(behavior.contains(form.commentField)).toBe(true);
    expect(syntax.contains(form.commentField)).toBe(false);
    expect(toggles.children.length).toBe(3);
    expect(getComputedStyle(toggles).display).toBe("flex");
    expect(form.querySelector("select")).toBeNull();
    expect(form.querySelectorAll(".select-box[role='combobox']").length).toBe(
      5,
    );
    expect(form.delimiterSelect.element.getAttribute("aria-label")).toBe(
      "Field Delimiter",
    );
    expect(
      toggles.compareDocumentPosition(messages) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      messages.compareDocumentPosition(warning) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      warning.compareDocumentPosition(preview) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await form.delimiterSelect.open();
    const customOption = Array.from(
      form.delimiterSelect.popup.element.querySelectorAll(".select-box-option"),
    ).find((option) => option.textContent === "Custom");
    customOption.click();
    expect(form.delimiterSelect.value).toBe("custom");
    expect(form.delimiterSelect.popup).toBeNull();
    expect(customDelimiter.hidden).toBe(false);
    expect(form.openTableEditorButton.disabled).toBe(true);

    form.delimiterCustomInput.value = ":";
    form.delimiterCustomInput.dispatchEvent(
      new Event("input", { bubbles: true }),
    );
    await pollUntil(() => !form.openTableEditorButton.disabled);
  });

  it("cancels a queued progress paint when the progress view is removed", async () => {
    const item = await openTable();
    const element = lumine.views.getView(item);
    element.ensureProgress();
    element.input = {
      getProgress: () => ({ total: 100, length: 50, ratio: 0.5 }),
    };
    element.lines = 12;
    element.requestProgressUpdate();
    expect(element.frameRequested).toBe(true);
    element.hideProgress();
    await timeoutPromise(30);
    expect(element.progress).toBeNull();
    expect(element.progressFrame).toBeNull();
    expect(element.frameRequested).toBe(false);
  });

  it("publishes modified, conflicted, and unmodified file states", async () => {
    const item = await openTable();
    const states = [];
    item.onDidChangeFileState((state) => states.push(state));
    item.editor.setValueAtPosition([0, 1], "changed");
    expect(item.getFileState()).toBe(FileState.MODIFIED);

    await item.document.handleDiskChange();
    expect(item.getFileState()).toBe(FileState.CONFLICTED);

    await item.save();
    expect(item.getFileState()).toBe(FileState.UNMODIFIED);
    expect(fs.readFileSync(filePath, "utf8")).toBe(
      "name;value\r\nalpha;changed\r\nbeta;2",
    );
    expect(states).toEqual([
      FileState.MODIFIED,
      FileState.CONFLICTED,
      FileState.UNMODIFIED,
    ]);
  });

  it("shares file data but not display state between copied pane items", async () => {
    const first = await openTable();
    const second = first.copy();
    expect(second.document).toBe(first.document);
    expect(second.editor.table).toBe(first.editor.table);
    expect(second.editor.displayTable).not.toBe(first.editor.displayTable);
    second.editor.setScreenColumnWidthAt(0, 260);
    expect(first.editor.getScreenColumnWidthAt(0)).not.toBe(260);
    second.destroy();
  });

  it("serializes dirty data with namespaced versioned state", async () => {
    const item = await openTable();
    item.editor.setValueAtPosition([1, 0], "dirty");
    const state = item.serialize();
    expect(state.deserializer).toBe("table-editor/DelimitedTextEditor");
    expect(state.version).toBe(1);
    expect(state.editor.deserializer).toBe("table-editor/TableEditor");
    expect(state.editor.displayTable.table.modified).toBe(true);
    expect(state.metadata.stats).toBeUndefined();
    expect(Array.isArray(state.metadata.bom)).toBe(true);

    const pane = lumine.workspace.paneForItem(item);
    pane.removeItem(item, false);
    item.destroy();
    const restored = mainModule.deserializeDelimitedTextEditor(state);
    await pollUntil(() => restored.editor != null);
    expect(restored.getFileState()).toBe(FileState.MODIFIED);
    restored.destroy();
  });

  it("renders only a viewport-sized subset of a large table", async () => {
    const rows = ["name,value"];
    for (let index = 0; index < 500; index++)
      rows.push(`row-${index},${index}`);
    fs.writeFileSync(filePath, rows.join("\n"));
    const item = await openTable();
    const itemElement = lumine.views.getView(item);
    itemElement.style.width = "800px";
    itemElement.style.height = "500px";
    const tableElement = itemElement.querySelector("table-editor");
    tableElement.style.width = "800px";
    tableElement.style.height = "500px";
    await waitForFrames(() => tableElement.grid != null, {
      frames: 20,
      description: "the virtual table render",
    });
    expect(tableElement.querySelectorAll("table-editor-cell").length).toBe(0);
    expect(tableElement.querySelector(".canvas-grid-canvas")).not.toBeNull();
    expect(tableElement.querySelector(".canvas-grid-overlay")).not.toBeNull();
    expect(item.editor.getRowCount()).toBe(500);
  });

  it("tears down the grid adapter with its pane item", async () => {
    const item = await openTable();
    const itemElement = lumine.views.getView(item);
    const tableElement = itemElement.querySelector("table-editor");
    const adapter = tableElement.gridAdapter;
    const grid = adapter.grid;
    const pane = lumine.workspace.paneForItem(item);

    pane.removeItem(item, false);
    item.destroy();

    expect(adapter.destroyed).toBe(true);
    expect(grid.destroyed).toBe(true);
    expect(tableElement.isDestroyed()).toBe(true);
    expect(tableElement.isConnected).toBe(false);
  });

  it("opens the cell editor after a complete double-click gesture", async () => {
    const item = await openTable();
    const itemElement = lumine.views.getView(item);
    itemElement.style.width = "800px";
    itemElement.style.height = "500px";
    const tableElement = itemElement.querySelector("table-editor");
    tableElement.style.width = "800px";
    tableElement.style.height = "500px";
    await waitForFrames(() => tableElement.grid != null, {
      frames: 20,
      description: "the table cell render",
    });

    const grid = tableElement.grid;
    grid.resize(800, 500);
    const target = grid.element;
    const cell = grid.getCellRect(0, 0);
    const dispatchMouse = (type, buttons) =>
      target.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons,
          clientX: cell.left + 10,
          clientY: cell.top + 10,
        }),
      );

    for (let click = 0; click < 2; click++) {
      dispatchMouse("mousedown", 1);
      dispatchMouse("mouseup", 0);
      dispatchMouse("click", 0);
    }
    dispatchMouse("dblclick", 0);

    expect(grid.dragging).toBe(false);
    expect(tableElement.isEditing()).toBe(true);
    expect(tableElement.editorElement.matches("lumine-text-editor[mini]")).toBe(
      true,
    );
  });

  it("keeps the original anchor while extending a selection up and left", async () => {
    const item = await openTable();
    item.editor.addColumn("third");
    item.editor.addColumn("fourth");
    item.editor.addRow(["gamma", "3", "c", "d"]);
    item.editor.addRow(["delta", "4", "e", "f"]);
    const tableElement = lumine.views
      .getView(item)
      .querySelector("table-editor");
    const grid = tableElement.grid;

    grid.startSelection({ zone: "body", row: 3, column: 3 });
    grid.extendSelection({ zone: "body", row: 2, column: 2 }, false);
    grid.extendSelection({ zone: "body", row: 1, column: 1 }, false);

    expect(grid.normalizedSelections()).toEqual([
      { r0: 1, c0: 1, r1: 3, c1: 3 },
    ]);
    expect(item.editor.getSelectedRange().serialize()).toEqual([
      [1, 1],
      [4, 4],
    ]);
    expect(item.editor.getCursorScreenPosition().serialize()).toEqual([1, 1]);
  });

  it("replaces every previous model selection when a new gesture starts", async () => {
    const item = await openTable();
    const tableElement = lumine.views
      .getView(item)
      .querySelector("table-editor");
    const grid = tableElement.grid;

    grid.startSelection({ zone: "body", row: 0, column: 0 });
    grid.startSelection({ zone: "body", row: 1, column: 1 }, true);
    expect(item.editor.getSelections().length).toBe(2);

    grid.startSelection({ zone: "body", row: 0, column: 1 });
    expect(item.editor.getSelections().length).toBe(1);
    expect(item.editor.getSelectedRange().serialize()).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });

  it("moves the active cell while Shift-arrows extend and shrink from a fixed anchor", async () => {
    const item = await openTable();
    const tableElement = lumine.views
      .getView(item)
      .querySelector("table-editor");
    const grid = tableElement.grid;
    grid.startSelection({ zone: "body", row: 1, column: 1 });

    lumine.commands.dispatch(grid.element, "core:select-up");
    expect(item.editor.getSelectedRange().serialize()).toEqual([
      [0, 1],
      [2, 2],
    ]);
    expect(item.editor.getCursorScreenPosition().serialize()).toEqual([0, 1]);

    lumine.commands.dispatch(grid.element, "core:select-left");
    expect(item.editor.getSelectedRange().serialize()).toEqual([
      [0, 0],
      [2, 2],
    ]);
    expect(item.editor.getCursorScreenPosition().serialize()).toEqual([0, 0]);

    lumine.commands.dispatch(grid.element, "core:select-right");
    lumine.commands.dispatch(grid.element, "core:select-down");
    expect(item.editor.getSelectedRange().serialize()).toEqual([
      [1, 1],
      [2, 2],
    ]);
    expect(item.editor.getCursorScreenPosition().serialize()).toEqual([1, 1]);
  });

  it("synchronizes canvas selections, variable row sizes, and context zones", async () => {
    const item = await openTable();
    const tableElement = lumine.views
      .getView(item)
      .querySelector("table-editor");
    const grid = tableElement.grid;
    grid.resize(800, 500);

    grid.startSelection({ zone: "body", row: 0, column: 0 });
    grid.extendSelection({ zone: "body", row: 1, column: 1 });
    expect(item.editor.getSelectedRange().serialize()).toEqual([
      [0, 0],
      [2, 2],
    ]);
    expect(item.editor.getCursorScreenPosition().serialize()).toEqual([1, 1]);

    grid.setRowSize(1, 36);
    expect(item.editor.getScreenRowHeightAt(1)).toBe(36);

    const row = grid.getRowRect(0);
    grid.element.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: row.left + 4,
        clientY: row.top + 4,
      }),
    );
    expect(tableElement.dataset.contextZone).toBe("row");
    expect(tableElement.contextMenuRow).toBe(0);
  });

  it("fits cells through the public grid measurement facade", async () => {
    const item = await openTable();
    const tableElement = lumine.views
      .getView(item)
      .querySelector("table-editor");
    const initialWidth = item.editor.getScreenColumnWidthAt(0);
    const initialHeight = item.editor.getScreenRowHeightAt(0);
    item.editor.setValueAtPosition(
      [0, 0],
      "a value wide enough to grow the column",
    );
    item.editor.setValueAtPosition([0, 1], "first\nsecond\nthird");

    await tableElement.fitColumnToContent(0);
    await tableElement.fitRowToContent(0);

    expect(item.editor.getScreenColumnWidthAt(0)).toBeGreaterThan(initialWidth);
    expect(item.editor.getScreenRowHeightAt(0)).toBeGreaterThan(initialHeight);
  });

  it("updates both resize axes when read-only changes", async () => {
    const item = await openTable();
    const tableElement = lumine.views
      .getView(item)
      .querySelector("table-editor");

    tableElement.setAttribute("read-only", "");
    expect(tableElement.grid.setResizable()).toEqual({
      columns: false,
      rows: false,
    });
    tableElement.removeAttribute("read-only");
    expect(tableElement.grid.setResizable()).toEqual({
      columns: true,
      rows: true,
    });
  });

  it("selects headers on click and sorts columns through Alt-click or the context menu", async () => {
    const item = await openTable();
    const tableElement = lumine.views
      .getView(item)
      .querySelector("table-editor");
    const grid = tableElement.grid;
    grid.startSelection({ zone: "column", row: 0, column: 1 });
    expect(item.editor.getSelectedRange().serialize()).toEqual([
      [0, 1],
      [2, 2],
    ]);
    expect(item.editor.order).toBeUndefined();

    expect(grid.requestSort(0, "cycle", "alt-click")).toBe(true);
    expect(item.editor.order).toBe(0);
    expect(item.editor.direction).toBe(1);

    tableElement.setContextMenuTarget({ zone: "column", row: 0, column: 1 });
    lumine.commands.dispatch(tableElement, "table-editor:sort-descending");
    expect(item.editor.order).toBe(1);
    expect(item.editor.direction).toBe(-1);
    lumine.commands.dispatch(tableElement, "table-editor:clear-sort");
    expect(item.editor.order).toBeNull();
  });

  it("keeps gutter numbers attached to model rows while sorting", async () => {
    const item = await openTable();
    const tableElement = lumine.views
      .getView(item)
      .querySelector("table-editor");
    const rowLabel = (screenRow) =>
      tableElement.gridAdapter.rowLabel(screenRow);

    expect([rowLabel(0), rowLabel(1)]).toEqual([1, 2]);
    item.editor.sortBy(0, -1);
    expect(item.editor.getScreenRows().map((row) => row[0])).toEqual([
      "beta",
      "alpha",
    ]);
    expect([rowLabel(0), rowLabel(1)]).toEqual([2, 1]);

    item.editor.applySort();
    expect([rowLabel(0), rowLabel(1)]).toEqual([1, 2]);
  });

  it("dispatches clipboard and history commands once from the canvas surface", async () => {
    const item = await openTable();
    const tableElement = lumine.views
      .getView(item)
      .querySelector("table-editor");
    const grid = tableElement.grid;
    grid.startSelection({ zone: "body", row: 0, column: 0 });
    grid.extendSelection({ zone: "body", row: 1, column: 1 });

    lumine.commands.dispatch(grid.element, "core:copy");
    expect(lumine.clipboard.read().replace(/\r\n/g, "\n")).toBe(
      "alpha\t1\nbeta\t2",
    );
    lumine.clipboard.write("changed");
    lumine.commands.dispatch(grid.element, "core:paste");
    expect(item.editor.getRows()).toEqual([
      ["changed", "changed"],
      ["changed", "changed"],
    ]);
    lumine.commands.dispatch(grid.element, "core:undo");
    expect(item.editor.getRows()).toEqual([
      ["alpha", "1"],
      ["beta", "2"],
    ]);
  });

  it("renames a canvas column header through the native mini editor", async () => {
    const item = await openTable();
    const tableElement = lumine.views
      .getView(item)
      .querySelector("table-editor");
    const grid = tableElement.grid;
    grid.resize(800, 500);
    const column = grid.getColumnRect(0);
    grid.element.dispatchEvent(
      new MouseEvent("dblclick", {
        bubbles: true,
        detail: 2,
        clientX: column.left + 10,
        clientY: column.top + column.height / 2,
      }),
    );

    expect(tableElement.isEditing()).toBe(true);
    expect(tableElement.editingKind).toBe("column");
    tableElement.editor.setText("renamed");
    lumine.commands.dispatch(tableElement.editorElement, "core:confirm");
    expect(item.editor.getScreenColumn(0).name).toBe("renamed");
  });

  it("does not expose a partial table when parsing fails", async () => {
    fs.writeFileSync(filePath, "a,b\n1,2,3\n", "utf8");
    const item = await lumine.workspace.open(filePath);
    const element = lumine.views.getView(item);
    await pollUntil(() => element.querySelector(".alert-danger") != null);
    expect(item.editor).toBeUndefined();
    expect(item.document.table).toBeUndefined();
  });
});
