Reusable models for two-dimensional data and delimited-text files.

| Field       | Value                                              |
| ----------- | -------------------------------------------------- |
| Version     | `1.0.0`                                            |
| Provided by | `table-editor`                                     |
| Consumed by | Packages embedding or constructing editable tables |
| Owner       | `table-editor`                                     |

## Registration

Consume `table-editor` at `^1.0.0`. The provider returns constructors rather than shared instances, so each consumer owns and disposes what it creates.

## Contract

Required exports:

| Export                | Role                                                                           |
| --------------------- | ------------------------------------------------------------------------------ |
| `Table`               | Stores columns and rows, transactions, history, and modified state.            |
| `DisplayTable`        | Maps a table into screen rows and columns with sort and layout state.          |
| `TableEditor`         | Adds cursors, rectangular selections, clipboard operations, and edit commands. |
| `Range`               | Represents a half-open rectangular range of cells.                             |
| `DelimitedTextEditor` | Opens, watches, serializes, and saves a delimited-text pane item.              |

Optional exports: none.

## Minimal example

```js
consumeTableEditor({ Table, TableEditor }) {
  const table = new Table({ columns: ["name", "value"], rows: [["answer", "42"]] });
  const editor = new TableEditor({ table });
  return () => editor.destroy();
}
```

## Behavior

`Table` mutations executed in a transaction form one undo step. `DisplayTable` owns presentation state and never changes stored row order until `applySort()` is called. `TableEditor` selections use half-open `Range` bounds. `TableEditor` and `DelimitedTextEditor` are center-only pane items; `DelimitedTextEditor` implements the Lumine save, serialization, and `FileState` contracts.

Column presentation options accept `formatCell(value, row, rowIndex)`, which returns plain text, and `paintCell(context, details)`, which draws synchronously inside a clipped Canvas cell. `details` contains `rect`, `value`, `text`, `record`, `row`, `windowRow`, `column`, and `columnDefinition`. HTML renderers are not supported.

## Teardown

Call `destroy()` on editors and display tables. A `DelimitedTextEditor` releases its shared document reference; the final reference disposes the file watcher and pending streams.

## Versioning

Additive exports and methods may be introduced in a compatible service version. Removing exports, changing range semantics, changing serialized state, or changing event payloads requires a new major service version.
