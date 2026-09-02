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
  });
});
