"use strict";

const { CompositeDisposable } = require("lumine");
const disposableEvent = require("./disposable-event");
const registerElement = require("./register-element");
const DelimitedTextFormElement = require("./csv-editor-form-element");
const CSVProgressElement = require("./csv-progress-element");
const TableEditor = require("./table-editor");

class DelimitedTextEditorElement extends HTMLElement {
  constructor() {
    super();
  }

  initialize() {
    if (this.elementInitialized) return this;
    this.elementInitialized = true;
    this.setAttribute("tabindex", -1);
    this.subscriptions = new CompositeDisposable();
    this.classList.add("pane-item");
    this.setAttribute("data-context-menu-boundary", "");
    this.subscriptions.add(
      lumine.commands.add(this, {
        "core:save-as": (event) => {
          if (!this.model?.editor) {
            event.stopImmediatePropagation();
            event.preventDefault();
          }
        },
      }),
    );

    this.createFormView();
    return this;
  }

  connectedCallback() {
    this.initialize();
  }

  collectOptions() {
    return this.form.collectOptions();
  }

  tryCollectOptions(reportError = false) {
    const options = this.form?.readOptions() || null;
    if (!options && reportError && this.form) {
      this.form.cleanMessages();
      this.form.alert("Delimiter, quote, and escape values cannot be empty");
    }
    if (!options) this.invalidatePreview();
    this.form?.openTableEditorButton.toggleAttribute("disabled", !options);
    return options;
  }

  getModel() {
    return this.model;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.hideProgress();
    if (this.initialFrame != null) cancelAnimationFrame(this.initialFrame);
    this.initialFrame = null;
    this.clearLoadingSubscription();
    this.removeFormView();
    this.removeTableEditor();
    this.modelSubscriptions?.dispose();
    this.modelSubscriptions = null;
    this.subscriptions.dispose();
    this.model = null;
  }

  focus() {
    this.tableElement && this.tableElement.focus();
  }

  setModel(model) {
    this.initialize();
    if (this.destroyed) throw new Error("Cannot set a destroyed view's model");
    if (model === this.model) return;
    if (this.initialFrame != null) cancelAnimationFrame(this.initialFrame);
    this.initialFrame = null;
    this.modelSubscriptions?.dispose();
    this.model = model;
    if (!this.form && !model.editor) this.createFormView();
    this.form?.setModel(this.model.options);
    this.modelSubscriptions = new CompositeDisposable();
    const subscriptions = this.modelSubscriptions;
    subscriptions.add(this.model.onDidDestroy(() => this.destroy()));

    subscriptions.add(
      this.model.onDidChange(() => {
        if (this.model.editor) {
          if (this.model.editor !== this.tableElement?.getModel?.()) {
            this.removeTableEditor();
            this.displayTableEditor(this.model.editor);
          }
        } else if (this.tableElement) {
          this.createFormView();
        } else {
          const options = this.tryCollectOptions();
          if (options) this.updatePreview(options);
        }
      }),
    );

    subscriptions.add(
      this.model.onWillOpen(() => {
        this.ensureProgress();
        this.removeFormView();
        this.setLoadingSubscription(
          this.model.onDidReadData(({ input, lines }) => {
            this.input = input;
            this.lines = lines;
            this.requestProgressUpdate();
          }),
        );
      }),
    );

    subscriptions.add(
      this.model.onWillFillTable(() => {
        this.clearLoadingSubscription();
        this.ensureProgress();
        this.removeFormView();

        this.setLoadingSubscription(
          this.model.onFillTable(({ table }) => {
            const count = table.getRowCount();
            this.progress?.updateFillTable(count, count / this.lines);
          }),
        );
      }),
    );

    subscriptions.add(
      this.model.onDidFailOpen(({ err }) => {
        this.clearLoadingSubscription();
        this.hideProgress();
        this.createFormView();
        this.form.alert(err.message);
      }),
    );

    subscriptions.add(
      this.model.onDidOpen(({ editor }) => {
        if (!(editor instanceof TableEditor)) {
          return;
        }

        this.hideProgress();
        this.clearLoadingSubscription();

        this.displayTableEditor(editor);
      }),
    );

    this.initialFrame = requestAnimationFrame(() => {
      this.initialFrame = null;
      if (this.destroyed || this.model !== model) return;
      const options = this.tryCollectOptions();
      if (options) this.updatePreview(options);
      this.model.applyChoice();
    });
  }

