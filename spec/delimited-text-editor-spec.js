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

    expect(getComputedStyle(form).display).toBe("block");
    expect(getComputedStyle(grid).display).toBe("grid");
    expect(getComputedStyle(preview).position).toBe("static");
    expect(customDelimiter.hidden).toBe(true);

    form.delimiterSelect.value = "custom";
    form.delimiterSelect.dispatchEvent(new Event("change", { bubbles: true }));
    expect(customDelimiter.hidden).toBe(false);
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
    tableElement.measureHeightAndWidth();
    tableElement.requestUpdate();
    await waitForFrames(() => !tableElement.updateRequested, {
      frames: 20,
      description: "the virtual table render",
    });
    expect(
      tableElement.querySelectorAll("table-editor-cell").length,
    ).toBeLessThan(1000);
    expect(item.editor.getRowCount()).toBe(500);
  });

  it("opens the cell editor after a complete double-click gesture", async () => {
    const item = await openTable();
    const itemElement = lumine.views.getView(item);
    itemElement.style.width = "800px";
    itemElement.style.height = "500px";
    const tableElement = itemElement.querySelector("table-editor");
    tableElement.style.width = "800px";
    tableElement.style.height = "500px";
    tableElement.measureHeightAndWidth();
    tableElement.requestUpdate();
    await waitForFrames(() => !tableElement.updateRequested, {
      frames: 20,
      description: "the table cell render",
    });

    const cell = tableElement.querySelector(
      'table-editor-cell[data-row="0"][data-column="0"]',
    );
    const bounds = cell.getBoundingClientRect();
    const dispatchMouse = (type, buttons) =>
      cell.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons,
          clientX: bounds.left + bounds.width / 2,
          clientY: bounds.top + bounds.height / 2,
        }),
      );

    for (let click = 0; click < 2; click++) {
      dispatchMouse("mousedown", 1);
      dispatchMouse("mouseup", 0);
      dispatchMouse("click", 0);
    }
    dispatchMouse("dblclick", 0);

    expect(tableElement.dragging).toBe(false);
    expect(tableElement.isEditing()).toBe(true);
    expect(tableElement.editorElement.matches("lumine-text-editor[mini]")).toBe(
      true,
    );
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
