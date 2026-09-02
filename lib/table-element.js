"use strict";

const { Point, CompositeDisposable } = require("lumine");
const columnName = require("./column-name");
const disposableEvent = require("./disposable-event");
const registerElement = require("./register-element");
const TableEditor = require("./table-editor");
const TableGridAdapter = require("./table-grid-adapter");
const GoToCellElement = require("./go-to-cell-element");
const tableCommands = require("./table-element-commands");

const px = (value) => `${value}px`;

const stopPropagationAndDefault = (f) =>
  function (e) {
    e.stopPropagation();
    e.preventDefault();
    return f && f.call(this, e);
  };

const stopPropagation = (f) =>
  function (e) {
    e.stopPropagation();
    return f && f.call(this, e);
  };

class TableElement extends HTMLElement {
  static get observedAttributes() {
    return ["read-only"];
  }

  //     ######  ##     ## ########
  //    ##    ## ###   ### ##     ##
  //    ##       #### #### ##     ##
  //    ##       ## ### ## ##     ##
  //    ##       ##     ## ##     ##
  //    ##    ## ##     ## ##     ##
  //     ######  ##     ## ########

  static registerCommands() {
    tableCommands.registerCommands();
  }

  static disposeCommands() {
    tableCommands.disposeCommands();
  }

  constructor() {
    super();
  }

  initialize() {
    if (this.elementInitialized) return this;
    this.elementInitialized = true;
    this.setAttribute("data-context-menu-boundary", "");
    this.readOnly = this.hasAttribute("read-only");
    this.subscriptions = new CompositeDisposable();
    this.subscriptions.add(
      disposableEvent(this, "mousedown", () => this.focus()),
      {
        dispose: () => {
          this.textEditorSubscriptions?.dispose();
          this.textEditorSubscriptions = null;
          this.editor?.destroy();
          this.editor = null;
          this.editorElement = null;
          this.fitController?.abort();
          this.gridAdapter?.destroy();
          this.gridAdapter = null;
        },
      },
    );
    return this;
  }

  attributeChangedCallback(attrName, oldVal, newVal) {
    switch (attrName) {
      case "read-only":
        this.readOnly = newVal != null;
        this.gridAdapter?.setReadOnly(this.readOnly);
    }
  }

  getUndefinedDisplay() {
    return (
      this.undefinedDisplay ||
      lumine.config.get("table-editor.tableEditor.undefinedDisplay")
    );
  }

  //        ###    ######## ########    ###     ######  ##     ##
  //       ## ##      ##       ##      ## ##   ##    ## ##     ##
  //      ##   ##     ##       ##     ##   ##  ##       ##     ##
  //     ##     ##    ##       ##    ##     ## ##       #########
  //     #########    ##       ##    ######### ##       ##     ##
  //     ##     ##    ##       ##    ##     ## ##    ## ##     ##
  //     ##     ##    ##       ##    ##     ##  ######  ##     ##

  connectedCallback() {
    this.initialize();
    if (this.getModel() == null) {
      this.buildModel();
    }
  }

  destroy() {
    this.tableEditor?.destroy();
  }

  isDestroyed() {
    return this.destroyed;
  }

  //    ##     ##  #######  ########  ######## ##
  //    ###   ### ##     ## ##     ## ##       ##
  //    #### #### ##     ## ##     ## ##       ##
  //    ## ### ## ##     ## ##     ## ######   ##
  //    ##     ## ##     ## ##     ## ##       ##
  //    ##     ## ##     ## ##     ## ##       ##
  //    ##     ##  #######  ########  ######## ########

  getModel() {
    return this.tableEditor;
  }

  buildModel() {
    const model = new TableEditor();
    model.addColumn("untitled");
    model.addRow();
    this.setModel(model);
  }

  setModel(table) {
    this.initialize();
    if (this.isDestroyed()) {
      throw new Error("Can't set the model of a destroyed TableElement");
    }
    if (!table) {
      return;
    }

    if (this.tableEditor) {
      this.unsetModel();
    }

    this.tableEditor = table;
    this.modelSubscriptions = new CompositeDisposable();
    const subscriptions = this.modelSubscriptions;
    subscriptions.add(
      this.tableEditor.onDidDestroy(() => {
        this.unsetModel();
        this.subscriptions.dispose();
        this.destroyed = true;
        this.subscriptions = null;
        this.remove();
      }),
    );
    this.ensureGridAdapter();
    this.gridAdapter.syncData();
  }

