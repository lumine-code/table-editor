"use strict";

const { CompositeDisposable, Emitter } = require("lumine");
const encodings = require("./encodings");
const defineElement = require("./decorators/element");

function field(label, control) {
  const group = document.createElement("label");
  group.classList.add("control-group");
  const title = document.createElement("span");
  title.classList.add("setting-title");
  title.textContent = label;
  group.append(title, control);
  return group;
}

function select(options) {
  const control = document.createElement("select");
  control.classList.add("input-select");
  for (const [value, label] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    control.appendChild(option);
  }
  return control;
}

function textInput(placeholder = "") {
  const input = document.createElement("input");
  input.type = "text";
  input.classList.add("input-text", "native-key-bindings");
  input.placeholder = placeholder;
  return input;
}

function checkbox(label) {
  const wrapper = document.createElement("label");
  wrapper.classList.add("input-label");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.classList.add("input-checkbox");
  wrapper.append(input, document.createTextNode(` ${label}`));
  return { wrapper, input };
}

class DelimitedTextFormElement extends HTMLElement {
  static initClass() {
    return defineElement(this, "table-editor-form");
  }

  createdCallback() {
    this.subscriptions = new CompositeDisposable();
    this.emitter = new Emitter();
    this.buildForm();
    const emit = () => {
      this.updateNormalizationWarning();
      if (this.initialized)
        this.emitter.emit("did-change", this.collectOptions());
    };
    this.addEventListener("change", emit);
    this.addEventListener("input", emit);
    this.subscriptions.add({
      dispose: () => {
        this.removeEventListener("change", emit);
        this.removeEventListener("input", emit);
      },
    });
  }

  buildForm() {
    const panel = document.createElement("div");
    panel.classList.add("settings-panel");

    const heading = document.createElement("div");
    heading.classList.add("setting-title");
    heading.textContent = "Choose how to open this delimited text file:";
    const remembered = checkbox("Remember my choice for this file");
    this.rememberInput = remembered.input;

    const choices = document.createElement("div");
    choices.classList.add("editor-choices");
    this.openTableEditorButton = document.createElement("button");
    this.openTableEditorButton.className = "btn btn-lg";
    this.openTableEditorButton.textContent = "Open Table Editor";
    this.openTextEditorButton = document.createElement("button");
    this.openTextEditorButton.className = "btn btn-lg";
    this.openTextEditorButton.textContent = "Open Text Editor";
    choices.append(this.openTableEditorButton, this.openTextEditorButton);

    this.messagesContainer = document.createElement("div");
    this.messagesContainer.classList.add("messages");
    this.normalizationWarning = document.createElement("div");
    this.normalizationWarning.className = "alert alert-warning";
    this.normalizationWarning.hidden = true;

    const settingsHeading = document.createElement("div");
    settingsHeading.classList.add("setting-title");
    settingsHeading.textContent = "Delimited Text Settings";
    const settings = document.createElement("div");
    settings.classList.add("split-panel");

    this.delimiterSelect = select([
      ["auto", "Auto-detect"],
      [",", "Comma"],
      [";", "Semicolon"],
      ["\\t", "Tab"],
      ["|", "Pipe"],
      ["custom", "Custom"],
    ]);
    this.delimiterCustomInput = textInput("custom delimiter");
    const delimiterGroup = document.createElement("div");
    delimiterGroup.append(
      field("Field Delimiter", this.delimiterSelect),
      field("Custom Field Delimiter", this.delimiterCustomInput),
    );

    this.recordDelimiterSelect = select([
      ["auto", "Auto-detect"],
      ["\\r\\n", "CRLF"],
      ["\\n", "LF"],
      ["\\r", "CR"],
      ["custom", "Custom"],
    ]);
    this.recordDelimiterCustomInput = textInput("custom record delimiter");
    this.quoteInput = textInput("quote character");
    this.escapeInput = textInput("escape character");
    this.commentInput = textInput("empty disables comments");
    const syntaxGroup = document.createElement("div");
    syntaxGroup.append(
      field("Record Delimiter", this.recordDelimiterSelect),
      field("Custom Record Delimiter", this.recordDelimiterCustomInput),
      field("Quote", this.quoteInput),
      field("Escape", this.escapeInput),
      field("Comment Prefix", this.commentInput),
    );

    this.encodingSelect = select(
      Object.entries(encodings).map(([value, metadata]) => [
        value,
        metadata.list,
      ]),
    );
    this.trimSelect = select([
      ["no", "Do not trim"],
      ["left", "Trim left"],
      ["right", "Trim right"],
      ["both", "Trim both sides"],
    ]);
    this.eofSelect = select([
      ["preserve", "Preserve final newline"],
      ["always", "Always add final newline"],
      ["never", "Never add final newline"],
    ]);
    const header = checkbox("First record is a header");
    this.headerInput = header.input;
    const quoteAll = checkbox("Quote every cell when saving");
    this.quoteAllInput = quoteAll.input;
    const skipEmpty = checkbox("Skip empty records");
    this.skipEmptyInput = skipEmpty.input;
    const behaviorGroup = document.createElement("div");
    behaviorGroup.append(
      field("Encoding", this.encodingSelect),
      field("Whitespace", this.trimSelect),
      field("End-of-File Newline", this.eofSelect),
      header.wrapper,
      quoteAll.wrapper,
      skipEmpty.wrapper,
    );
    settings.append(delimiterGroup, syntaxGroup, behaviorGroup);

    const previewLabel = document.createElement("p");
    previewLabel.textContent = "Preview of the parsed records:";
    this.preview = document.createElement("table-editor-preview");
    panel.append(
      heading,
      remembered.wrapper,
      choices,
      this.messagesContainer,
      this.normalizationWarning,
      settingsHeading,
      settings,
      previewLabel,
      this.preview,
    );
    this.appendChild(panel);
  }

  setModel(options = {}) {
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
    this.initialized = true;
    this.updateNormalizationWarning();
  }

  collectOptions() {
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
      throw new Error("Delimiter, quote, and escape values cannot be empty");
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
    this.subscriptions.dispose();
    this.emitter.dispose();
  }
}

module.exports = DelimitedTextFormElement.initClass();
