"use strict";

const { CompositeDisposable } = require("lumine");
const registerElement = require("./register-element");

class GoToCellElement extends HTMLElement {
  constructor() {
    super();
  }

  initialize() {
    if (this.elementInitialized) return this;
    this.elementInitialized = true;
    this.subscriptions = new CompositeDisposable();
    return this;
  }

  connectedCallback() {
    this.initialize();
  }

  connectedMoveCallback() {}

  attach() {
    this.initialize();
    const window =
      lumine.workspace.getWindowForElement(this.tableElement) ??
      lumine.workspace.getMainWindow();
    this.inputDialogHost = lumine.workspace.addInputDialog(
      {
        placeholderText: "row:column",
        infoMessage: "Enter a row and a column number or column name.",
      },
      { window, item: this },
    );
    this.inputDialog = this.inputDialogHost.getModel();
    this.miniEditor = this.inputDialog.getQueryEditor();
    this.append(this.inputDialog.getElement());
    this.subscriptions.add(
      this.inputDialog.onDidConfirm(() => this.confirm()),
      this.inputDialogHost.onDidCancel(() => this.destroy()),
      this.inputDialogHost.onDidDestroy(() => this.destroy()),
    );
    this.panel = this.inputDialogHost.getPanel();
    this.inputDialogHost.show();
  }

  confirm() {
    if (this.destroyed || !this.inputDialog.getQueryStatus().available) return;
    const text = this.inputDialog.getQuery().trim();
    if (text) {
      const position = text
        .split(":")
        .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
      this.tableElement.goToCell(position);
    }
    this.destroy();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.subscriptions.dispose();
    const destroyed = this.inputDialogHost?.destroyed
      ? undefined
      : this.inputDialogHost?.destroy();
    this.tableElement?.focus();
    return destroyed;
  }

  setModel(tableElement) {
    this.tableElement = tableElement;
  }
}

module.exports = registerElement("table-editor-go-to-cell", GoToCellElement);
