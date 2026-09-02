"use strict";

const { CompositeDisposable, Emitter } = require("lumine");
const encodings = require("./encodings");
const disposableEvent = require("./disposable-event");
const registerElement = require("./register-element");
const CSVPreviewElement = require("./csv-preview-element");

function field(label, control) {
  const group = document.createElement("label");
  group.classList.add("table-editor-field");
  const title = document.createElement("span");
  title.classList.add("table-editor-field-label");
  title.textContent = label;
  group.append(title, control);
  return group;
}

function textInput(placeholder = "") {
  const input = document.createElement("input");
  input.type = "text";
  input.classList.add(
    "input-text",
    "native-key-bindings",
    "table-editor-control",
  );
  input.placeholder = placeholder;
  return input;
}

function checkbox(label) {
  const wrapper = document.createElement("label");
  wrapper.classList.add("input-label", "table-editor-checkbox");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.classList.add("input-checkbox");
  wrapper.append(input, document.createTextNode(` ${label}`));
  return { wrapper, input };
}

class DelimitedTextFormElement extends HTMLElement {
  constructor() {
    super();
  }

  initialize() {
    if (this.elementInitialized) return this;
    this.elementInitialized = true;
    this.subscriptions = new CompositeDisposable();
    this.emitter = new Emitter();
    this.selectBoxes = [];
    this.buildForm();
    this.subscriptions.add(
      disposableEvent(this, "change", () => this.emitDidChange()),
      disposableEvent(this, "input", () => this.emitDidChange()),
    );
    return this;
  }

  createSelectBox(options, ariaLabel) {
    const selectBox = lumine.menu.createSelectBox({
      items: options.map(([value, label]) => ({ value, label })),
      value: options[0]?.[0],
      ariaLabel,
      className: "table-editor-control",
      matchTriggerFontSize: true,
    });
    this.selectBoxes.push(selectBox);
    this.subscriptions.add(selectBox.onDidChange(() => this.emitDidChange()));
    return selectBox;
  }

  connectedCallback() {
    this.initialize();
  }

  emitDidChange() {
    this.updateCustomFieldVisibility();
    this.updateNormalizationWarning();
    if (!this.modelInitialized) return;
    this.emitter.emit("did-change", this.readOptions());
  }

  buildForm() {
    const panel = document.createElement("div");
    panel.classList.add("table-editor-form-panel");

    const heading = document.createElement("h1");
    heading.classList.add("table-editor-form-heading");
    heading.textContent = "Choose how to open this delimited text file:";
    const remembered = checkbox("Remember my choice for this file");
    remembered.wrapper.classList.add("table-editor-remember-choice");
    this.rememberInput = remembered.input;

    const choices = document.createElement("div");
    choices.classList.add("table-editor-open-actions");
    this.openTableEditorButton = document.createElement("button");
    this.openTableEditorButton.className = "btn btn-lg";
    this.openTableEditorButton.textContent = "Open Table Editor";
    this.openTextEditorButton = document.createElement("button");
    this.openTextEditorButton.className = "btn btn-lg";
    this.openTextEditorButton.textContent = "Open Text Editor";
    choices.append(this.openTableEditorButton, this.openTextEditorButton);

    this.messagesContainer = document.createElement("div");
    this.messagesContainer.classList.add("messages", "table-editor-messages");
    this.normalizationWarning = document.createElement("div");
    this.normalizationWarning.className =
      "alert alert-warning table-editor-normalization-warning";
    this.normalizationWarning.hidden = true;

    const settingsHeading = document.createElement("h2");
    settingsHeading.classList.add("table-editor-section-heading");
    settingsHeading.textContent = "Delimited Text Settings";
    const settings = document.createElement("div");
    settings.classList.add("table-editor-settings-grid");

    this.delimiterSelect = this.createSelectBox(
      [
        ["auto", "Auto-detect"],
        [",", "Comma"],
        [";", "Semicolon"],
        ["\\t", "Tab"],
        ["|", "Pipe"],
        ["custom", "Custom"],
      ],
      "Field Delimiter",
    );
    this.delimiterCustomInput = textInput("custom delimiter");
    this.delimiterCustomField = field(
      "Custom Field Delimiter",
      this.delimiterCustomInput,
    );

    this.recordDelimiterSelect = this.createSelectBox(
      [
        ["auto", "Auto-detect"],
        ["\\r\\n", "CRLF"],
        ["\\n", "LF"],
        ["\\r", "CR"],
        ["custom", "Custom"],
      ],
      "Record Delimiter",
    );
    this.recordDelimiterCustomInput = textInput("custom record delimiter");
    this.quoteInput = textInput("quote character");
    this.escapeInput = textInput("escape character");
    this.commentInput = textInput("empty disables comments");
    const syntaxGroup = document.createElement("div");
    syntaxGroup.classList.add("table-editor-settings-column");
    this.recordDelimiterCustomField = field(
      "Custom Record Delimiter",
      this.recordDelimiterCustomInput,
    );
    this.commentField = field("Comment Prefix", this.commentInput);
    syntaxGroup.append(
      field("Field Delimiter", this.delimiterSelect.element),
      this.delimiterCustomField,
      field("Record Delimiter", this.recordDelimiterSelect.element),
      this.recordDelimiterCustomField,
      field("Quote", this.quoteInput),
      field("Escape", this.escapeInput),
    );

    this.encodingSelect = this.createSelectBox(
      Object.entries(encodings).map(([value, metadata]) => [
        value,
        metadata.list,
      ]),
      "Encoding",
    );
    this.trimSelect = this.createSelectBox(
      [
        ["no", "Do not trim"],
        ["left", "Trim left"],
        ["right", "Trim right"],
        ["both", "Trim both sides"],
      ],
      "Whitespace",
    );
    this.eofSelect = this.createSelectBox(
      [
        ["preserve", "Preserve final newline"],
        ["always", "Always add final newline"],
        ["never", "Never add final newline"],
      ],
      "End-of-File Newline",
    );
    const header = checkbox("First record is a header");
    this.headerInput = header.input;
    const quoteAll = checkbox("Quote every cell when saving");
    this.quoteAllInput = quoteAll.input;
    const skipEmpty = checkbox("Skip empty records");
    this.skipEmptyInput = skipEmpty.input;
    const behaviorGroup = document.createElement("div");
    behaviorGroup.classList.add(
      "table-editor-settings-column",
      "table-editor-settings-behavior",
    );
    behaviorGroup.append(
      field("Encoding", this.encodingSelect.element),
      field("Whitespace", this.trimSelect.element),
      field("End-of-File Newline", this.eofSelect.element),
      this.commentField,
    );
    const toggleRow = document.createElement("div");
    toggleRow.classList.add("table-editor-toggle-row");
    toggleRow.append(header.wrapper, quoteAll.wrapper, skipEmpty.wrapper);
    this.toggleRow = toggleRow;
    settings.append(syntaxGroup, behaviorGroup, toggleRow);

    const previewLabel = document.createElement("p");
    previewLabel.classList.add("table-editor-preview-label");
    previewLabel.textContent = "Preview of the parsed records:";
    this.preview = new CSVPreviewElement();
    panel.append(
      heading,
      remembered.wrapper,
      choices,
      settingsHeading,
      settings,
      this.messagesContainer,
      this.normalizationWarning,
      previewLabel,
      this.preview,
    );
    this.appendChild(panel);
  }

