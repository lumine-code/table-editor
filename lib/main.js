"use strict";

const fs = require("fs");
const path = require("path");
const { CompositeDisposable } = require("lumine");
const FilePreferences = require("./csv-config");

let Table;
let DisplayTable;
let TableEditor;
let Range;
let DelimitedTextEditor;
let TableElement;
let DelimitedTextElement;

const forceTable = new Set();

function getDelimitedTextEditor(filePreferences) {
  if (!DelimitedTextEditor) {
    DelimitedTextEditor = require("./csv-editor");
  }
  if (filePreferences) {
    DelimitedTextEditor.configure({ filePreferences });
  }
  return DelimitedTextEditor;
}

function getFilePreferences(main) {
  return main.filePreferences;
}

function createLazyService(load) {
  let value;
  const get = () => (value ||= load());
  return new Proxy(
    {},
    {
      get(_target, property) {
        const member = get()[property];
        return typeof member === "function" ? member.bind(get()) : member;
      },
      has(_target, property) {
        return property in get();
      },
      ownKeys() {
        return Reflect.ownKeys(get());
      },
      getOwnPropertyDescriptor(_target, property) {
        const descriptor = Object.getOwnPropertyDescriptor(get(), property);
        return descriptor ? { ...descriptor, configurable: true } : undefined;
      },
    },
  );
}

function supportedExtensions() {
  return new Set(
    (lumine.config.get("table-editor.supportedExtensions") || [])
      .map((extension) => String(extension).replace(/^\./, "").toLowerCase())
      .filter(Boolean),
  );
}

function supportedPath(filePath) {
  return supportedExtensions().has(
    path.extname(filePath).slice(1).toLowerCase(),
  );
}

function readableFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

module.exports = {
  provideBackgroundTips() {
    return {
      packageName: "table-editor",
      tips: [
        "Table Editor can copy rectangular selections directly into spreadsheet applications.",
      ],
    };
  },

  activate(state = {}) {
    this.subscriptions = new CompositeDisposable();
    this.filePreferences = new FilePreferences(state);
    this.tableEditorService = null;
    TableElement?.registerCommands?.();

    this.subscriptions.add(
      lumine.workspace.addOpener((uri) => {
        if (
          typeof uri !== "string" ||
          uri.includes("://") ||
          !readableFile(uri)
        )
          return;
        const forced = forceTable.delete(path.resolve(uri));
        if (!forced && !supportedPath(uri)) return;
        const remembered = getFilePreferences(this).get(uri) || {};
        if (!forced && remembered.choice === "TextEditor") return;
        const Editor = getDelimitedTextEditor(getFilePreferences(this));
        return new Editor({
          version: 1,
          filePath: uri,
          options: remembered.options,
          layout: remembered.layout,
          choice:
            forced ||
            remembered.choice === "TableEditor" ||
            !lumine.config.get("table-editor.showPreview")
              ? "TableEditor"
              : null,
        });
      }),
      lumine.commands.add("lumine-workspace", {
        "table-editor:open-as-table": {
          description:
            "Replace the active saved text file with its table view.",
          didDispatch: (event) => this.openAsTable(event),
        },
        "table-editor:open-as-text": {
          description: "Replace the active table with an ordinary text editor.",
          didDispatch: (event) => this.openAsText(event),
        },
        "table-editor:clear-file-choice": {
          description:
            "Forget the opening mode remembered for the active file.",
          didDispatch: (event) => this.clearFileProperty(event, "choice"),
        },
        "table-editor:clear-file-layout": {
          description:
            "Forget the table layout remembered for the active file.",
          didDispatch: (event) => this.clearFileProperty(event, "layout"),
        },
        "table-editor:clear-file-settings": {
          description:
            "Forget every Table Editor preference for the active file.",
          didDispatch: (event) => this.clearFileSettings(event),
        },
      }),
    );
  },

  deactivate() {
    this.subscriptions?.dispose();
    TableElement?.disposeCommands?.();
    this.subscriptions = null;
    this.tableEditorService = null;
  },

  serialize() {
    return this.filePreferences?.serialize() || { version: 1, files: {} };
  },

  itemForEvent(event) {
    const element = event?.target?.closest?.("table-editor-delimited-text");
    return element?.getModel?.() || lumine.workspace.getActivePaneItem();
  },

  pathForEvent(event) {
    const item = this.itemForEvent(event);
    return item?.getPath?.() || null;
  },

  async openAsTable(event) {
    const element = event?.target?.closest?.("lumine-text-editor:not([mini])");
    const editor =
      element?.getModel?.() || lumine.workspace.getActiveTextEditor();
    if (!editor) return;
    const filePath = editor.getPath?.();
    if (!filePath) {
      lumine.notifications.addWarning(
        "Save the file before opening it as a table.",
      );
      return;
    }
    if (editor.isModified?.()) {
      lumine.notifications.addWarning(
        "Save or discard text changes before opening the table.",
      );
      return;
    }
    const pane = lumine.workspace.paneForItem(editor);
    forceTable.add(path.resolve(filePath));
    const removed = await pane.destroyItem(editor);
    if (!removed) {
      forceTable.delete(path.resolve(filePath));
      return;
    }
    await lumine.workspace.open(filePath);
  },

  async openAsText(event) {
    const item = this.itemForEvent(event);
    if (!(item instanceof getDelimitedTextEditor(this.filePreferences))) return;
    await item.openTextEditor(item.options);
  },

  clearFileProperty(event, property) {
    const filePath = this.pathForEvent(event);
    if (!filePath) return;
    this.filePreferences.clearProperty(property, filePath);
    lumine.notifications.addSuccess(
      `Forgot the saved ${property} for ${path.basename(filePath)}.`,
    );
  },

  clearFileSettings(event) {
    const filePath = this.pathForEvent(event);
    if (!filePath) return;
    this.filePreferences.clear(filePath);
    lumine.notifications.addSuccess(
      `Forgot Table Editor settings for ${path.basename(filePath)}.`,
    );
  },

  provideTableEditor() {
    if (!this.tableEditorService) {
      this.tableEditorService = createLazyService(() => {
        Table ||= require("./table");
        DisplayTable ||= require("./display-table");
        TableEditor ||= require("./table-editor");
        Range ||= require("./range");
        const DelimitedTextEditor = getDelimitedTextEditor(
          getFilePreferences(this),
        );
        return { Table, DisplayTable, TableEditor, Range, DelimitedTextEditor };
      });
    }
    return this.tableEditorService;
  },

  deserializeTable(state) {
    Table ||= require("./table");
    return state?.version === 1 ? Table.deserialize(state) : null;
  },

  deserializeDisplayTable(state) {
    DisplayTable ||= require("./display-table");
    return state?.version === 1 ? DisplayTable.deserialize(state) : null;
  },

  deserializeTableEditor(state) {
    TableEditor ||= require("./table-editor");
    return state?.version === 1 ? TableEditor.deserialize(state) : null;
  },

  deserializeDelimitedTextEditor(state) {
    return getDelimitedTextEditor(getFilePreferences(this)).deserialize(state);
  },

  tableEditorViewProvider(model) {
    TableEditor ||= require("./table-editor");
    getDelimitedTextEditor(getFilePreferences(this));
    if (model instanceof TableEditor) {
      TableElement ||= require("./table-element");
      const element = new TableElement().initialize();
      element.setModel(model);
      return element;
    }
    if (model instanceof DelimitedTextEditor) {
      DelimitedTextElement ||= require("./csv-editor-element");
      const element = new DelimitedTextElement().initialize();
      element.setModel(model);
      return element;
    }
  },
};