  unsetModel() {
    this.modelSubscriptions?.dispose();
    this.modelSubscriptions = null;
    this.gridAdapter?.destroy();
    this.gridAdapter = null;
    this.tableEditor = null;
  }

  get grid() {
    return this.gridAdapter?.grid;
  }

  ensureGridAdapter() {
    if (this.gridAdapter || !this.tableEditor) return;
    this.gridAdapter = new TableGridAdapter({
      host: this,
      model: this.tableEditor,
      readOnly: this.readOnly,
      callbacks: {
        isEditing: () => this.isEditing(),
        onPointerDown: (hit, event) => {
          if (this.isEditing()) this.stopEdit();
          return !(hit.zone === "column" && event.detail > 1);
        },
        onEditCell: () => this.startCellEdit(),
        onEditColumn: (column) => this.startColumnEdit(column),
        onContextMenu: (hit) => this.setContextMenuTarget(hit),
        onScroll: () => this.positionTextEditor(),
        onGeometryChange: () => this.positionTextEditor(),
        onType: (text) => {
          if (this.tableEditor.getScreenColumnCount() === 0)
            this.insertColumnAfter();
          if (this.tableEditor.getScreenRowCount() === 0) this.insertRowAfter();
          this.startCellEdit(text);
        },
        onError: (error) =>
          lumine.notifications.addError("Table Editor grid failed", {
            description: error.message,
            dismissable: true,
          }),
      },
    });
  }

  sortColumn(direction) {
    const column =
      this.contextMenuColumn != null
        ? this.contextMenuColumn
        : this.tableEditor.getCursorPosition().column;
    this.gridAdapter.requestSort(column, direction, "context-menu");
  }

  setContextMenuTarget(hit) {
    this.contextMenuRow = hit?.row ?? null;
    this.contextMenuColumn = hit?.column ?? null;
    this.dataset.contextZone =
      hit?.zone === "body"
        ? "cell"
        : hit?.zone === "column"
          ? "column"
          : hit?.zone === "row"
            ? "row"
            : "corner";
  }

  insertRowBefore() {
    if (!this.readOnly) {
      this.tableEditor.insertRowBefore();
    }
  }

  insertRowAfter() {
    if (!this.readOnly) {
      this.tableEditor.insertRowAfter();
    }
  }

  deleteSelectedRows() {
    if (!this.readOnly) {
      this.tableEditor.deleteSelectedRows();
    }
  }

  makeRowVisible(row) {
    this.gridAdapter?.scrollRowIntoView(row);
  }

  async fitRowToContent(row) {
    const values = this.tableEditor.getScreenRow(row) || [];
    const controller = this.beginFitScan();
    let lines = 1;
    for (let column = 0; column < values.length; column++) {
      if (controller.signal.aborted) return;
      lines = Math.max(
        lines,
        String(values[column] ?? "").split(/\r\n|\n|\r/).length,
      );
      if (column > 0 && column % 256 === 0)
        await this.yieldFitScan(controller.signal);
    }
    if (!controller.signal.aborted) {
      const lineHeight = this.gridAdapter.getFontMetrics().lineHeight;
      this.tableEditor.setScreenRowHeightAt(
        row,
        Math.max(
          this.tableEditor.getMinimumRowHeight(),
          lines * lineHeight + 6,
        ),
      );
    }
  }

  insertColumnBefore() {
    if (!this.readOnly) {
      this.tableEditor.insertColumnBefore();
    }
  }

  insertColumnAfter() {
    if (!this.readOnly) {
      this.tableEditor.insertColumnAfter();
    }
  }

  deleteSelectedColumns() {
    if (!this.readOnly) {
      this.tableEditor.deleteSelectedColumns();
    }
  }

  makeColumnVisible(column) {
    this.gridAdapter?.scrollColumnIntoView(column);
  }