  setModel(options = {}) {
    this.initialize();
    const defaults = (name) =>
      lumine.config.get(`table-editor.delimitedText.${name}`);
    const value = (name) => options[name] ?? defaults(name);
    this.rememberInput.checked = Boolean(options.remember);
    const delimiter = value("delimiter") || "auto";
    this.delimiterSelect.value = ["auto", ",", ";", "\\t", "|"].includes(
      delimiter,
    )
      ? delimiter
      : "custom";
    if (this.delimiterSelect.value === "custom")
      this.delimiterCustomInput.value = delimiter;
    const recordDelimiter = value("recordDelimiter") || "auto";
    this.recordDelimiterSelect.value = [
      "auto",
      "\\r\\n",
      "\\n",
      "\\r",
    ].includes(recordDelimiter)
      ? recordDelimiter
      : "custom";
    if (this.recordDelimiterSelect.value === "custom") {
      this.recordDelimiterCustomInput.value = recordDelimiter;
    }
    this.quoteInput.value = value("quote") || '"';
    this.escapeInput.value = value("escape") || '"';
    this.commentInput.value = value("commentPrefix") || "";
    this.encodingSelect.value = value("encoding") || "utf8";
    this.trimSelect.value = value("trim") || "no";
    this.eofSelect.value = value("endOfFileNewline") || "preserve";
    this.headerInput.checked = Boolean(value("header"));
    this.quoteAllInput.checked = Boolean(value("quoteAll"));
    this.skipEmptyInput.checked = Boolean(value("skipEmptyLines"));
    this.modelInitialized = true;
    this.updateCustomFieldVisibility();
    this.updateNormalizationWarning();
  }

  updateCustomFieldVisibility() {
    this.delimiterCustomField.hidden = this.delimiterSelect.value !== "custom";
    this.recordDelimiterCustomField.hidden =
      this.recordDelimiterSelect.value !== "custom";
  }

  collectOptions() {
    this.initialize();
    const options = this.readOptions();
    if (!options) {
      throw new Error("Delimiter, quote, and escape values cannot be empty");
    }
    return options;
  }

  readOptions() {
    this.initialize();
    const delimiter =
      this.delimiterSelect.value === "custom"
        ? this.delimiterCustomInput.value
        : this.delimiterSelect.value;
    const recordDelimiter =
      this.recordDelimiterSelect.value === "custom"
        ? this.recordDelimiterCustomInput.value
        : this.recordDelimiterSelect.value;
    if (
      !delimiter ||
      !recordDelimiter ||
      !this.quoteInput.value ||
      !this.escapeInput.value
    ) {
      return null;
    }
    return {
      remember: this.rememberInput.checked,
      delimiter,
      recordDelimiter,
      quote: this.quoteInput.value,
      escape: this.escapeInput.value,
      commentPrefix: this.commentInput.value,
      quoteAll: this.quoteAllInput.checked,
      header: this.headerInput.checked,
      endOfFileNewline: this.eofSelect.value,
      skipEmptyLines: this.skipEmptyInput.checked,
      trim: this.trimSelect.value,
      encoding: this.encodingSelect.value,
    };
  }

  updateNormalizationWarning() {
    const destructive = this.commentInput.value || this.skipEmptyInput.checked;
    this.normalizationWarning.hidden = !destructive;
    this.normalizationWarning.textContent = destructive
      ? "Comments or empty records ignored while parsing are not written back when the file is saved."
      : "";
  }

  onDidChange(callback) {
    return this.emitter.on("did-change", callback);
  }

  alert(message) {
    const alert = document.createElement("div");
    alert.className = "alert alert-danger";
    alert.textContent = message;
    this.messagesContainer.appendChild(alert);
  }

  cleanMessages() {
    this.messagesContainer.replaceChildren();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.subscriptions.dispose();
    for (const selectBox of this.selectBoxes.splice(0)) selectBox.destroy();
    this.emitter.dispose();
  }
}

module.exports = registerElement("table-editor-form", DelimitedTextFormElement);
