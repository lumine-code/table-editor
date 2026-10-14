"use strict";

const fs = require("fs");
const path = require("path");
const { CompositeDisposable, Emitter } = require("lumine");
const DelimitedDocument = require("./delimited-document");
const FilePreferences = require("./csv-config");
const TableEditor = require("./table-editor");
const { readDelimitedFile } = require("./delimited-io");
const { compactLayout, expandRowHeights } = require("./csv-layout");
const MODEL_KIND = Symbol.for("lumine.table-editor.model-kind");

let preferences = new FilePreferences();

function defaults() {
  const read = (name) =>
    lumine.config.get(`table-editor.delimitedText.${name}`);
  return {
    delimiter: read("delimiter"),
    recordDelimiter: read("recordDelimiter"),
    quote: read("quote"),
    escape: read("escape"),
    commentPrefix: read("commentPrefix"),
    quoteAll: read("quoteAll"),
    header: read("header"),
    endOfFileNewline: read("endOfFileNewline"),
    skipEmptyLines: read("skipEmptyLines"),
    trim: read("trim"),
    encoding: read("encoding"),
  };
}

class DelimitedTextEditor {
  get [MODEL_KIND]() {
    return "delimited-text";
  }

  static configure({ filePreferences }) {
    preferences = filePreferences;
  }

  static deserialize(state) {
    if (
      state?.version !== 2 ||
      !state.filePath ||
      (!fs.existsSync(state.filePath) && state.tableId == null)
    )
      return null;
    const editor = new DelimitedTextEditor(state);
    editor.openIfReady();
    return editor;
  }

  constructor(state = {}) {
    this.filePath = path.resolve(state.filePath);
    this.options = { ...defaults(), ...(state.options || {}) };
    this.opened = Boolean(state.opened);
    this.layout = state.layout ? compactLayout(state.layout) : null;
    this.editorState = state.editor || null;
    this.metadataState = state.metadata
      ? {
          ...state.metadata,
          bom: Buffer.from(state.metadata.bom || []),
        }
      : null;
    this.emitter = new Emitter();
    this.subscriptions = new CompositeDisposable();
    this.document = DelimitedDocument.acquire(this.filePath, this.options, {
      metadata: this.metadataState,
      tableId: state.tableId,
      fileState: state.fileState,
      diskFingerprint: state.diskFingerprint,
    });
    this.subscribeToDocument();
  }

  subscribeToDocument() {
    this.subscriptions.add(
      this.document.onDidReload(({ table }) => {
        this.reloadRequired = false;
        if (!this.editor) return;
        this.replaceEditor(this.createTableEditor(table, this.layout));
        this.emitter.emit("did-change", this);
      }),
      this.document.onDidFailLoad((error) => {
        this.reloadRequired = true;
        this.emitter.emit("did-fail-open", { err: error });
      }),
      this.document.onDidChangeModified((modified) =>
        this.emitter.emit("did-change-modified", modified),
      ),
      this.document.onDidChangeFileState((fileState) =>
        this.emitter.emit("did-change-file-state", fileState),
      ),
      this.document.onDidChangePath((nextPath) => {
        preferences.move(this.filePath, nextPath);
        this.filePath = nextPath;
        this.emitter.emit("did-change-path", nextPath);
        this.emitter.emit("did-change-title", this.getTitle());
      }),
    );
  }

  getTitle() {
    return path.basename(this.filePath);
  }

  getLongTitle() {
    const directory = lumine.project.relativize(path.dirname(this.filePath));
    return directory ? `${this.getTitle()} — ${directory}` : this.getTitle();
  }

  getPath() {
    return this.filePath;
  }

  getURI() {
    return this.filePath;
  }

  getDefaultLocation() {
    return "center";
  }

  getAllowedLocations() {
    return ["center"];
  }

  getFileState() {
    return this.document.getFileState();
  }

  isModified() {
    return this.document.isModified();
  }

  isDestroyed() {
    return this.destroyed;
  }

  getPaneItemDocument() {
    return this.document;
  }

  shouldPromptToSave({ lastView = true } = {}) {
    return (
      lastView &&
      this.getFileState() !== "unmodified" &&
      lumine.config.get("core.promptOnCloseDirtyBuffer")
    );
  }

