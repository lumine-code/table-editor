"use strict";

const { CompositeDisposable } = require("lumine");
const { CanvasGrid } = require("@lumine-code/canvas-grid");
const columnName = require("./column-name");
const disposableEvent = require("./disposable-event");
const Range = require("./range");

class TableGridAdapter {
  constructor({ host, model, readOnly = false, callbacks = {} }) {
    this.host = host;
    this.model = model;
    this.callbacks = callbacks;
    this.applyingSelection = false;
    this.subscriptions = new CompositeDisposable();
    this.grid = new CanvasGrid({
      className: "table-editor-grid",
      commands: false,
      ariaLabel: "Delimited text table",
      columns: this.columns(),
      rows: model.displayTable.screenRows,
      copyRows: false,
      rowMetrics: model.displayTable.rowMetrics,
      resizableColumns: !readOnly,
      resizableRows: !readOnly,
      minimumRowHeight: model.getMinimumRowHeight(),
      columnOverscan: lumine.config.get(
        "table-editor.tableEditor.columnOverdraw",
      ),
      clipboard: lumine.clipboard,
      formatRowHeader: ({ windowRow }) => this.rowLabel(windowRow),
      onSelectionChange: (selections, active) =>
        this.applySelection(selections, active),
      onPointerDown: (hit, event) => this.callbacks.onPointerDown?.(hit, event),
      onDoubleClick: (hit) => this.handleDoubleClick(hit),
      onSort: (_column, index, request) => this.sort(index, request),
      onColumnResize: ({ index, width }) =>
        this.model.setScreenColumnWidthAt(index, width),
      onRowResize: ({ windowRow, height }) =>
        this.model.setScreenRowHeightAt(windowRow, height),
      onContextMenu: (hit) => this.callbacks.onContextMenu?.(hit),
      onError: (error) => this.callbacks.onError?.(error),
    });
    this.host.appendChild(this.grid.element);
    this.subscriptions.add(
      this.grid.onDidScroll(() => this.callbacks.onScroll?.()),
      disposableEvent(this.grid.element, "keydown", (event) =>
        this.handleKeyDown(event),
      ),
    );
    this.subscribeToModel();
    this.syncSelections();
  }

  get element() {
    return this.grid.element;
  }

  columns() {
    return this.model.getScreenColumns().map((column, index) => ({
      key: index,
      label: column.name ?? columnName(index),
      width: this.model.getScreenColumnWidthAt(index),
      align: column.align,
      formatCell: column.formatCell,
      paintCell: column.paintCell,
      sortDirection: this.model.order === index ? this.model.direction : null,
    }));
  }

  rowLabel(windowRow) {
    return this.model.screenRowToModelRow(windowRow) + 1;
  }

  subscribeToModel() {
    this.subscriptions.add(
      this.model.onDidAddColumn(() => this.syncData()),
      this.model.onDidRemoveColumn(() => this.syncData()),
      this.model.onDidChangeColumnOption(() => this.syncColumns()),
      this.model.onDidChange(() => this.syncData()),
      this.model.onDidChangeRowHeight(() => {
        this.invalidate();
        this.callbacks.onGeometryChange?.();
      }),
      this.model.onDidAddCursor(() => this.syncSelections()),
      this.model.onDidRemoveCursor(() => this.syncSelections()),
      this.model.onDidChangeCursorPosition(() => this.syncSelections()),
      this.model.onDidAddSelection(() => this.syncSelections()),
      this.model.onDidRemoveSelection(() => this.syncSelections()),
      this.model.onDidChangeSelectionRange(() => this.syncSelections()),
      this.model.onDidChangeCellValue(() => this.invalidate()),
    );
  }

  syncData() {
    this.grid.setRowMetrics(this.model.displayTable.rowMetrics, {
      owned: false,
    });
    this.grid.resetColumnWidths();
    this.grid.setRows({
      columns: this.columns(),
      rows: this.model.displayTable.screenRows,
    });
    this.syncSelections();
  }

  syncColumns() {
    this.grid.resetColumnWidths();
    this.grid.setColumns(this.columns());
    this.syncSelections();
    this.grid.invalidate();
  }

  syncSelections() {
    if (this.applyingSelection) return;
    const selections = this.model.getSelections().map((selection) => {
      const range = selection.getRange();
      return {
        r0: range.start.row,
        c0: range.start.column,
        r1: Math.max(range.start.row, range.end.row - 1),
        c1: Math.max(range.start.column, range.end.column - 1),
      };
    });
    const cursor = this.model.getLastCursor()?.getPosition();
    this.grid.setSelections(
      selections,
      cursor ? { row: cursor.row, column: cursor.column } : null,
    );
  }

  applySelection(selections, active) {
    if (this.applyingSelection || !selections.length || !active) return;
    this.applyingSelection = true;
    try {
      for (const selection of [...this.model.getSelections()])
        selection.destroy();
      selections.forEach((selection, index) => {
        const range = new Range(
          [selection.windowR0, selection.c0],
          [selection.windowR1 + 1, selection.c1 + 1],
        );
        const position =
          index === selections.length - 1
            ? [active.windowRow, active.column]
            : [selection.windowR1, selection.c1];
        this.model.createCursorAndSelection(position, range);
      });
    } finally {
      this.applyingSelection = false;
    }
  }

  sort(column, { direction = "cycle" } = {}) {
    if (direction === "ascending") this.model.sortBy(column, 1);
    else if (direction === "descending") this.model.sortBy(column, -1);
    else if (direction === "clear") this.model.resetSort();
    else if (column !== this.model.order) this.model.sortBy(column);
    else if (this.model.direction === -1) this.model.resetSort();
    else this.model.toggleSortDirection();
  }

  handleDoubleClick(hit) {
    if (hit.zone === "body") this.callbacks.onEditCell?.();
    else if (hit.zone === "column") this.callbacks.onEditColumn?.(hit.column);
  }

  handleKeyDown(event) {
    if (
      this.callbacks.isEditing?.() ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.key?.length !== 1
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.callbacks.onType?.(event.key);
  }

  setReadOnly(readOnly) {
    this.grid.setResizable({ columns: !readOnly, rows: !readOnly });
  }

  requestSort(column, direction, source) {
    return this.grid.requestSort(column, direction, source);
  }

  moveActiveSelection(rowDelta, columnDelta, extend) {
    return this.grid.moveActiveSelection(rowDelta, columnDelta, extend);
  }

  focus() {
    this.grid.focus();
  }

  hasFocus() {
    return this.element.contains(document.activeElement);
  }

  invalidate(layer = "all") {
    this.grid.invalidate(layer);
  }

  scrollRowIntoView(row) {
    this.grid.scrollRowIntoView(row);
  }

  scrollColumnIntoView(column) {
    this.grid.scrollColumnIntoView(column);
  }

  scrollCellIntoView(row, column) {
    this.grid.scrollCellIntoView(row, column);
  }

  getCellRect(row, column) {
    return this.grid.getCellRect(row, column);
  }

  getColumnRect(column) {
    return this.grid.getColumnRect(column);
  }

  getViewportRect() {
    return this.grid.getViewportRect();
  }

  measureText(text) {
    return this.grid.measureText(text);
  }

  getFontMetrics() {
    return this.grid.getFontMetrics();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.subscriptions.dispose();
    this.grid.destroy();
    this.callbacks = null;
    this.model = null;
    this.host = null;
  }
}

module.exports = TableGridAdapter;
