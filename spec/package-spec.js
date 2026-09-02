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
});
