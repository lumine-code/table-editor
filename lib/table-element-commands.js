"use strict";

const stopPropagationAndDefault = (callback) =>
  function (event) {
    event.stopPropagation();
    event.preventDefault();
    return callback?.call(this, event);
  };

const stopEventPropagation = (commandListeners) =>
  Object.fromEntries(
    Object.entries(commandListeners).map(([commandName, commandListener]) => [
      commandName,
      function (event) {
        event.stopPropagation();
        return commandListener.call(this.getModel(), event);
      },
    ]),
  );

const stopEventPropagationAndGroupUndo = (commandListeners) =>
  Object.fromEntries(
    Object.entries(commandListeners).map(([commandName, commandListener]) => [
      commandName,
      function (event) {
        event.stopPropagation();
        const model = this.getModel();
        return model.transact(
          lumine.config.get("editor.undoGroupingInterval"),
          () => commandListener.call(model, event),
        );
      },
    ]),
  );

let commandDisposables = [];

function registerCommands() {
  if (commandDisposables.length) return;
  const add = (...args) => {
    commandDisposables.push(lumine.commands.add(...args));
  };
  add("table-editor", {
    "core:save": stopPropagationAndDefault(function () {
      this.save();
    }),
    "core:confirm"() {
      this.startCellEdit();
    },
    "core:cancel"() {
      this.resetSelections();
    },
    "core:copy"() {
      this.copySelectedCells();
    },
    "core:cut"() {
      this.cutSelectedCells();
    },
    "core:paste"() {
      this.pasteClipboard();
    },
    "core:undo"() {
      this.tableEditor.undo();
    },
    "core:redo"() {
      this.tableEditor.redo();
    },
    "core:backspace"() {
      this.delete();
    },
    "core:delete"() {
      this.delete();
    },
    "core:move-left"() {
      this.moveLeft();
    },
    "core:move-right"() {
      this.moveRight();
    },
    "core:move-up"() {
      this.moveUp();
    },
    "core:move-down"() {
      this.moveDown();
    },
    "core:move-to-top"() {
      this.moveToTop();
    },
    "core:move-to-bottom"() {
      this.moveToBottom();
    },
    "table-editor:move-to-end-of-row"() {
      this.moveToRight();
    },
    "table-editor:move-to-start-of-row"() {
      this.moveToLeft();
    },
    "core:page-up"() {
      this.pageUp();
    },
    "core:page-down"() {
      this.pageDown();
    },
    "table-editor:page-left"() {
      this.pageLeft();
    },
    "table-editor:page-right"() {
      this.pageRight();
    },
    "core:select-right"() {
      this.expandSelectionRight();
    },
    "core:select-left"() {
      this.expandSelectionLeft();
    },
    "core:select-up"() {
      this.expandSelectionUp();
    },
    "core:select-down"() {
      this.expandSelectionDown();
    },
    "table-editor:move-left-in-selection"() {
      this.moveLeftInSelection();
    },
    "table-editor:move-right-in-selection"() {
      this.moveRightInSelection();
    },
    "table-editor:move-up-in-selection"() {
      this.moveUpInSelection();
    },
    "table-editor:move-down-in-selection"() {
      this.moveDownInSelection();
    },
    "table-editor:select-to-end-of-row"() {
      this.expandSelectionToEndOfLine();
    },
    "table-editor:select-to-start-of-row"() {
      this.expandSelectionToBeginningOfLine();
    },
    "table-editor:select-to-end-of-table"() {
      this.expandSelectionToEndOfTable();
    },
    "table-editor:select-to-beginning-of-table"() {
      this.expandSelectionToBeginningOfTable();
    },
    "table-editor:insert-row-before"() {
      this.insertRowBefore();
    },
    "table-editor:insert-row-after"() {
      this.insertRowAfter();
    },
    "table-editor:delete-row"() {
      this.deleteSelectedRows();
    },
    "table-editor:insert-column-before"() {
      this.insertColumnBefore();
    },
    "table-editor:insert-column-after"() {
      this.insertColumnAfter();
    },
    "table-editor:delete-column"() {
      this.deleteSelectedColumns();
    },
    "table-editor:align-left"() {
      this.alignLeft();
    },
    "table-editor:align-center"() {
      this.alignCenter();
    },
    "table-editor:align-right"() {
      this.alignRight();
    },
    "table-editor:add-selection-below"() {
      this.addCursorBelowLastSelection();
    },
    "table-editor:add-selection-above"() {
      this.addCursorAboveLastSelection();
    },
    "table-editor:add-selection-left"() {
      this.addCursorLeftToLastSelection();
    },
    "table-editor:add-selection-right"() {
      this.addCursorRightToLastSelection();
    },
    "table-editor:expand-column"() {
      this.expandColumn();
    },
    "table-editor:shrink-column"() {
      this.shrinkColumn();
    },
    "table-editor:expand-row"() {
      this.expandRow();
    },
    "table-editor:shrink-row"() {
      this.shrinkRow();
    },
    "table-editor:go-to-cell"() {
      this.openGoToCellModal();
    },
    "table-editor:move-row-down"() {
      this.moveRowDown();
    },
    "table-editor:move-row-up"() {
      this.moveRowUp();
    },
    "table-editor:move-column-left"() {
      this.moveColumnLeft();
    },
    "table-editor:move-column-right"() {
      this.moveColumnRight();
    },
    "table-editor:apply-sort"() {
      this.applySort();
    },
    "table-editor:sort-ascending"() {
      this.sortColumn("ascending");
    },
    "table-editor:sort-descending"() {
      this.sortColumn("descending");
    },
    "table-editor:clear-sort"() {
      this.sortColumn("clear");
    },
    "table-editor:fit-column-to-content"() {
      const column =
        this.contextMenuColumn != null
          ? this.contextMenuColumn
          : this.tableEditor.getCursorPosition().column;
      this.fitColumnToContent(column);
    },
    "table-editor:fit-row-to-content"() {
      const row =
        this.contextMenuRow != null
          ? this.contextMenuRow
          : this.tableEditor.getCursorPosition().row;
      this.fitRowToContent(row);
    },
  });

  add(
    "table-editor lumine-text-editor[mini]",
    stopEventPropagation({
      "core:move-up"() {
        this.moveUp();
      },
      "core:move-down"() {
        this.moveDown();
      },
      "core:move-to-top"() {
        this.moveToTop();
      },
      "core:move-to-bottom"() {
        this.moveToBottom();
      },
      "core:page-up"() {
        this.pageUp();
      },
      "core:page-down"() {
        this.pageDown();
      },
      "core:select-to-top"() {
        this.selectToTop();
      },
      "core:select-to-bottom"() {
        this.selectToBottom();
      },
      "core:select-page-up"() {
        this.selectPageUp();
      },
      "core:select-page-down"() {
        this.selectPageDown();
      },
      "editor:add-selection-below"() {
        this.addSelectionBelow();
      },
      "editor:add-selection-above"() {
        this.addSelectionAbove();
      },
      "editor:split-selections-into-lines"() {
        this.splitSelectionsIntoLines();
      },
      "editor:toggle-soft-tabs"() {
        this.toggleSoftTabs();
      },
      "editor:toggle-soft-wrap"() {
        this.toggleSoftWrapped();
      },
      "editor:fold-all"() {
        this.foldAll();
      },
      "editor:unfold-all"() {
        this.unfoldAll();
      },
      "editor:fold-current-row"() {
        this.foldCurrentRow();
      },
      "editor:unfold-current-row"() {
        this.unfoldCurrentRow();
      },
      "editor:fold-selection"() {
        this.foldSelectedLines();
      },
      "editor:fold-at-indent-level-1"() {
        this.foldAllAtIndentLevel(0);
      },
      "editor:fold-at-indent-level-2"() {
        this.foldAllAtIndentLevel(1);
      },
      "editor:fold-at-indent-level-3"() {
        this.foldAllAtIndentLevel(2);
      },
      "editor:fold-at-indent-level-4"() {
        this.foldAllAtIndentLevel(3);
      },
      "editor:fold-at-indent-level-5"() {
        this.foldAllAtIndentLevel(4);
      },
      "editor:fold-at-indent-level-6"() {
        this.foldAllAtIndentLevel(5);
      },
      "editor:fold-at-indent-level-7"() {
        this.foldAllAtIndentLevel(6);
      },
      "editor:fold-at-indent-level-8"() {
        this.foldAllAtIndentLevel(7);
      },
      "editor:fold-at-indent-level-9"() {
        this.foldAllAtIndentLevel(8);
      },
      "editor:log-cursor-scope"() {
        this.logCursorScope();
      },
      "editor:copy-path"() {
        this.copyPathToClipboard();
      },
      "editor:toggle-indent-guide"() {
        lumine.config.set(
          "editor.showIndentGuide",
          !lumine.config.get("editor.showIndentGuide"),
        );
      },
      "editor:toggle-line-numbers"() {
        lumine.config.set(
          "editor.showLineNumbers",
          !lumine.config.get("editor.showLineNumbers"),
        );
      },
      "editor:scroll-to-cursor"() {
        this.scrollToCursorPosition();
      },
    }),
  );

  add(
    "table-editor lumine-text-editor[mini]",
    stopEventPropagationAndGroupUndo({
      "editor:indent"() {
        this.indent();
      },
      "editor:auto-indent"() {
        this.autoIndentSelectedRows();
      },
      "editor:indent-selected-rows"() {
        this.indentSelectedRows();
      },
      "editor:outdent-selected-rows"() {
        this.outdentSelectedRows();
      },
      "editor:newline"() {
        this.insertNewline();
      },
      "editor:newline-below"() {
        this.insertNewlineBelow();
      },
      "editor:newline-above"() {
        this.insertNewlineAbove();
      },
      "editor:toggle-line-comments"() {
        this.toggleLineCommentsInSelection();
      },
      "editor:checkout-head-revision"() {
        this.checkoutHeadRevision();
      },
      "editor:move-row-up"() {
        this.moveRowUp();
      },
      "editor:move-row-down"() {
        this.moveRowDown();
      },
      "editor:duplicate-lines"() {
        this.duplicateLines();
      },
      "editor:join-lines"() {
        this.joinLines();
      },
    }),
  );
}

function disposeCommands() {
  for (const disposable of commandDisposables) disposable.dispose();
  commandDisposables = [];
}

module.exports = { disposeCommands, registerCommands };
