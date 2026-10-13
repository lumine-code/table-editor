"use strict";

const fs = require("fs");
const path = require("path");
const { CompositeDisposable, Emitter, watchFile } = require("lumine");
const Table = require("./table");
const {
  readDelimitedFile,
  writeDelimitedFileAtomically,
} = require("./delimited-io");
const columnName = require("./column-name");

const documents = new Map();
let restoredDocuments = new Map();
const keyFor = (filePath) =>
  process.platform === "win32"
    ? path.resolve(filePath).toLowerCase()
    : path.resolve(filePath);

class DelimitedDocument {
  static acquire(filePath, options = {}, state = {}) {
    const key = keyFor(filePath);
    const table = state.tableId != null ? Table.restore(state.tableId) : null;
    let document = documents.get(key);
    if (document?.destroyed || (table && document?.table !== table))
      document = null;
    if (!document) {
      document = new DelimitedDocument(path.resolve(filePath), options, state);
      documents.set(key, document);
      if (state.tableId != null) restoredDocuments.set(key, document);
    }
    document.references++;
    return document;
  }

  static get(filePath) {
    return documents.get(keyFor(filePath));
  }

  static restoreState() {
    restoredDocuments = new Map();
  }

  constructor(filePath, options, state) {
    this.filePath = filePath;
    this.options = { ...options };
    this.metadata = state.metadata || null;
    this.references = 0;
    this.fileState =
      state.fileState ?? (state.table?.modified ? "modified" : "unmodified");
    this.emitter = new Emitter();
    this.subscriptions = new CompositeDisposable();
    this.loadController = null;
    this.reloadTimer = null;
    this.ignoreChangesUntil = 0;
    this.observedDiskFingerprint = this.diskFingerprint();
    this.fileOperationDepth = 0;
    this.documentRegistration = lumine.workspace.registerFileDocument({
      owner: this,
      getPath: () => this.filePath,
      setPath: (nextPath) => this.setPath(nextPath),
      beginFileOperation: () => {
        this.fileOperationDepth++;
        clearTimeout(this.reloadTimer);
        this.loadController?.abort();
      },
      endFileOperation: () => {
        this.fileOperationDepth--;
        return this.handleDiskChange();
      },
    });
    if (state.tableId != null) {
      const table = Table.restore(state.tableId);
      if (!table) throw new Error("The saved table document is unavailable.");
      this.replaceTable(table);
      if (
        state.diskFingerprint !== undefined &&
        state.diskFingerprint !== this.observedDiskFingerprint
      )
        this.setFileState(
          this.observedDiskFingerprint === null ? "removed" : "conflicted",
        );
    } else if (state.table) this.replaceTable(Table.deserialize(state.table));
    this.installWatcher();
  }

  installWatcher() {
    const watcher = watchFile(this.filePath);
    this.watcher = watcher;
    const reconcile = (force = false) => {
      if (this.watcher === watcher) return this.handleDiskChange(force);
    };
    this.subscriptions.add(
      watcher,
      watcher.onDidChange(() => reconcile(true)),
      watcher.onDidInvalidate(() => reconcile()),
      watcher.onDidError((error) =>
        console.error("Unable to watch table", error),
      ),
    );
    watcher.ready.then(
      () => reconcile(),
      () => {},
    );
  }

  setPath(nextPath) {
    nextPath = path.resolve(nextPath);
    if (nextPath === this.filePath) return;
    if (documents.get(keyFor(this.filePath)) === this)
      documents.delete(keyFor(this.filePath));
    if (restoredDocuments.get(keyFor(this.filePath)) === this)
      restoredDocuments.delete(keyFor(this.filePath));
    this.filePath = nextPath;
    documents.set(keyFor(nextPath), this);
    this.resetWatcher();
    this.emitter.emit("did-change-path", nextPath);
  }

  resetWatcher() {
    this.subscriptions.dispose();
    this.subscriptions = new CompositeDisposable();
    this.installWatcher();
  }

  diskFingerprint() {
    try {
      const stat = fs.statSync(this.filePath);
      return `${stat.mtimeMs}:${stat.size}`;
    } catch {
      return null;
    }
  }

