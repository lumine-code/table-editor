const fs = require("fs");
const path = require("path");

function rgb(color) {
  const context = document.createElement("canvas").getContext("2d");
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
}

describe("Table Editor cell-input CSS roles", () => {
  let stylesheet, table, editor, element;
  beforeEach(() => {
    stylesheet = lumine.styles.addStyleSheet(
      fs.readFileSync(path.join(__dirname, "../styles/main.css"), "utf8"),
      { priority: 1000 },
    );
    table = document.createElement("table-editor");
    for (const [name, value] of Object.entries({
      "base-border-color": "rgb(240, 240, 240)",
      "base-background-color": "rgb(255, 255, 255)",
      "background-color-info": "rgb(200, 0, 0)",
      "accent-indicator-color": "rgb(10, 20, 30)",
      "accent-background-color": "rgb(40, 50, 60)",
      "accent-foreground-color": "rgb(220, 230, 240)",
    }))
      table.style.setProperty(`--${name}`, value);
    editor = lumine.workspace.buildTextEditor({ mini: true });
    element = lumine.views.getView(editor);
    element.dataset.row = "1";
    element.dataset.column = "2";
    table.appendChild(element);
    jasmine.attachToDOM(table);
  });
  afterEach(() => {
    editor.destroy();
    stylesheet.dispose();
  });

  it("uses the accent pair rather than a diagnostic hue for the focused cell label", () => {
    element.classList.add("is-focused");
    expect(getComputedStyle(element).borderTopColor).toBe("rgb(10, 20, 30)");
    const label = getComputedStyle(element, "::before");
    expect(label.backgroundColor).toBe("rgb(40, 50, 60)");
    expect(label.color).toBe("rgb(220, 230, 240)");
  });

  it("keeps an unfocused coordinate label readable on both light and dark fills", () => {
    expect(rgb(getComputedStyle(element, "::before").color)).toEqual([0, 0, 0]);
    table.style.setProperty("--base-border-color", "rgb(20, 20, 20)");
    expect(rgb(getComputedStyle(element, "::before").color)).toEqual([
      255, 255, 255,
    ]);
  });
});
