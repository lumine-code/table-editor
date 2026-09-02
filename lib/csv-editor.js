"use strict";

const fs = require("fs");
const path = require("path");
const { CompositeDisposable, Emitter, FileState } = require("lumine");
const DelimitedDocument = require("./delimited-document");
const FilePreferences = require("./csv-config");
const TableEditor = require("./table-editor");
const { readDelimitedFile } = require("./delimited-io");

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
    remember: false,
  };
}

class DelimitedTextEditor {
  static configure({ filePreferences }) {
    preferences = filePreferences;
  }

  static deserialize(state) {
    if (
      state?.version !== 1 ||
      !state.filePath ||
      !fs.existsSync(state.filePath)
    )
      return null;
    const editor = new DelimitedTextEditor(state);
    editor.applyChoice();
    return editor;
  }

  constructor(state = {}) {
    this.filePath = path.resolve(state.filePath);
    this.options = { ...defaults(), ...(state.options || {}) };
    this.choice = state.choice || null;
    this.layout = state.layout || null;
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

  shouldPromptToSave() {
    return (
      this.getFileState() !== FileState.UNMODIFIED &&
      lumine.config.get("core.promptOnCloseDirtyBuffer")
    );
  }

  copy() {
    const copy = new DelimitedTextEditor({
      version: 1,
      filePath: this.filePath,
      options: this.options,
      choice: "TableEditor",
      layout: this.getCurrentLayout(),
    });
    if (this.document.table)
      copy.editor = copy.createTableEditor(this.document.table, copy.layout);
    copy.choiceApplied = true;
    return copy;
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

  saveConfig(choice) {
    this.choice = choice;
    preferences.set(this.filePath, "options", this.options);
    if (this.options.remember) preferences.set(this.filePath, "choice", choice);
  }

  saveLayout() {
    if (!this.editor) return;
    this.layout = this.getCurrentLayout();
    preferences.set(this.filePath, "layout", this.layout);
  }

  getCurrentLayout() {
    if (!this.editor) return this.layout;
    return {
      columns: this.editor.getScreenColumns().map((column) => ({
        ...(column.width !== this.editor.getScreenColumnWidth()
          ? { width: column.width }
          : {}),
        ...(column.align !== "left" ? { align: column.align } : {}),
      })),
      rowHeights: this.editor.displayTable.rowHeights.slice(),
    };
  }

  terminatePendingState() {
    if (!this.hasTerminatedPendingState)
      this.emitter.emit("did-terminate-pending-state");
    this.hasTerminatedPendingState = true;
  }

  applyChoice() {
    if (this.choiceApplied || !this.choice) return;
    this.choiceApplied = true;
    if (this.choice === "TextEditor") this.openTextEditor(this.options);
    else this.openTableEditor(this.options);
  }

  async openTextEditor(options = {}) {
    this.options = { ...this.options, ...options };
    if (this.isModified()) {
      const choice = await lumine.window.confirm({
        message: `'${this.getTitle()}' has unsaved table changes.`,
        detailedMessage: "Save before opening the file as text?",
        buttons: ["Save and Open", "Discard and Open", "Cancel"],
      });
      if (choice === 2) return null;
      if (choice === 0) await this.save();
    }
    this.saveConfig("TextEditor");
    const pane = lumine.workspace.paneForItem(this);
    const textEditor = await lumine.workspace.openTextFile(this.filePath);
    this.emitter.emit("did-open", {
      editor: textEditor,
      options: { ...this.options },
    });
    if (pane) {
      pane.removeItem(this, false);
      this.destroy();
      pane.activateItem(textEditor);
    }
    return textEditor;
  }

  async openTableEditor(options = {}) {
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
      } else if (this.document.table && !this.reloadRequired) {
        editor = this.createTableEditor(this.document.table, this.layout);
      } else {
        const stats = await fs.promises.stat(this.filePath);
        const threshold =
          lumine.config.get("table-editor.delimitedText.largeFileWarningMB") ||
          0;
        if (threshold && stats.size > threshold * 1024 * 1024) {
          const answer = await lumine.window.confirm({
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
        if (!table) return null;
        this.emitter.emit("will-fill-table", { table });
        editor = this.createTableEditor(table, this.layout);
        this.emitter.emit("fill-table", { table });
        this.emitter.emit("did-fill-table", { table });
      }
      this.replaceEditor(editor);
      this.saveConfig("TableEditor");
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
    if (layout) {
      for (let index = 0; index < layout.columns?.length; index++) {
        if (layout.columns[index])
          editor.setScreenColumnOptions(index, layout.columns[index]);
      }
      editor.displayTable.setRowHeights(layout.rowHeights || []);
    }
    return editor;
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
      version: 1,
      filePath: this.filePath,
      options: this.options,
      choice: this.editor ? "TableEditor" : this.choice,
      metadata,
      ...(this.isModified() && this.editor
        ? { editor: this.editor.serialize() }
        : this.editor
          ? { layout: this.getCurrentLayout() }
          : {}),
    };
  }
}

module.exports = DelimitedTextEditor;
