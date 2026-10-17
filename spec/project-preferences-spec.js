const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
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
      mutate: jasmine.createSpy("mutate").and.callFake((key, update) => {
        const value = update(structuredClone(stored[key]));
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
    expect(storage.mutate.calls.mostRecent().args[0]).toBe("filePreferences");
    expect(typeof storage.mutate.calls.mostRecent().args[1]).toBe("function");
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

describe("Table Editor durable preference operations", () => {
  let directory, base, managers, subscriptions, controllers, facades, states;

  beforeEach(async () => {
    jasmine.useRealClock();
    base = fs.realpathSync.native(os.tmpdir());
    directory = fs.mkdtempSync(path.join(base, "table-preference-windows-"));
    managers = [];
    subscriptions = [];
    controllers = [];
    facades = [];
    states = [];
    for (let index = 0; index < 2; index++) {
      const manager = new lumine.packages.storage.constructor();
      managers.push(manager);
      await manager.initialize({
        configDirPath: directory,
        projectPaths: ["same-project"],
        windowStateId: `table-window-${index}`,
      });
      const workspaceState = manager.forPackage("table-editor").workspaceState;
      const owner = new CompositeDisposable();
      const controller = new AbortController();
      const facade = { initialize: require("../lib/main").initialize };
      facade.initialize({
        workspaceState,
        subscriptions: owner,
        signal: controller.signal,
      });
      states.push(workspaceState);
      subscriptions.push(owner);
      controllers.push(controller);
      facades.push(facade);
    }
  });

  afterEach(async () => {
    controllers.forEach((controller) => controller.abort());
    subscriptions.forEach((owner) => owner.dispose());
    await Promise.all(managers.map((manager) => manager.close()));
    if (path.dirname(fs.realpathSync.native(directory)) !== base)
      throw new Error("Preference profile escaped its temporary parent");
    fs.rmSync(directory, { recursive: true, force: true });
  });

  async function committed() {
    await Promise.all(managers.map((manager) => manager.flush()));
    await flushMicrotasks(4);
    return states[0].mutate("filePreferences", (value) => value);
  }

  it("preserves concurrent changes to different files and different properties of one file", async () => {
    const [a, b] = facades.map((facade) => facade.filePreferences);
    const first = path.join(directory, "a.csv"),
      second = path.join(directory, "b.csv");
    a.set(first, "options", { delimiter: ";" });
    b.set(second, "options", { delimiter: "\t" });
    let result = await committed();
    expect(Object.keys(result.files).sort()).toEqual([first, second].sort());
    a.set(first, "options", { delimiter: "," });
    b.set(first, "layout", { columns: { 0: { width: 260 } } });
    result = await committed();
    expect(result.files[first]).toEqual({
      options: { delimiter: "," },
      layout: { columns: { 0: { width: 260 } } },
    });
    expect(facades[0].filePreferences).toBe(a);
    expect(facades[1].filePreferences).toBe(b);
  });

  it("applies stale clear and move operations to current stored preferences", async () => {
    const [a, b] = facades.map((facade) => facade.filePreferences);
    const first = path.join(directory, "a.csv"),
      moved = path.join(directory, "moved.csv"),
      other = path.join(directory, "b.csv");
    a.set(first, "options", { delimiter: ";" });
    await committed();
    b.set(first, "layout", { columns: { 0: { width: 260 } } });
    await committed();
    a.clearProperty("options", first);
    let result = await committed();
    expect(result.files[first]).toEqual({
      layout: { columns: { 0: { width: 260 } } },
    });
    b.move(first, moved);
    result = await committed();
    expect(result.files[first]).toBeUndefined();
    expect(result.files[moved]).toEqual({
      layout: { columns: { 0: { width: 260 } } },
    });
    a.clear();
    await committed();
    b.set(other, "options", { delimiter: "\t" });
    result = await committed();
    expect(result.files).toEqual({ [other]: { options: { delimiter: "\t" } } });
  });

  it("reads the new project's preferences immediately while an outgoing write is pending", async () => {
    const manager = managers[0];
    const preferences = facades[0].filePreferences;
    const filePath = path.join(directory, "shared.csv");
    await manager.switchProject(["other-project"]);
    preferences.set(filePath, "options", { delimiter: "\t" });
    await committed();
    await manager.switchProject(["same-project"]);
    preferences.set(filePath, "options", { delimiter: ";" });
    await committed();

    const update = manager.stateStore.update.bind(manager.stateStore);
    let releaseWrite, writeStarted;
    const heldWrite = new Promise((resolve) => (releaseWrite = resolve));
    const secondWriteStarted = new Promise(
      (resolve) => (writeStarted = resolve),
    );
    let writes = 0;
    spyOn(manager.stateStore, "update").and.callFake(async (...args) => {
      if (++writes === 2) {
        writeStarted();
        await heldWrite;
      }
      return update(...args);
    });
    preferences.set(filePath, "layout", { columns: { 0: { width: 260 } } });
    const switching = manager.switchProject(["other-project"]);
    expect(preferences.get(filePath, "options")).toEqual({ delimiter: "\t" });
    expect(preferences.get(filePath, "layout")).toBeUndefined();
    preferences.set(filePath, "layout", { columns: { 0: { width: 340 } } });
    try {
      await switching;
      await secondWriteStarted;
      await flushMicrotasks(4);
      expect(preferences.get(filePath, "options")).toEqual({ delimiter: "\t" });
      expect(preferences.get(filePath, "layout")).toEqual({
        columns: { 0: { width: 340 } },
      });
    } finally {
      releaseWrite();
    }
    await manager.flush();
    await flushMicrotasks(4);
    expect(preferences.get(filePath, "layout")).toEqual({
      columns: { 0: { width: 340 } },
    });
    await manager.switchProject(["same-project"]);
    expect(preferences.get(filePath, "options")).toEqual({ delimiter: ";" });
    expect(preferences.get(filePath, "layout")).toEqual({
      columns: { 0: { width: 260 } },
    });
  });
});
