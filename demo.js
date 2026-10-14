// Authentic package usage. Run with lumine/script/demo.js; fixtures stay in demo/.
module.exports = {
  version: 1,
  dependencies: [],
  viewport: { width: 1200, height: 760 },
  async before() {},
  async prepare(context) {
    const { lumine, state, fixture, open } = context;
    state.editor = await open("data/notes.txt");
    await lumine.project.setPaths([fixture("data")]);
  },
  scenes: [
    {
      id: "scene-1",
      file: "demo.png",
      caption: "Explore sampled signal data as a spreadsheet.",
      timeout: 60000,
      async run(context) {
        const { lumine, state, fixture } = context;
        {
          state.document = await lumine.workspace.open(
            fixture("data/samples.csv"),
          );
          await lumine.workspace
            .paneForItem(state.editor)
            .destroyItem(state.editor, true);
          document
            .querySelector("table-editor-delimited-text")
            ?.form?.openTableEditorButton.click();
        }
      },
      ready() {
        return Boolean(document.querySelector("table-editor"));
      },
    },
  ],
  async cleanup() {},
};