  async fitColumnToContent(column) {
    const controller = this.beginFitScan();
    const definition = this.tableEditor.getScreenColumn(column);
    let width = this.gridAdapter.measureText(
      definition.name ?? columnName(column),
    ).width;
    const rows = this.tableEditor.table.rows;
    for (let row = 0; row < rows.length; row++) {
      if (controller.signal.aborted) return;
      const value = rows[row][column];
      const text = definition.formatCell
        ? definition.formatCell(value, rows[row], row)
        : String(value ?? this.getUndefinedDisplay());
      for (const line of String(text).split(/\r\n|\n|\r/)) {
        width = Math.max(width, this.gridAdapter.measureText(line).width);
      }
      if (row > 0 && row % 1000 === 0)
        await this.yieldFitScan(controller.signal);
    }
    if (!controller.signal.aborted) {
      this.tableEditor.setScreenColumnWidthAt(column, Math.ceil(width) + 16);
    }
  }

  beginFitScan() {
    this.fitController?.abort();
    this.fitController = new AbortController();
    return this.fitController;
  }

  yieldFitScan(signal) {
    return new Promise((resolve) => {
      if (signal.aborted) resolve();
      else requestAnimationFrame(resolve);
    });
  }

  makeCellVisible(position) {
    position = Point.fromObject(position);
    this.gridAdapter?.scrollCellIntoView(position.row, position.column);
  }

  //     ######   #######  ##    ## ######## ########   #######  ##
  //    ##    ## ##     ## ###   ##    ##    ##     ## ##     ## ##
  //    ##       ##     ## ####  ##    ##    ##     ## ##     ## ##
  //    ##       ##     ## ## ## ##    ##    ########  ##     ## ##
  //    ##       ##     ## ##  ####    ##    ##   ##   ##     ## ##
  //    ##    ## ##     ## ##   ###    ##    ##    ##  ##     ## ##
  //     ######   #######  ##    ##    ##    ##     ##  #######  ########

  save() {
    return this.tableEditor.save();
  }

  copySelectedCells() {
    this.tableEditor.copySelectedCells();
  }

  cutSelectedCells() {
    if (this.readOnly) {
      this.tableEditor.copySelectedCells();
    } else {
      this.tableEditor.cutSelectedCells();
    }
  }

  pasteClipboard() {
    if (!this.readOnly) {
      this.tableEditor.pasteClipboard();
    }
  }

  delete() {
    this.tableEditor.delete();
  }

  focus() {
    if (!this.hasFocus()) this.gridAdapter?.focus();
  }

  hasFocus() {
    return this.gridAdapter?.hasFocus() || false;
  }

  moveLeft() {
    this.tableEditor.moveLeft();
    this.afterCursorMove();
  }

  moveRight() {
    this.tableEditor.moveRight();
    this.afterCursorMove();
  }

  moveUp() {
    this.tableEditor.moveUp();
    this.afterCursorMove();
  }

  moveDown() {
    this.tableEditor.moveDown();
    this.afterCursorMove();
  }

  moveLeftInSelection() {
    this.tableEditor.moveLeftInSelection();
    this.afterCursorMove();
  }

  moveRightInSelection() {
    const cursor = this.tableEditor.getLastCursor();
    const lastCell = [
      this.tableEditor.getLastRowIndex(),
      this.tableEditor.getLastColumnIndex(),
    ];

    if (
      cursor.getPosition().isEqual(lastCell) &&
      !cursor.selection.spanMoreThanOneCell()
    ) {
      this.insertRowAfter();
      this.tableEditor.setCursorAtScreenPosition([
        this.tableEditor.getLastRowIndex(),
        0,
      ]);
    } else {
      this.tableEditor.moveRightInSelection();
    }

    this.afterCursorMove();
  }

  moveUpInSelection() {
    this.tableEditor.moveUpInSelection();
    this.afterCursorMove();
  }

  moveDownInSelection() {
    this.tableEditor.moveDownInSelection();
    this.afterCursorMove();
  }

  moveToTop() {
    this.tableEditor.moveToTop();
    this.afterCursorMove();
  }

