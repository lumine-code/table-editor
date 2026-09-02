# table-editor

Edit CSV and TSV files in a structured grid.

Table Editor opens delimited text through a preview where the delimiter, encoding, quoting, header, and whitespace rules can be checked before the file becomes an editable table. Parsed data is held in memory while only visible rows and columns are rendered.

## Features

- **Delimited text**: opens CSV, TSV, and configured extensions with a parsing preview.
- **Table editing**: edits cells and inserts, removes, resizes, reorders, and aligns rows and columns.
- **Selections**: supports rectangular and multiple selections with copy, cut, and paste.
- **History**: groups table operations into undoable transactions and tracks the saved revision.
- **Large tables**: parses streams incrementally and virtualizes both table axes.
- **Safe files**: preserves encoding and delimiters, detects external conflicts, and replaces files atomically.
- **Reusable models**: exposes the table model, display model, editor model, ranges, and file editor as a service.

## Installation

To install `table-editor` search for it in the Install pane of the Lumine settings, or run the command `lumine --install lumine-code/table-editor`.

## Commands

Commands available in `lumine-workspace`:

- `table-editor:open-as-table`: open the active saved text file as a table,
- `table-editor:open-as-text`: open the active table as ordinary text,
- `table-editor:clear-file-choice`: forget the remembered opening mode,
- `table-editor:clear-file-layout`: forget saved column widths and row heights,
- `table-editor:clear-file-settings`: forget every per-file choice and layout.

Commands available in `table-editor`:

- `table-editor:go-to-cell`: move the cursor to a specified row and column,
- `table-editor:insert-row-before`: insert an empty row before the selection,
- `table-editor:insert-row-after`: insert an empty row after the selection,
- `table-editor:delete-row`: delete rows touched by the selection,
- `table-editor:insert-column-before`: insert an empty column before the selection,
- `table-editor:insert-column-after`: insert an empty column after the selection,
- `table-editor:delete-column`: delete columns touched by the selection,
- `table-editor:move-row-up`: move selected rows toward the start,
- `table-editor:move-row-down`: move selected rows toward the end,
- `table-editor:move-column-left`: move selected columns toward the start,
- `table-editor:move-column-right`: move selected columns toward the end,
- `table-editor:apply-sort`: make the displayed sort order the stored row order,
- `table-editor:fit-column-to-content`: resize the active column to its contents,
- `table-editor:fit-row-to-content`: resize the active row to its contents.

## Usage

Opening an unremembered file shows a preview. Choose the parsing rules and whether the file should open as text or as a table; the choice can be remembered for that path. Saving preserves the selected encoding, byte-order mark, field delimiter, record delimiter, and final-newline policy. The serializer may normalize redundant quoting. Enabling comment removal or empty-record skipping deliberately omits that ignored syntax from the saved file and is called out in the preview.

## Customization

The table can be adjusted from `styles.css` through its root element and Lumine theme variables:

```css
table-editor {
  --table-editor-row-height: 28px;
  --table-editor-grid-color: var(--base-border-color);
}
```

## Services

- [`table-editor`](docs/table-editor.md): provided to packages that need reusable table models or a delimited-text pane item.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
