"use strict";

const fs = require("fs");
const path = require("path");
const { CompositeDisposable } = require("lumine");
const FilePreferences = require("./csv-config");
const MODEL_KIND = Symbol.for("lumine.table-editor.model-kind");

let Table;
let DisplayTable;
let TableEditor;
let Range;
let DelimitedTextEditor;
let TableElement;
let DelimitedTextElement;
let tableState;

function getTable() {
  Table ||= require("./table");
  if (tableState !== undefined) {
    Table.restoreState(tableState);
    tableState = undefined;
  }
  return Table;
}

function getDelimitedTextEditor(filePreferences) {
  getTable();
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

  initialize(state = {}) {
    this.filePreferences = new FilePreferences(state);
    tableState = state.tables || {};
    if (Table) getTable();
  },

  restoreState(state = {}) {
    this.initialize(state);
    if (DelimitedTextEditor)
      DelimitedTextEditor.configure({ filePreferences: this.filePreferences });
  },

  async prepareToSerialize() {
    await Promise.all(
      lumine.workspace
        .getPaneItems()
        .map((item) =>
          DelimitedTextEditor && item instanceof DelimitedTextEditor
            ? item.openingPromise
            : null,
        ),
    );
  },

  activate(state = {}) {
    this.subscriptions = new CompositeDisposable();
    if (!this.filePreferences) this.initialize(state);
    this.tableEditorService = null;
    TableElement?.registerCommands?.();

    this.subscriptions.add(
      lumine.workspace.addPathOpener({
        id: "table-editor",
        label: "Table Editor",
        canOpen: (uri) =>
          typeof uri === "string" &&
          !uri.includes("://") &&
          supportedPath(uri) &&
          readableFile(uri),
        open: (uri) => {
          const saved = getFilePreferences(this).get(uri) || {};
          const Editor = getDelimitedTextEditor(getFilePreferences(this));
          return new Editor({
            filePath: uri,
            options: saved.options,
            layout: saved.layout,
            opened: !lumine.config.get("table-editor.showPreview"),
          });
        },
        handlesItem: (item) =>
          DelimitedTextEditor != null && item instanceof DelimitedTextEditor,
      }),
      lumine.commands.add("lumine-workspace", {
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
    const tables = new Map();
    for (const item of lumine.workspace.getPaneItems()) {
      const table = item.table ?? item.document?.table;
      if (table && table instanceof getTable() && !table.destroyed)
        tables.set(table.id, table);
    }
    return {
      ...(this.filePreferences?.serialize() || { version: 1, files: {} }),
      tables: Object.fromEntries(
        [...tables].map(([id, table]) => [
          id,
          structuredClone(table.serialize()),
        ]),
      ),
    };
  },

  itemForEvent(event) {
    const element = event?.target?.closest?.("table-editor-delimited-text");
    return element?.getModel?.() || lumine.workspace.getActivePaneItem();
  },

  pathForEvent(event) {
    const item = this.itemForEvent(event);
    return item?.getPath?.() || null;
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
        getTable();
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
    return state?.version === 1 ? getTable().deserialize(state) : null;
  },

  deserializeDisplayTable(state) {
    if (state?.version !== 2) return null;
    getTable();
    DisplayTable ||= require("./display-table");
    return DisplayTable.deserialize(state);
  },

  deserializeTableEditor(state) {
    if (state?.version !== 2) return null;
    getTable();
    TableEditor ||= require("./table-editor");
    return TableEditor.deserialize(state);
  },

  deserializeDelimitedTextEditor(state) {
    if (state?.version !== 2) return null;
    return getDelimitedTextEditor(getFilePreferences(this)).deserialize(state);
  },

  tableEditorViewProvider(model) {
    const kind = model?.[MODEL_KIND];
    if (kind === "table-editor") {
      getTable();
      TableEditor ||= require("./table-editor");
      if (!(model instanceof TableEditor)) return;
      TableElement ||= require("./table-element");
      const element = new TableElement().initialize();
      element.setModel(model);
      return element;
    }
    if (kind === "delimited-text") {
      const Editor = getDelimitedTextEditor(getFilePreferences(this));
      if (!(model instanceof Editor)) return;
      DelimitedTextElement ||= require("./csv-editor-element");
      const element = new DelimitedTextElement().initialize();
      element.setModel(model);
      return element;
    }
  },
};