  moveToBottom() {
    this.tableEditor.moveToBottom();
    this.afterCursorMove();
  }

  moveToRight() {
    this.tableEditor.moveToRight();
    this.afterCursorMove();
  }

  moveToLeft() {
    this.tableEditor.moveToLeft();
    this.afterCursorMove();
  }

  pageUp() {
    this.tableEditor.pageUp();
    this.afterCursorMove();
  }

  pageDown() {
    this.tableEditor.pageDown();
    this.afterCursorMove();
  }

  pageLeft() {
    this.tableEditor.pageLeft();
    this.afterCursorMove();
  }

  pageRight() {
    this.tableEditor.pageRight();
    this.afterCursorMove();
  }

  addCursorBelowLastSelection() {
    this.tableEditor.addCursorBelowLastSelection();
    this.afterCursorMove();
  }

  addCursorAboveLastSelection() {
    this.tableEditor.addCursorAboveLastSelection();
    this.afterCursorMove();
  }

  addCursorLeftToLastSelection() {
    this.tableEditor.addCursorLeftToLastSelection();
    this.afterCursorMove();
  }

  addCursorRightToLastSelection() {
    this.tableEditor.addCursorRightToLastSelection();
    this.afterCursorMove();
  }

  moveRowDown() {
    this.tableEditor.moveRowDown();
    this.afterCursorMove();
  }

  moveRowUp() {
    this.tableEditor.moveRowUp();
    this.afterCursorMove();
  }

  moveColumnLeft() {
    this.tableEditor.moveColumnLeft();
    this.afterCursorMove();
  }

  moveColumnRight() {
    this.tableEditor.moveColumnRight();
    this.afterCursorMove();
  }

  afterCursorMove() {
    this.makeCellVisible(this.tableEditor.getCursorPosition());
  }

  alignLeft() {
    this.setColumnAlignment("left");
  }

  alignCenter() {
    this.setColumnAlignment("center");
  }

  alignRight() {
    this.setColumnAlignment("right");
  }

  setColumnAlignment(alignment) {
    const column =
      this.contextMenuColumn ?? this.tableEditor.getCursorPosition().column;
    this.tableEditor.getScreenColumn(column).align = alignment;
  }

  expandColumn() {
    this.resizeSelectedColumns(
      lumine.config.get("table-editor.tableEditor.columnWidthIncrement"),
    );
  }

  shrinkColumn() {
    this.resizeSelectedColumns(
      -lumine.config.get("table-editor.tableEditor.columnWidthIncrement"),
    );
  }

  resizeSelectedColumns(delta) {
    const columns = new Set();
    for (const cursor of this.tableEditor.getCursors()) {
      const { column } = cursor.getPosition();
      if (columns.has(column)) continue;
      this.tableEditor.setScreenColumnWidthAt(
        column,
        this.tableEditor.getScreenColumnWidthAt(column) + delta,
      );
      columns.add(column);
    }
  }

  expandRow() {
    this.resizeSelectedRows(
      lumine.config.get("table-editor.tableEditor.rowHeightIncrement"),
    );
  }

  shrinkRow() {
    this.resizeSelectedRows(
      -lumine.config.get("table-editor.tableEditor.rowHeightIncrement"),
    );
  }

  resizeSelectedRows(delta) {
    const rows = new Set();
    for (const cursor of this.tableEditor.getCursors()) {
      const { row } = cursor.getPosition();
      if (rows.has(row)) continue;
      this.tableEditor.setScreenRowHeightAt(
        row,
        this.tableEditor.getScreenRowHeightAt(row) + delta,
      );
      rows.add(row);
    }
  }

  goToCell([row, column]) {
    if (row && column) {
      if (typeof column === "string") {
        column = this.tableEditor.getColumnIndex(column) + 1;
      }

      this.tableEditor.setCursorAtScreenPosition([row - 1, column - 1]);
    } else if (row != null) {
      this.tableEditor.setCursorAtScreenPosition([row - 1, 0]);
    }

    this.makeCellVisible(this.tableEditor.getCursorPosition());
  }

  openGoToCellModal() {
    const goToCellElement = new GoToCellElement().initialize();
    goToCellElement.setModel(this);
    goToCellElement.attach();
    return goToCellElement;
  }

