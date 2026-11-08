const Table = require("../lib/table");
const TableEditor = require("../lib/table-editor");
const TableGridAdapter = require("../lib/table-grid-adapter");

describe("Table grid navigation activity", () => {
  let host, model, adapter;
  afterEach(() => {
    adapter?.destroy();
    model?.destroy();
    host?.remove();
  });

  it("reveals the actual scrollport for handled movement and explicit reveal without focus activity", () => {
    host = document.createElement("div");
    jasmine.attachToDOM(host);
    model = new TableEditor({
      table: new Table({ columns: ["value"], rows: [["row"]] }),
    });
    const reveal = spyOn(lumine.scrollbars, "reveal");
    adapter = new TableGridAdapter({ host, model });
    adapter.focus();
    expect(reveal).not.toHaveBeenCalled();
    adapter.moveActiveSelection(1, 0);
    expect(reveal).toHaveBeenCalledOnceWith(adapter.grid.scrollElement);
    reveal.calls.reset();
    adapter.scrollCellIntoView(0, 0);
    expect(reveal).toHaveBeenCalledOnceWith(adapter.grid.scrollElement);
  });
});