  displayTableEditor(editor) {
    this.removeFormView();
    if (this.tableElement?.getModel?.() === editor) return;
    this.removeTableEditor();

    this.tableElement = lumine.views.getView(editor);
    this.appendChild(this.tableElement);

    this.tableElement.focus();
  }

  removeTableEditor() {
    if (this.tableElement && this.tableElement.parentNode) {
      this.removeChild(this.tableElement);
    }
    this.tableElement = null;
  }

  createFormView() {
    if (this.form) {
      return;
    }

    this.removeTableEditor();

    this.formContainer = document.createElement("div");
    this.formContainer.className = "settings-view";

    this.form = new DelimitedTextFormElement().initialize();
    this.formSubscriptions = new CompositeDisposable();

    this.formSubscriptions.add(
      disposableEvent(this.form.openTextEditorButton, "click", () => {
        const options = this.tryCollectOptions(true);
        if (!options) return;
        this.model.choice = "TextEditor";
        this.model.openTextEditor(options);
      }),
    );

    this.formSubscriptions.add(
      disposableEvent(this.form.openTableEditorButton, "click", () => {
        this.form.cleanMessages();
        const options = this.tryCollectOptions(true);
        if (!options) return;
        this.model.choice = "TableEditor";
        this.model.openTableEditor(options);
      }),
    );

    this.formSubscriptions.add(
      this.form.onDidChange((options) => {
        if (!options) {
          this.invalidatePreview();
          this.form.openTableEditorButton.setAttribute("disabled", "true");
          return;
        }
        this.updatePreview(options);
      }),
    );

    this.formContainer.appendChild(this.form);
    if (this.model) {
      this.form.setModel(this.model.options);
    }
    this.appendChild(this.formContainer);
  }

  removeFormView() {
    if (this.formContainer && this.formContainer.parentNode) {
      this.removeChild(this.formContainer);
    }
    this.form?.destroy();
    this.invalidatePreview();
    this.formSubscriptions?.dispose();
    this.formSubscriptions = null;
    this.form = null;
    this.formContainer = null;
  }

  updatePreview(options) {
    const revision = (this.previewRevision || 0) + 1;
    this.previewRevision = revision;
    if (options.remember || !lumine.config.get("table-editor.showPreview")) {
      return;
    }
    if (!this.model) {
      return;
    }

    this.form.preview.clean();
    this.model
      .previewCSV(options)
      .then((preview) => {
        if (!this.form || revision !== this.previewRevision) {
          return;
        }
        this.form.preview.render(preview, options);
        this.form.openTableEditorButton.removeAttribute("disabled");
      })
      .catch((reason) => {
        if (!this.form || revision !== this.previewRevision) {
          return;
        }
        this.form.preview.error(reason);
        this.form.openTableEditorButton.setAttribute("disabled", "true");
      });
  }

  invalidatePreview() {
    this.previewRevision = (this.previewRevision || 0) + 1;
  }

  ensureProgress() {
    if (!this.progress) {
      return this.displayProgress();
    }
  }

  displayProgress() {
    this.progress = new CSVProgressElement().initialize();
    this.appendChild(this.progress);
  }

  hideProgress() {
    this.cancelProgressUpdate();
    if (this.progress && this.progress.parentNode) {
      this.removeChild(this.progress);
    }
    this.progress = null;
  }

  requestProgressUpdate() {
    if (this.frameRequested || !this.progress) {
      return;
    }
    this.frameRequested = true;

    this.progressFrame = requestAnimationFrame(() => {
      this.progressFrame = null;
      this.frameRequested = false;
      if (!this.progress || !this.input) return;
      this.progress.updateReadData(this.input, this.lines);
    });
  }

  cancelProgressUpdate() {
    if (this.progressFrame != null) cancelAnimationFrame(this.progressFrame);
    this.progressFrame = null;
    this.frameRequested = false;
  }

  setLoadingSubscription(subscription) {
    this.clearLoadingSubscription();
    this.loadingSubscription = subscription;
  }

  clearLoadingSubscription() {
    this.loadingSubscription?.dispose();
    this.loadingSubscription = null;
  }
}

module.exports = registerElement(
  "table-editor-delimited-text",
  DelimitedTextEditorElement,
);
