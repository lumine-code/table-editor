const fs = require("fs");
const path = require("path");

describe("table-editor package", () => {
  let mainModule;

  beforeEach(async () => {
    const pkg = await lumine.packages.activatePackage("table-editor");
    mainModule = pkg.mainModule;
  });

  it("provides the clean 1.0 model API", () => {
    const api = mainModule.provideTableEditor();
    expect(Object.keys(api).sort()).toEqual([
      "DelimitedTextEditor",
      "DisplayTable",
      "Range",
      "Table",
      "TableEditor",
    ]);
    expect(api.CSVEditor).toBeUndefined();
  });

  it("uses a versioned package state and rejects legacy serialized state", () => {
    expect(mainModule.serialize()).toEqual({ version: 1, files: {} });
    expect(mainModule.deserializeTable({ columns: [], rows: [] })).toBeNull();
    expect(
      mainModule.deserializeDelimitedTextEditor({
        filePath: "missing.csv",
        deserializer: "CSVEditor",
      }),
    ).toBeNull();
  });

  it("leaves pane and dock tab presentation to core and the active theme", () => {
    const css = fs.readFileSync(
      path.join(__dirname, "..", "styles", "main.css"),
      "utf8",
    );
    expect(css).not.toContain(".tab-bar");
    expect(css).not.toContain("[data-type=");
  });

  it("inherits shared grid visuals and keeps only host layout styles", () => {
    const css = fs.readFileSync(
      path.join(__dirname, "..", "styles", "main.css"),
      "utf8",
    );
    expect(css).not.toContain("--canvas-grid-");
    expect(css).not.toContain("--table-editor-grid-");
    expect(css).not.toContain(".canvas-grid-viewport");
    expect(css).not.toContain(".canvas-grid-canvas");
    for (const legacySelector of [
      "table-editor-cell",
      "table-editor-header-cell",
      "table-editor-gutter-cell",
      "table-editor-selection",
      ".table-editor-rows",
      ".column-resize-ruler",
    ]) {
      expect(css).not.toContain(legacySelector);
    }
  });

  it("registers native custom element classes without lifecycle wrappers", () => {
    const DelimitedTextEditorElement = require("../lib/csv-editor-element");
    const DelimitedTextFormElement = require("../lib/csv-editor-form-element");
    const PreviewElement = require("../lib/csv-preview-element");
    const ProgressElement = require("../lib/csv-progress-element");
    const GoToCellElement = require("../lib/go-to-cell-element");
    const TableElement = require("../lib/table-element");

    expect(customElements.get("table-editor-delimited-text")).toBe(
      DelimitedTextEditorElement,
    );
    expect(customElements.get("table-editor-form")).toBe(
      DelimitedTextFormElement,
    );
    expect(customElements.get("table-editor-preview")).toBe(PreviewElement);
    expect(customElements.get("table-editor-progress")).toBe(ProgressElement);
    expect(customElements.get("table-editor-go-to-cell")).toBe(GoToCellElement);
    expect(customElements.get("table-editor")).toBe(TableElement);
    expect(DelimitedTextFormElement.name).toBe("DelimitedTextFormElement");
    expect(TableElement.name).toBe("TableElement");
    expect(document.createElement("table-editor-form")).toBeInstanceOf(
      DelimitedTextFormElement,
    );
    expect(
      document.createElement("table-editor-delimited-text"),
    ).toBeInstanceOf(DelimitedTextEditorElement);
    expect(document.createElement("table-editor-progress")).toBeInstanceOf(
      ProgressElement,
    );
    expect(document.createElement("table-editor-preview")).toBeInstanceOf(
      PreviewElement,
    );
    expect(document.createElement("table-editor-go-to-cell")).toBeInstanceOf(
      GoToCellElement,
    );
    expect(document.createElement("table-editor")).toBeInstanceOf(TableElement);
  });
});
