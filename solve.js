// A faster drop-in for csv-reader 1.0.0: identical answers, less CPU.
//
// The reference reads one character at a time and builds every field by
// string concatenation. Most records hold no quotes, so this reader works
// a record at a time instead: a quote-free stretch up to the next line
// break is sliced and split(',') in one go (V8's split is native code),
// and only records with quotes take the field loop. Quoted fields are
// found with indexOf and only their content is scanned character by
// character (for the line count and the CR -> LF rewrite). Broken-row
// handling follows csv-reader 1.0.0 exactly: BOM dropped, empty lines are
// no records, a CR outside quotes that is not part of CRLF is dropped
// (stray_cr), a quote that never closes is literal and the text after it
// is re-read unquoted (unterminated_quote), text after a closing quote up
// to the next comma or line break is appended as it stands (quote_junk),
// rows are padded (short_row) or cut (long_row) to the first record's
// width, and every error carries the line its record starts on and its
// index in rows (null for the header).
//
// Pure: no clock, no randomness, no locale, nothing kept from one call
// to the next. Dependency-free ES module.

/** How a field ended: 0 at a comma, 1 at a line break, 2 at the end. */
const COMMA = 0;
const LINE = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input: {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows
  // it takes (null: the header). Shared by the helpers below.
  let recordLine = 1;
  let recordRow = null;

  // Reads unquoted characters onto `value` up to the next comma or line
  // break: a CR not followed by LF is dropped (stray_cr). Returns the
  // field and how it ended.
  function readUnquoted(value) {
    let start = pos;
    for (;;) {
      const iC = text.indexOf(',', pos);
      const iN = text.indexOf('\n', pos);
      const iR = text.indexOf('\r', pos);
      let m = -1;
      let kind = -1;
      if (iC !== -1) { m = iC; kind = COMMA; }
      if (iN !== -1 && (m === -1 || iN < m)) { m = iN; kind = LINE; }
      if (iR !== -1 && (m === -1 || iR < m)) { m = iR; kind = -2; }
      if (m === -1) {
        value += text.slice(start, n);
        pos = n;
        return { value, ended: END };
      }
      if (kind === COMMA) {
        value += text.slice(start, m);
        pos = m + 1;
        return { value, ended: COMMA };
      }
      if (kind === LINE) {
        value += text.slice(start, m);
        pos = m + 1;
        line += 1;
        return { value, ended: LINE };
      }
      // A CR: a line break when followed by LF, else dropped (stray_cr).
      if (text.charCodeAt(m + 1) === 10) {
        value += text.slice(start, m);
        pos = m + 2;
        line += 1;
        return { value, ended: LINE };
      }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      value += text.slice(start, m);
      pos = m + 1;
      start = pos;
    }
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let segs = null; // pieces before each doubled quote, if any
    let start = open + 1;
    let q = text.indexOf('"', start);
    while (q !== -1 && text.charCodeAt(q + 1) === 34) {
      (segs ??= []).push(text.slice(start, q));
      start = q + 2;
      q = text.indexOf('"', start);
    }
    if (q === -1) {
      // The quote never closes: it is a literal character, and the text
      // after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return readUnquoted('"');
    }
    // Every LF, CRLF and lone CR inside the quotes counts as one line.
    for (let i = open + 1; i < q; i++) {
      const cc = text.charCodeAt(i);
      if (cc === 10) line += 1;
      else if (cc === 13 && text.charCodeAt(i + 1) !== 10) line += 1;
    }
    let raw;
    if (segs === null) raw = text.slice(open + 1, q);
    else {
      segs.push(text.slice(start, q));
      raw = segs.join('"');
    }
    // Each CRLF or lone CR inside quotes is read as one LF.
    const value = raw.indexOf('\r') === -1 ? raw : raw.replace(/\r\n?/g, '\n');
    pos = q + 1;
    if (pos >= n) return { value, ended: END };
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      return { value, ended: COMMA };
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      return { value, ended: LINE };
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return { value, ended: LINE };
    }
    // What follows the closing quote is appended as it stands, up to
    // the next comma or line break.
    const before = value.length;
    const junk = readUnquoted(value);
    if (junk.value.length - before > 0) {
      errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    }
    return junk;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false; // whether the last field read was quoted
    let ended = COMMA;
    while (true) {
      if (pos >= n) {
        fields.push('');
        ended = END;
        break;
      }
      const c = text.charCodeAt(pos);
      if (c === 34) {
        quoted = true;
        const f = readQuoted();
        fields.push(f.value);
        ended = f.ended;
      } else if (c === 44) {
        quoted = false;
        fields.push('');
        pos += 1;
        ended = COMMA;
      } else if (c === 10) {
        quoted = false;
        fields.push('');
        pos += 1;
        line += 1;
        ended = LINE;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        quoted = false;
        fields.push('');
        pos += 2;
        line += 1;
        ended = LINE;
      } else {
        // An unquoted run: everything up to the next line break. When
        // it holds no quote and no stray CR it is whole fields at once.
        quoted = false;
        const idxN = text.indexOf('\n', pos);
        const segEnd = idxN === -1 ? n : idxN;
        const seg = text.slice(pos, segEnd);
        const q = seg.indexOf('"');
        const r = seg.indexOf('\r');
        const crlf = idxN !== -1 && r === seg.length - 1;
        if (q === -1 && (r === -1 || crlf)) {
          const end = crlf ? segEnd - 1 : segEnd;
          const parts = text.slice(pos, end).split(',');
          for (let i = 0; i < parts.length; i++) fields.push(parts[i]);
          pos = idxN === -1 ? n : idxN + 1;
          if (idxN !== -1) line += 1;
          ended = idxN === -1 ? END : LINE;
        } else if (q !== -1 && seg.charCodeAt(q - 1) === 44 && (r === -1 || r > q)) {
          // A quote that opens a field after a comma: the fields before
          // it are whole, and the quoted field follows.
          const parts = text.slice(pos, pos + q).split(',');
          parts.pop(); // the empty piece before the opening quote
          for (let i = 0; i < parts.length; i++) fields.push(parts[i]);
          pos = pos + q;
          ended = COMMA;
        } else {
          // A stray CR, or a quote in the middle of an unquoted field
          // (a literal character there): one field the careful way.
          const f = readUnquoted('');
          fields.push(f.value);
          ended = f.ended;
        }
      }
      if (ended !== COMMA) break;
    }

    // A line that held only stray CRs is left with no characters: no
    // record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
