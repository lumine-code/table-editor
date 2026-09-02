"use strict";

const { CompositeDisposable } = require("lumine");
const element = require("./decorators/element");

let CSVEditorFormElement, CSVPreviewElement, CSVProgressElement, TableEditor;

class DelimitedTextEditorElement extends HTMLElement {
  static initClass() {
    return element(this, "table-editor-delimited-text");
  }

  createdCallback() {
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
  }

  collectOptions() {
    return this.form.collectOptions();
  }

  tryCollectOptions(reportError = false) {
    try {
      return this.collectOptions();
    } catch (error) {
      if (reportError && this.form) {
        this.form.cleanMessages();
        this.form.alert(error.message);
      }
      this.invalidatePreview();
      this.form?.openTableEditorButton.setAttribute("disabled", "true");
      return null;
    }
  }

  getModel() {
    return this.model;
  }

  destroy() {
    this.cancelProgressUpdate();
    this.subscriptions.dispose();
    this.formSubscriptions && this.formSubscriptions.dispose();
    delete this.model;
  }

  focus() {
    this.tableElement && this.tableElement.focus();
  }

  setModel(model) {
    this.model = model;
    this.form.setModel(this.model.options);
    this.subscriptions.add(this.model.onDidDestroy(() => this.destroy()));

    this.subscriptions.add(
      this.model.onDidChange(() => {
        if (this.model.editor) {
          if (this.model.editor !== this.tableElement.getModel()) {
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

    let loadingSubscription;
    this.subscriptions.add(
      this.model.onWillOpen(() => {
        this.ensureProgress();
        this.removeFormView();
        loadingSubscription = this.model.onDidReadData(({ input, lines }) => {
          this.input = input;
          this.lines = lines;
          this.requestProgressUpdate();
        });
        this.subscriptions.add(loadingSubscription);
      }),
    );

    this.subscriptions.add(
      this.model.onWillFillTable(() => {
        loadingSubscription && loadingSubscription.dispose();
        this.ensureProgress();
        this.removeFormView();

        loadingSubscription = this.model.onFillTable(({ table }) => {
          const count = table.getRowCount();
          this.progress.updateFillTable(count, count / this.lines);
        });
        this.subscriptions.add(loadingSubscription);
      }),
    );

    this.subscriptions.add(
      this.model.onDidFailOpen(({ err }) => {
        this.hideProgress();
        this.createFormView();
        this.form.alert(err.message);
      }),
    );

    this.subscriptions.add(
      this.model.onDidOpen(({ editor }) => {
        if (!TableEditor) {
          TableEditor = require("./table-editor");
        }

        if (!(editor instanceof TableEditor)) {
          return;
        }

        this.hideProgress();
        loadingSubscription && loadingSubscription.dispose();

        this.displayTableEditor(editor);
      }),
    );

    requestAnimationFrame(() => {
      const options = this.tryCollectOptions();
      if (options) this.updatePreview(options);
      this.model.applyChoice();
    });
  }

  displayTableEditor(editor) {
    this.removeFormView();

    this.tableElement = lumine.views.getView(editor);
    this.appendChild(this.tableElement);

    this.tableElement.focus();
  }

  removeTableEditor() {
    if (this.tableElement && this.tableElement.parentNode) {
      this.removeChild(this.tableElement);
    }
    delete this.tableElement;
  }

  createFormView() {
    if (this.form) {
      return;
    }

    if (!CSVEditorFormElement) {
      CSVEditorFormElement = require("./csv-editor-form-element");
    }
    if (!CSVPreviewElement) {
      CSVPreviewElement = require("./csv-preview-element");
    }

    this.removeTableEditor();

    this.formContainer = document.createElement("div");
    this.formContainer.className = "settings-view";

    this.form = new CSVEditorFormElement();
    this.formSubscriptions = new CompositeDisposable();

    this.formSubscriptions.add(
      this.subscribeTo(this.form.openTextEditorButton, {
        click: () => {
          const options = this.tryCollectOptions(true);
          if (!options) return;
          this.model.choice = "TextEditor";
          this.model.openTextEditor(options);
        },
      }),
    );

    this.formSubscriptions.add(
      this.subscribeTo(this.form.openTableEditorButton, {
        click: () => {
          this.form.cleanMessages();
          const options = this.tryCollectOptions(true);
          if (!options) return;
          this.model.choice = "TableEditor";
          this.model.openTableEditor(options);
        },
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
    delete this.formSubscriptions;
    delete this.form;
    delete this.formContainer;
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
    if (!CSVProgressElement) {
      CSVProgressElement = require("./csv-progress-element");
    }

    this.progress = new CSVProgressElement();
    this.appendChild(this.progress);
  }

  hideProgress() {
    this.cancelProgressUpdate();
    if (this.progress && this.progress.parentNode) {
      this.removeChild(this.progress);
    }
    delete this.progress;
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
}

module.exports = DelimitedTextEditorElement.initClass();
