"use strict";

const fs = require("fs");
const path = require("path");
const {
  CompositeDisposable,
  Disposable,
  Emitter,
  FileState,
  watchFile,
} = require("lumine");
const Table = require("./table");
const {
  readDelimitedFile,
  writeDelimitedFileAtomically,
} = require("./delimited-io");
const columnName = require("./column-name");

const documents = new Map();

class DelimitedDocument {
  static acquire(filePath, options = {}, state = {}) {
    const key = path.resolve(filePath);
    let document = documents.get(key);
    if (!document) {
      document = new DelimitedDocument(key, options, state);
      documents.set(key, document);
    }
    document.references++;
    return document;
  }

  static get(filePath) {
    return documents.get(path.resolve(filePath));
  }

  constructor(filePath, options, state) {
    this.filePath = filePath;
    this.options = { ...options };
    this.metadata = state.metadata || null;
    this.references = 0;
    this.fileState = state.table?.modified
      ? FileState.MODIFIED
      : FileState.UNMODIFIED;
    this.emitter = new Emitter();
    this.subscriptions = new CompositeDisposable();
    this.loadController = null;
    this.reloadTimer = null;
    this.ignoreChangesUntil = 0;
    if (state.table) this.replaceTable(Table.deserialize(state.table));
    this.installWatcher();
  }

  installWatcher() {
    this.watcher = watchFile(this.filePath);
    this.subscriptions.add(
      new Disposable(() => this.watcher.dispose()),
      this.watcher.onDidChange(() => this.handleDiskChange()),
      this.watcher.onDidDelete(() => {
        if (
          Date.now() < this.ignoreChangesUntil &&
          fs.existsSync(this.filePath)
        )
          return;
        this.setFileState(FileState.REMOVED);
      }),
      this.watcher.onDidRename(() => {
        const previousPath = this.filePath;
        const nextPath = this.watcher.getPath();
        if (
          Date.now() < this.ignoreChangesUntil &&
          path.resolve(nextPath) !== previousPath
        )
          return;
        this.filePath = nextPath;
        documents.delete(previousPath);
        documents.set(path.resolve(this.filePath), this);
        this.emitter.emit("did-change-path", this.filePath);
      }),
    );
  }

  resetWatcher() {
    this.subscriptions.dispose();
    this.subscriptions = new CompositeDisposable();
    this.installWatcher();
  }

  async handleDiskChange() {
    if (Date.now() < this.ignoreChangesUntil) return;
    if (this.isModified()) {
      this.setFileState(FileState.CONFLICTED);
      return;
    }
    clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      this.load(this.options).catch((error) => {
        this.setFileState(FileState.CONFLICTED);
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
    const rows = result.rows.map((row) => row.slice());
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
    this.setFileState(FileState.UNMODIFIED);
    this.emitter.emit("did-reload", { table, metadata: this.metadata });
    return table;
  }

  replaceTable(table) {
    this.tableSubscription?.dispose();
    if (this.table) this.table.release();
    this.table = table;
    this.table.retain();
    this.table.setSaveHandler(() => this.save());
    this.tableSubscription = this.table.onDidChangeModified((modified) => {
      if (
        this.fileState !== FileState.CONFLICTED &&
        this.fileState !== FileState.REMOVED
      ) {
        this.setFileState(modified ? FileState.MODIFIED : FileState.UNMODIFIED);
      }
      this.emitter.emit("did-change-modified", modified);
    });
    if (
      this.fileState !== FileState.CONFLICTED &&
      this.fileState !== FileState.REMOVED
    ) {
      this.setFileState(
        table.isModified() ? FileState.MODIFIED : FileState.UNMODIFIED,
      );
    }
  }

  async save(filePath = this.filePath) {
    if (!this.table || !this.metadata)
      throw new Error("The delimited document is not loaded");
    const rows = this.options.header
      ? [this.table.getColumns(), ...this.table.getRows()]
      : this.table.getRows();
    this.ignoreChangesUntil = Date.now() + 1500;
    await writeDelimitedFileAtomically(
      filePath,
      rows,
      this.options,
      this.metadata,
    );
    if (filePath !== this.filePath) {
      const previousPath = this.filePath;
      documents.delete(previousPath);
      this.filePath = path.resolve(filePath);
      documents.set(this.filePath, this);
      this.emitter.emit("did-change-path", this.filePath);
    }
    this.resetWatcher();
    const policy = this.options.endOfFileNewline || "preserve";
    if (policy !== "preserve")
      this.metadata.hadFinalNewline = policy === "always";
    this.table.markSavedRevision();
    this.setFileState(FileState.UNMODIFIED);
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
    this.loadController?.abort();
    clearTimeout(this.reloadTimer);
    documents.delete(path.resolve(this.filePath));
    this.tableSubscription?.dispose();
    this.subscriptions.dispose();
    this.table?.release();
    this.table = null;
    this.emitter.dispose();
  }
}

module.exports = DelimitedDocument;