  applySort() {
    this.tableEditor.applySort();
  }

  //    ######## ########  #### ########
  //    ##       ##     ##  ##     ##
  //    ##       ##     ##  ##     ##
  //    ######   ##     ##  ##     ##
  //    ##       ##     ##  ##     ##
  //    ##       ##     ##  ##     ##
  //    ######## ########  ####    ##

  isEditing() {
    return this.editing;
  }

  startCellEdit(initialData) {
    if (this.readOnly) {
      return;
    }

    if (this.tableEditor.getScreenColumnCount() === 0) this.insertColumnAfter();
    if (this.tableEditor.getScreenRowCount() === 0) this.insertRowAfter();

    this.createTextEditor();
    this.subscribeToTextEditor(() => this.confirmCellEdit());

    this.editing = true;
    this.editingKind = "cell";

    const cursor = this.tableEditor.getLastCursor();
    const position = cursor.getPosition();
    this.positionTextEditor();

    const column = this.tableEditor.getScreenColumn(position.column);
    this.editor.setGrammar(
      lumine.grammars.grammarForScopeName(column.grammarScope),
    );

    this.editorElement.dataset.column =
      column.name || columnName(position.column);
    this.editorElement.dataset.row = position.row + 1;

    this.editorElement.focus();

    const cursorValue = cursor.getValue();
    this.editor.setText(String(cursorValue ?? this.getUndefinedDisplay()));

    this.editor.getBuffer().history.clearUndoStack();
    this.editor.getBuffer().history.clearRedoStack();

    if (initialData != null) {
      this.editor.setText(initialData);
    }
  }

  confirmCellEdit() {
    this.stopEdit();
    const positions = this.tableEditor.getCursors().map((c) => c.getPosition());

    const newValue = this.editor.getText();
    if (newValue !== this.tableEditor.getLastCursor().getValue()) {
      this.tableEditor.setValuesAtScreenPositions(positions, [newValue]);
    }
  }

  startColumnEdit(
    columnIndex = this.tableEditor.getCursorScreenPosition().column,
  ) {
    if (this.readOnly) {
      return;
    }

    this.columnUnderEdit = this.tableEditor.getScreenColumn(columnIndex);
    if (!this.columnUnderEdit) return;

    this.createTextEditor();
    this.subscribeToTextEditor(() => this.confirmColumnEdit());

    this.editing = true;
    this.editingKind = "column";

    this.columnUnderEditIndex = columnIndex;

    this.editor.setGrammar(
      lumine.grammars.grammarForScopeName("text.plain.null-grammar"),
    );
    this.positionTextEditor();

    this.editorElement.removeAttribute("data-row");
    this.editorElement.removeAttribute("data-column");

    this.editorElement.focus();
    this.editor.setText(
      this.columnUnderEdit.name != null
        ? this.columnUnderEdit.name
        : columnName(columnIndex),
    );

    this.editor.getBuffer().history.clearUndoStack();
    this.editor.getBuffer().history.clearRedoStack();
  }

  confirmColumnEdit() {
    this.stopEdit();
    const newValue = this.editor.getText();

    if (newValue === "" || newValue === columnName(this.columnUnderEditIndex)) {
      this.columnUnderEdit.name = undefined;
    } else if (newValue !== this.columnUnderEdit.name) {
      this.columnUnderEdit.name = newValue;
    }

    this.columnUnderEdit = null;
    this.columnUnderEditIndex = null;
  }

  stopEdit() {
    this.editing = false;
    this.editingKind = null;
    if (this.editorElement && this.editorElement.parentNode) {
      this.editorElement.parentNode.removeChild(this.editorElement);
    }
    this.textEditorSubscriptions?.dispose();
    this.textEditorSubscriptions = null;
    this.focus();
  }