  async handleDiskChange(force = false) {
    if (this.destroyed || this.fileOperationDepth) return;
    if (Date.now() < this.ignoreChangesUntil) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = setTimeout(
        () => {
          this.reloadTimer = null;
          void this.handleDiskChange();
        },
        this.ignoreChangesUntil - Date.now() + 1,
      );
      return;
    }
    const fingerprint = this.diskFingerprint();
    if (!force && fingerprint === this.observedDiskFingerprint) return;
    this.observedDiskFingerprint = fingerprint;
    if (fingerprint === null) {
      this.setFileState("removed");
      return;
    }
    if (this.isModified()) {
      this.setFileState("conflicted");
      return;
    }
    clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      this.load(this.options).catch((error) => {
        this.setFileState("conflicted");
        this.emitter.emit("did-fail-load", error);
      });
    }, 150);
  }

  async load(options = this.options, controls = {}) {
    this.loadController?.abort();
    const controller = new AbortController();
    this.loadController = controller;
    this.options = { ...options };
    const result = await readDelimitedFile(this.filePath, this.options, {
      ...controls,
      signal: controller.signal,
    });
    if (!result || controller.signal.aborted) return null;
    if (this.loadController === controller) this.loadController = null;
    this.metadata = result.metadata;
    this.observedDiskFingerprint = `${result.metadata.stats.mtimeMs}:${result.metadata.stats.size}`;
    const rows = result.rows;
    const width = rows.reduce(
      (maximum, row) => Math.max(maximum, row.length),
      0,
    );
    let columns;
    if (this.options.header && rows.length) columns = rows.shift();
    else
      columns = Array.from({ length: width }, (_, index) => columnName(index));
    while (columns.length < width) columns.push(columnName(columns.length));
    for (const row of rows) while (row.length < columns.length) row.push("");
    const table = new Table({ columns, rows });
    table.initializeAfterSetup();
    this.replaceTable(table);
    this.setFileState("unmodified");
    this.emitter.emit("did-reload", { table, metadata: this.metadata });
    return table;
  }

  replaceTable(table) {
    if (this.table === table) return;
    this.tableSubscription?.dispose();
    if (this.table) this.table.release();
    this.table = table;
    this.table.retain();
    this.table.setSaveHandler(() => this.save());
    this.tableSubscription = this.table.onDidChangeModified((modified) => {
      if (this.fileState !== "conflicted" && this.fileState !== "removed") {
        this.setFileState(modified ? "modified" : "unmodified");
      }
      this.emitter.emit("did-change-modified", modified);
    });
    if (this.fileState !== "conflicted" && this.fileState !== "removed") {
      this.setFileState(table.isModified() ? "modified" : "unmodified");
    }
  }

  async save(filePath = this.filePath) {
    if (!this.table || !this.metadata)
      throw new Error("The delimited document is not loaded");
    const table = this.table;
    const revision = table.currentRevision;
    const options = { ...this.options };
    const metadata = { ...this.metadata };
    const rows = (
      options.header
        ? [table.getColumns(), ...table.getRows()]
        : table.getRows()
    ).map((row) => row.slice());
    const previousSave = this.savePromise;
    const saving = this.saveSnapshot(
      filePath,
      rows,
      options,
      metadata,
      table,
      revision,
      previousSave,
    );
    this.savePromise = saving;
    try {
      await saving;
    } finally {
      if (this.savePromise === saving) this.savePromise = null;
    }
  }

  async saveSnapshot(
    filePath,
    rows,
    options,
    metadata,
    table,
    revision,
    previousSave,
  ) {
    await previousSave?.catch(() => {});
    this.ignoreChangesUntil = Date.now() + 1500;
    await writeDelimitedFileAtomically(filePath, rows, options, metadata);
    if (this.destroyed || this.table !== table) return;
    if (filePath !== this.filePath) {
      this.setPath(filePath);
    }
    this.observedDiskFingerprint = this.diskFingerprint();
    this.resetWatcher();
    const policy = options.endOfFileNewline || "preserve";
    if (policy !== "preserve")
      this.metadata.hadFinalNewline = policy === "always";
    table.markSavedRevision(revision);
    this.setFileState(table.isModified() ? "modified" : "unmodified");
    this.emitter.emit("did-save", this);
  }

  isModified() {
    return Boolean(this.table?.isModified());
  }

  getFileState() {
    return this.fileState;
  }

  setFileState(fileState) {
    if (fileState === this.fileState) return;
    this.fileState = fileState;
    this.emitter.emit("did-change-file-state", fileState);
  }

  onDidReload(callback) {
    return this.emitter.on("did-reload", callback);
  }

  onDidFailLoad(callback) {
    return this.emitter.on("did-fail-load", callback);
  }

  onDidChangeModified(callback) {
    return this.emitter.on("did-change-modified", callback);
  }

  onDidChangeFileState(callback) {
    return this.emitter.on("did-change-file-state", callback);
  }

  onDidChangePath(callback) {
    return this.emitter.on("did-change-path", callback);
  }

  release() {
    this.references--;
    if (this.references <= 0) this.destroy();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.documentRegistration.dispose();
    this.loadController?.abort();
    clearTimeout(this.reloadTimer);
    if (documents.get(keyFor(this.filePath)) === this)
      documents.delete(keyFor(this.filePath));
    if (restoredDocuments.get(keyFor(this.filePath)) === this)
      restoredDocuments.delete(keyFor(this.filePath));
    this.tableSubscription?.dispose();
    this.subscriptions.dispose();
    this.table?.release();
    this.table = null;
    this.emitter.dispose();
  }
}

module.exports = DelimitedDocument;
