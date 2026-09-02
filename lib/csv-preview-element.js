"use strict";

const columnName = require("./column-name");
const element = require("./decorators/element");
const cell = (tag, content, parent) => {
  const node = document.createElement(tag);
  node.textContent = content;
  parent.appendChild(node);
};

class CSVPreviewElement extends HTMLElement {
  static initClass() {
    return element(this, "table-editor-preview");
  }

  clean() {
    this.replaceChildren();
    const spinner = document.createElement("span");
    spinner.className = "loading loading-spinner-medium inline-block";
    this.appendChild(spinner);
  }

  error(reason) {
    this.replaceChildren();
    const alert = document.createElement("span");
    alert.className = "alert alert-danger";
    alert.textContent = reason.message;
    this.appendChild(alert);
  }

  render(preview, options = {}) {
    if (preview.length === 0) {
      return;
    }

    preview = preview.map((row) => row.slice());
    const length = preview.reduce((m, n) => Math.max(m, n.length), 0);
    const columns = options.header
      ? preview.shift()
      : new Array(length).fill().map((v, i) => columnName(i));

    const table = document.createElement("table");
    const header = document.createElement("thead");
    const body = document.createElement("tbody");
    const headerRow = document.createElement("tr");

    cell("th", "#", headerRow);

    columns.forEach((column) => cell("th", column, headerRow));
    preview.forEach((row, r) => {
      const rowElement = document.createElement("tr");

      cell("td", r + 1, rowElement);

      columns.forEach((c, i) => cell("td", row[i], rowElement));
      body.appendChild(rowElement);
    });

    header.appendChild(headerRow);
    table.appendChild(header);
    table.appendChild(body);

    const wrapper = document.createElement("div");
    wrapper.classList.add("table-wrapper");
    wrapper.appendChild(table);

    this.innerHTML = "";
    this.appendChild(wrapper);
  }
}

module.exports = CSVPreviewElement.initClass();