  positionTextEditor() {
    if (!this.editing || !this.editorElement || !this.gridAdapter) return;
    const rect =
      this.editingKind === "column"
        ? this.gridAdapter.getColumnRect(this.columnUnderEditIndex)
        : (() => {
            const { row, column } = this.tableEditor
              .getLastCursor()
              .getPosition();
            return this.gridAdapter.getCellRect(row, column);
          })();
    const viewport = this.gridAdapter.getViewportRect();
    if (!rect) {
      this.editorElement.style.display = "none";
      return;
    }
    const left = Math.max(rect.left, viewport.left);
    const top =
      this.editingKind === "column"
        ? rect.top
        : Math.max(rect.top, viewport.top);
    const right = Math.min(rect.right, viewport.right);
    const bottom = Math.min(rect.bottom, viewport.bottom);
    const availableWidth = Math.max(0, right - left);
    const availableHeight = Math.max(0, bottom - top);
    this.editorElement.style.top = px(top);
    this.editorElement.style.left = px(left);
    this.editorElement.style.minWidth = px(availableWidth);
    this.editorElement.style.maxWidth = px(availableWidth);
    this.editorElement.style.minHeight = px(availableHeight);
    this.editorElement.style.maxHeight = px(availableHeight);
    this.editorElement.style.display =
      availableWidth && availableHeight ? "block" : "none";
  }

  createTextEditor() {
    if (!this.editor) {
      this.editor = lumine.workspace.buildTextEditor({ mini: true });
    }
    if (!this.editorElement) {
      this.editorElement = lumine.views.getView(this.editor);
    }
    this.appendChild(this.editorElement);
  }

  subscribeToTextEditor(confirm) {
    this.textEditorSubscriptions?.dispose();
    this.textEditorSubscriptions = new CompositeDisposable();
    this.textEditorSubscriptions.add(
      lumine.commands.add(this.editorElement, {
        "table-editor:move-right-in-selection": stopPropagationAndDefault(
          () => {
            confirm();
            this.moveRightInSelection();
          },
        ),
        "table-editor:move-left-in-selection": stopPropagationAndDefault(() => {
          confirm();
          this.moveLeftInSelection();
        }),
        "core:cancel": stopPropagation(() => {
          this.stopEdit();
          return false;
        }),
        "core:confirm": stopPropagation(() => {
          confirm();
          return false;
        }),
      }),
    );

    this.textEditorSubscriptions.add(
      disposableEvent(
        this.editorElement,
        "click",
        stopPropagationAndDefault(() => this.editorElement.focus()),
      ),
    );
  }

  //     ######  ######## ##       ########  ######  ########
  //    ##    ## ##       ##       ##       ##    ##    ##
  //    ##       ##       ##       ##       ##          ##
  //     ######  ######   ##       ######   ##          ##
  //          ## ##       ##       ##       ##          ##
  //    ##    ## ##       ##       ##       ##    ##    ##
  //     ######  ######## ######## ########  ######     ##

  resetSelections() {
    this.tableEditor.setSelectedRange(
      this.tableEditor.getLastSelection().getRange(),
    );
  }

  expandSelectionRight() {
    this.gridAdapter.moveActiveSelection(0, 1, true);
  }

  expandSelectionLeft() {
    this.gridAdapter.moveActiveSelection(0, -1, true);
  }

  expandSelectionUp() {
    this.gridAdapter.moveActiveSelection(-1, 0, true);
  }

  expandSelectionDown() {
    this.gridAdapter.moveActiveSelection(1, 0, true);
  }

  expandSelectionToEndOfLine() {
    this.tableEditor.expandToRight();
    this.makeColumnVisible(
      this.tableEditor.getLastSelection().getRange().end.column - 1,
    );
  }

  expandSelectionToBeginningOfLine() {
    this.tableEditor.expandToLeft();
    this.makeColumnVisible(
      this.tableEditor.getLastSelection().getRange().start.column,
    );
  }

  expandSelectionToEndOfTable() {
    this.tableEditor.expandToBottom();
    this.makeRowVisible(
      this.tableEditor.getLastSelection().getRange().end.row - 1,
    );
  }

  expandSelectionToBeginningOfTable() {
    this.tableEditor.expandToTop();
    this.makeRowVisible(
      this.tableEditor.getLastSelection().getRange().start.row,
    );
  }
}

TableElement.registerCommands();

module.exports = registerElement("table-editor", TableElement);