  copy({ signal } = {}) {
    signal?.throwIfAborted();
    if (this.destroyed)
      throw new Error("Cannot copy a destroyed delimited-text editor");
    if (this.openingPromise) {
      return waitForCopy(this.openingPromise, signal).then(() =>
        this.copy({ signal }),
      );
    }
    const copy = new DelimitedTextEditor({
      version: 2,
      filePath: this.filePath,
      tableId: this.document.table?.id,
      fileState: this.document.getFileState(),
      diskFingerprint: this.document.observedDiskFingerprint,
      options: this.options,
      opened: Boolean(this.editor || this.opened),
      layout: this.getCurrentLayout(),
    });
    try {
      if (this.editor) {
        copy.replaceEditor(this.editor.copy({ signal }));
      }
      return copy;
    } catch (error) {
      copy.destroy();
      throw error;
    }
  }

  destroy() {
    if (this.destroyed) return;
    if (this.editor) {
      this.saveLayout();
      this.editor.destroy();
      this.editor = null;
    }
    this.subscriptions.dispose();
    this.document.release();
    this.destroyed = true;
    this.emitter.emit("did-destroy", this);
    this.emitter.dispose();
  }

  async save() {
    await this.document.save(this.filePath);
  }

  async saveAs(nextPath) {
    const previousPath = this.filePath;
    await this.document.save(nextPath);
    preferences.move(previousPath, nextPath);
    this.filePath = path.resolve(nextPath);
    this.saveLayout();
    this.emitter.emit("did-change-title", this.getTitle());
  }

  saveConfig() {
    preferences.set(this.filePath, "options", this.options);
  }

  saveLayout() {
    if (!this.editor) return;
    this.layout = this.getCurrentLayout();
    preferences.set(this.filePath, "layout", this.layout);
  }

  getCurrentLayout() {
    if (!this.editor) return this.layout;
    return compactLayout({
      columns: this.editor.getScreenColumns().map((column) => ({
        ...(column.width !== this.editor.getScreenColumnWidth()
          ? { width: column.width }
          : {}),
        ...(column.align !== "left" ? { align: column.align } : {}),
      })),
      rowHeights: this.editor.displayTable.rowHeights,
    });
  }

  terminatePendingState() {
    if (!this.hasTerminatedPendingState)
      this.emitter.emit("did-terminate-pending-state");
    this.hasTerminatedPendingState = true;
  }

  openIfReady() {
    if (!this.opened || this.editor || this.openingPromise) return;
    this.opened = false;
    return this.openTableEditor(this.options);
  }

  openTableEditor(options = {}) {
    if (this.openingPromise) return this.openingPromise;
    const opening = this.loadTableEditor(options);
    const tracked = opening.finally(() => {
      if (this.openingPromise === tracked) this.openingPromise = null;
    });
    this.openingPromise = tracked;
    return tracked;
  }

  async loadTableEditor(options = {}) {
    this.options = { ...this.options, ...options };
    this.document.options = { ...this.options };
    this.emitter.emit("will-open", { options: { ...this.options } });
    try {
      let editor;
      if (this.editorState) {
        editor = lumine.deserializers.deserialize(this.editorState);
        this.editorState = null;
        this.document.metadata ||= this.metadataState;
        this.document.replaceTable(editor.table);
        this.applyLayout(editor, this.layout);
      } else if (this.document.table && !this.reloadRequired) {
        editor = this.createTableEditor(this.document.table, this.layout);
      } else {
        const stats = await fs.promises.stat(this.filePath);
        const threshold =
          lumine.config.get("table-editor.delimitedText.largeFileWarningMB") ||
          0;
        if (threshold && stats.size > threshold * 1024 * 1024) {
          const answer = await (
            lumine.workspace.paneForItem(this)?.getContainer().getWindow() ??
            lumine.workspace.getMainWindow()
          ).confirm({
            message: `'${this.getTitle()}' is ${(stats.size / 1024 / 1024).toFixed(1)} MB.`,
            detailedMessage: "The complete parsed table is kept in memory.",
            buttons: ["Load Table", "Cancel"],
          });
          if (answer !== 0) return null;
        }
        let progress = { bytes: 0, total: stats.size, rows: 0 };
        const input = {
          getProgress: () => ({
            length: progress.bytes,
            total: progress.total,
            ratio: progress.total ? progress.bytes / progress.total : 0,
          }),
        };
        const table = await this.document.load(this.options, {
          onProgress: (next) => {
            progress = next;
            this.emitter.emit("did-read-data", { input, lines: next.rows });
          },
        });
        if (!table || this.destroyed) return null;
        this.emitter.emit("will-fill-table", { table });
        editor = this.createTableEditor(table, this.layout);
        this.emitter.emit("fill-table", { table });
        this.emitter.emit("did-fill-table", { table });
      }
      if (this.destroyed) {
        editor?.destroy();
        return null;
      }
      this.replaceEditor(editor);
      this.saveConfig();
      this.emitter.emit("did-open", { editor, options: { ...this.options } });
      this.emitter.emit("did-change-modified", editor.isModified());
      this.terminatePendingState();
      return editor;
    } catch (err) {
      this.emitter.emit("did-fail-open", { err, options: { ...this.options } });
      return null;
    }
  }

