"use strict";

const { CompositeDisposable } = require("lumine");
const disposableEvent = require("./disposable-event");
const registerElement = require("./register-element");

class GoToCellElement extends HTMLElement {
  constructor() {
    super();
  }

  initialize() {
    if (this.elementInitialized) return this;
    this.elementInitialized = true;
    this.subscriptions = new CompositeDisposable();
    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.className = "input-text native-key-bindings";
    this.input.placeholder = "row:column";
    const message = document.createElement("div");
    message.className = "message";
    message.textContent = "Enter a row and a column number or column name.";
    this.append(this.input, message);
    this.subscriptions.add(
      lumine.commands.add(this, {
        "core:cancel": () => this.destroy(),
        "core:confirm": () => this.confirm(),
      }),
    );
    this.subscriptions.add(
      disposableEvent(this.input, "keydown", (event) => {
        if (event.key === "Enter") this.confirm();
        else if (event.key === "Escape") this.destroy();
      }),
    );
    return this;
  }

  connectedCallback() {
    this.initialize();
    this.input.focus();
  }

  attach() {
    this.initialize();
    this.panel = lumine.workspace.addModalPanel({ item: this, visible: true });
  }

  confirm() {
    const text = this.input.value.trim();
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
    this.panel?.destroy();
    this.subscriptions.dispose();
    this.tableElement?.focus();
  }

  setModel(tableElement) {
    this.tableElement = tableElement;
  }
}

module.exports = registerElement("table-editor-go-to-cell", GoToCellElement);
