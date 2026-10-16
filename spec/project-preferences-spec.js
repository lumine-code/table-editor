const path = require("node:path");
const { CompositeDisposable, Disposable } = require("lumine");

describe("Table Editor project preferences", () => {
  let subscriptions, main, stored, observers, storage;
  const filePath = path.resolve("sample.csv");

  beforeEach(() => {
    stored = {};
    observers = new Set();
    subscriptions = new CompositeDisposable();
    storage = {
      get: (key, fallback) => structuredClone(stored[key] ?? fallback),
      update: jasmine.createSpy("update").and.callFake((key, value) => {
        stored[key] = structuredClone(value);
        for (const callback of observers) callback(structuredClone(value));
        return Promise.resolve();
      }),
      observe(_key, callback) {
        observers.add(callback);
        callback(stored.filePreferences);
        return new Disposable(() => observers.delete(callback));
      },
    };
    main = { initialize: require("../lib/main").initialize };
    main.initialize({ workspaceState: storage, subscriptions });
  });

  afterEach(() => subscriptions.dispose());

  it("writes remembered file options through project storage separately from recovery", () => {
    main.filePreferences.set(filePath, "options", {
      delimiter: ";",
      header: true,
    });

    expect(stored.filePreferences).toEqual({
      version: 1,
      files: { [filePath]: { options: { delimiter: ";", header: true } } },
    });
    expect(storage.update).toHaveBeenCalledWith(
      "filePreferences",
      stored.filePreferences,
    );
    main.filePreferences.clear(filePath);
    expect(stored.filePreferences).toEqual({ version: 1, files: {} });
  });

  it("rebinds project preferences in place and keeps later writes in the current project", async () => {
    const preferences = main.filePreferences;
    preferences.set(filePath, "options", { delimiter: ";" });
    await flushMicrotasks(4);
    const outgoing = structuredClone(stored);
    stored = { filePreferences: { version: 1, files: {} } };
    for (const callback of observers) callback(stored.filePreferences);

    expect(main.filePreferences).toBe(preferences);
    expect(preferences.get(filePath)).toBeUndefined();
    preferences.set(filePath, "options", { delimiter: "\t" });
    expect(outgoing.filePreferences.files[filePath].options.delimiter).toBe(
      ";",
    );
    expect(stored.filePreferences.files[filePath].options.delimiter).toBe("\t");
  });
});