  createTableEditor(table, layout) {
    const editor = new TableEditor({ table });
    this.applyLayout(editor, layout);
    return editor;
  }

  applyLayout(editor, layout) {
    if (layout) {
      const compact = compactLayout(layout);
      for (const [index, column] of Object.entries(compact.columns || {})) {
        if (Number(index) < editor.table.getColumnCount())
          editor.setScreenColumnOptions(Number(index), column);
      }
      if (compact.rowHeights) {
        editor.displayTable.setRowHeights(
          expandRowHeights(compact.rowHeights, editor.getRowCount()),
        );
      }
    }
  }

  replaceEditor(editor) {
    if (this.editor === editor) return;
    this.editorSubscriptions?.dispose();
    if (this.editor) this.editor.destroy();
    this.editor = editor;
    this.editorSubscriptions = new CompositeDisposable(
      editor.onDidChangeModified((modified) =>
        this.emitter.emit("did-change-modified", modified),
      ),
    );
    this.subscriptions.add(this.editorSubscriptions);
  }

  async previewCSV(options) {
    const limit =
      lumine.config.get("table-editor.delimitedText.previewRows") || 100;
    const result = await readDelimitedFile(
      this.filePath,
      { ...this.options, ...options },
      { limit },
    );
    return result?.rows || [];
  }

  onWillOpen(callback) {
    return this.emitter.on("will-open", callback);
  }
  onDidReadData(callback) {
    return this.emitter.on("did-read-data", callback);
  }
  onDidOpen(callback) {
    return this.emitter.on("did-open", callback);
  }
  onDidFailOpen(callback) {
    return this.emitter.on("did-fail-open", callback);
  }
  onWillFillTable(callback) {
    return this.emitter.on("will-fill-table", callback);
  }
  onFillTable(callback) {
    return this.emitter.on("fill-table", callback);
  }
  onDidFillTable(callback) {
    return this.emitter.on("did-fill-table", callback);
  }
  onDidDestroy(callback) {
    return this.emitter.on("did-destroy", callback);
  }
  onDidChange(callback) {
    return this.emitter.on("did-change", callback);
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
  onDidChangeTitle(callback) {
    return this.emitter.on("did-change-title", callback);
  }
  onDidTerminatePendingState(callback) {
    return this.emitter.on("did-terminate-pending-state", callback);
  }

  serialize() {
    const layout = this.editor ? this.getCurrentLayout() : null;
    const metadata = this.document.metadata
      ? {
          encoding: this.document.metadata.encoding,
          bom: Array.from(this.document.metadata.bom || []),
          delimiter: this.document.metadata.delimiter,
          recordDelimiter: this.document.metadata.recordDelimiter,
          hadFinalNewline: this.document.metadata.hadFinalNewline,
        }
      : null;
    return {
      deserializer: "table-editor/DelimitedTextEditor",
      version: 2,
      filePath: this.filePath,
      tableId: this.document.table?.id,
      fileState: this.document.getFileState(),
      diskFingerprint: this.document.observedDiskFingerprint,
      options: this.options,
      opened: Boolean(this.editor || this.opened),
      metadata,
      ...(this.editor ? { editor: this.editor.serialize() } : {}),
      ...(layout && Object.keys(layout).length ? { layout } : {}),
    };
  }
}

function waitForCopy(promise, signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => {
        signal.removeEventListener("abort", aborted);
      });
  });
}

module.exports = DelimitedTextEditor;
