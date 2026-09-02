"use strict";

const include = require("../decorators/include");

module.exports = class Transactions {
  static includeInto(target) {
    include(target, this);
  }

  initializeHistory({ modified = false } = {}) {
    this.undoStack = [];
    this.redoStack = [];
    this.revisionCounter = modified ? 1 : 0;
    this.currentRevision = modified ? 1 : 0;
    this.savedRevision = 0;
  }

  batchTransaction(block) {
    this.startBatchTransaction();
    try {
      return block();
    } finally {
      this.endBatchTransaction();
    }
  }

  startBatchTransaction() {
    if (this.batchCommit)
      throw new Error("Nested table transactions are not supported");
    const commits = [];
    this.batchCommit = {
      appendCommit(commit) {
        commits.push(commit);
      },
      undo() {
        for (let index = commits.length - 1; index >= 0; index--)
          commits[index].undo();
      },
      redo() {
        for (const commit of commits) commit.redo();
      },
      getLastCommit() {
        return commits.at(-1);
      },
      replaceLastCommit(commit) {
        commits[commits.length - 1] = commit;
      },
      get empty() {
        return commits.length === 0;
      },
    };
  }

  endBatchTransaction() {
    const commit = this.batchCommit;
    this.batchCommit = null;
    if (commit && !commit.empty) this.appendCommit(commit);
  }

  transaction(commit) {
    commit.undo = commit.undo.bind(this);
    commit.redo = commit.redo.bind(this);
    if (this.batchCommit) this.batchCommit.appendCommit(commit);
    else this.appendCommit(commit);
  }

  appendCommit(commit) {
    if (!this.undoStack) this.initializeHistory();
    commit.beforeRevision = this.currentRevision;
    commit.afterRevision = ++this.revisionCounter;
    if (this.undoStack.length >= this.constructor.MAX_HISTORY_SIZE)
      this.undoStack.shift();
    this.redoStack.length = 0;
    this.undoStack.push(commit);
    this.currentRevision = commit.afterRevision;
    this.emitModifiedStatusChange?.();
  }

  amendLastTransaction(commit) {
    const originalCommit = this.getLastCommit();
    this.replaceLastCommit({
      beforeRevision: originalCommit.beforeRevision,
      afterRevision: originalCommit.afterRevision,
      undo: () => commit.undo(originalCommit),
      redo: () => commit.redo(originalCommit),
    });
  }

  getLastCommit() {
    return this.batchCommit
      ? this.batchCommit.getLastCommit()
      : this.undoStack.at(-1);
  }

  replaceLastCommit(commit) {
    if (this.batchCommit) this.batchCommit.replaceLastCommit(commit);
    else this.undoStack[this.undoStack.length - 1] = commit;
  }

  undo() {
    if (!this.undoStack?.length) return false;
    const commit = this.undoStack.pop();
    this.currentRevision = commit.beforeRevision;
    commit.undo();
    this.redoStack.push(commit);
    this.emitModifiedStatusChange?.();
    return true;
  }

  redo() {
    if (!this.redoStack?.length) return false;
    const commit = this.redoStack.pop();
    this.currentRevision = commit.afterRevision;
    commit.redo();
    this.undoStack.push(commit);
    this.emitModifiedStatusChange?.();
    return true;
  }

  clearUndoStack() {
    if (this.undoStack) this.undoStack.length = 0;
  }

  clearRedoStack() {
    if (this.redoStack) this.redoStack.length = 0;
  }

  markSavedRevision() {
    this.savedRevision = this.currentRevision;
    this.emitModifiedStatusChange?.();
  }
};
