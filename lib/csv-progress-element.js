"use strict";

const registerElement = require("./register-element");

const BYTE_UNITS = ["B", "kB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

class CSVProgressElement extends HTMLElement {
  constructor() {
    super();
  }

  initialize() {
    if (this.elementInitialized) return this;
    this.elementInitialized = true;
    const wrapper = document.createElement("div");
    wrapper.className = "wrapper";
    this.bytesLabel = document.createElement("label");
    this.bytesLabel.className = "bytes";
    this.bytesLabel.textContent = "---";
    this.linesLabel = document.createElement("label");
    this.linesLabel.className = "lines";
    this.linesLabel.textContent = "---";
    const block = document.createElement("div");
    block.className = "block";
    this.progress = document.createElement("progress");
    this.progress.max = 100;
    block.appendChild(this.progress);
    wrapper.append(this.bytesLabel, this.linesLabel, block);
    this.appendChild(wrapper);
    return this;
  }

  connectedCallback() {
    this.initialize();
  }

  updateReadData(input, lines) {
    this.initialize();
    const { total, length, ratio } = input.getProgress();
    const byteScale = this.getByteScale(total);
    const byteDivider = Math.max(1, Math.pow(1000, byteScale));
    const unit = this.getUnit(byteScale);

    this.linesLabel.textContent = `${lines} ${lines === 1 ? "record" : "records"}`;
    this.bytesLabel.textContent = `${(length / byteDivider).toFixed(1)}/${(total / byteDivider).toFixed(1)}${unit}`;
    this.progress.setAttribute("value", Math.floor(ratio * 100));
  }

  getByteScale(size) {
    let i = 0;

    while (size > 1000) {
      size = size / 1000;
      i++;
    }

    return i;
  }

  getUnit(scale) {
    return BYTE_UNITS[scale];
  }

  updateFillTable(lines, ratio) {
    this.initialize();
    this.linesLabel.textContent = `${lines} ${lines === 1 ? "row" : "rows"} added`;
    this.bytesLabel.textContent = "";
    this.progress.setAttribute("value", Math.floor(ratio * 100));
  }
}

module.exports = registerElement("table-editor-progress", CSVProgressElement);
