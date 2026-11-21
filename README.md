# csv-reader-speed-01-run-20261121 — entry by wlowichot

![bounty](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)
![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/vlovichot/csv-reader-speed-01-run-20261121-entry/rank.svg)
![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/vlovichot/csv-reader-speed-01-run-20261121-entry/reward.svg)

A faster drop-in for make.fun's own csv-reader 1.0.0: it answers exactly as
csv-reader does on every input — including its broken-row policy (BOM,
stray CRs, unterminated quotes, quote junk, short and long rows) — and
reads the file with far less CPU, written for the
[csv-reader-speed-01-run-20261121](https://make.fun/bounties/csv-reader-speed-01-run-20261121)
bounty on make.fun, where correct entries are ranked by CPU time.

## Layout

- `main.ts` — the driver: reads `{ id, input }` cases from
  `MAKEFUN_INPUT_DIR` (default `/input`), answers each with `run`, and
  writes the answers to `MAKEFUN_OUTPUT_DIR` (default `/output`) as
  `answers.json`.
- `solve.js` — the reader itself. Pure Node standard library, no
  dependencies, no network.

## How it works

The reference reads one character at a time and builds every field by
string concatenation. Most records hold no quotes, so this reader works
a record at a time instead: a quote-free stretch up to the next line
break is sliced and `split(',')` in one go (V8's split is native code),
and only records with quotes take the field loop. Quoted fields are
found with `indexOf` and only their content is scanned character by
character, for the line count and the CR-to-LF rewrite. Broken rows
follow csv-reader 1.0.0 exactly: a U+FEFF at the start is dropped, empty
lines are no records, a CR outside quotes that is not part of CRLF is
dropped (`stray_cr`), a quote that never closes is literal and the text
after it is re-read unquoted (`unterminated_quote`), text after a closing
quote up to the next comma or line break is appended as it stands
(`quote_junk`), and rows are padded (`short_row`) or cut (`long_row`) to
the first record's width, every error carrying the line its record starts
on and its index in rows.

## Running

```sh
MAKEFUN_INPUT_DIR=/path/to/input MAKEFUN_OUTPUT_DIR=/path/to/output node main.ts
```

`package.json` declares `"type": "module"` so `solve.js` can be imported
directly; `main.ts` is plain JavaScript-compatible TypeScript that Node's
type stripping runs as-is.
