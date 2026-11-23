import {
  attr,
  child,
  children,
  escapeText,
  parseXml,
  readZipParts,
  relationshipId,
  renderTable,
  tableCell,
  type XmlElement,
} from './ooxml';

/**
 * Converts an Excel (.xlsx) workbook into Markdown: one section per sheet in
 * workbook order, each a Markdown table whose first row is the header. Cells
 * show their stored values: a formula shows its last cached result (or the
 * formula when none was saved), and a date-formatted number shows as an ISO
 * date. Other number formats are not applied.
 */

const WORKBOOK_PART = 'xl/workbook.xml';
const WORKBOOK_RELS_PART = 'xl/_rels/workbook.xml.rels';
const SHARED_STRINGS_PART = 'xl/sharedStrings.xml';
const STYLES_PART = 'xl/styles.xml';
const WORKSHEET_PATTERN = /^xl\/worksheets\/[^/]+\.xml$/;
/** Rows kept per sheet. Larger sheets are cut and say how many rows were left out. */
export const XLSX_MAX_ROWS_PER_SHEET = 500;
/** Columns kept per sheet (A to CV). Cells further right are counted, not shown. */
const MAX_COLUMNS = 100;

/** Text of a shared or inline string, without phonetic (`rPh`) runs. */
const stringText = (element: XmlElement): string => {
  let text = '';
  for (const node of children(element)) {
    if (node.localName === 't') text += node.textContent ?? '';
    else if (node.localName === 'r') text += stringText(node);
  }
  return text;
};

const readSharedStrings = (source: string | undefined): string[] => {
  const doc = parseXml(source);
  return doc ? children(doc, 'si').map(stringText) : [];
};

/** Built-in number formats that show dates or times (ECMA-376 18.8.30). */
const BUILT_IN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
/** Day zero of the 1900 and 1904 date systems (`workbookPr date1904`). */
const EPOCH_1900_MS = Date.UTC(1899, 11, 30);
const EPOCH_1904_MS = Date.UTC(1904, 0, 1);
const DAY_MS = 86_400_000;

/** Style index -> true when the cell format shows a date or time. */
const readDateStyles = (source: string | undefined): boolean[] => {
  const styles = parseXml(source);
  if (!styles) return [];
  const customDate = new Set<number>();
  for (const format of children(child(styles, 'numFmts') ?? styles, 'numFmt')) {
    // Strip quoted text and colors such as [Red] before looking for date codes.
    const code = (attr(format, 'formatCode') ?? '').replace(/"[^"]*"|\[[^\]]*\]/g, '');
    if (/[ymdhs]/i.test(code)) customDate.add(Number(attr(format, 'numFmtId')));
  }
  return children(child(styles, 'cellXfs') ?? styles, 'xf').map((xf) => {
    const id = Number(attr(xf, 'numFmtId') ?? '0');
    return BUILT_IN_DATE_FORMATS.has(id) || customDate.has(id);
  });
};

/** Excel serial date -> `2026-11-20` or `2026-11-20 09:30`. */
const formatSerialDate = (serial: number, epochMs: number): string => {
  const iso = new Date(epochMs + Math.round(serial * DAY_MS / 60_000) * 60_000).toISOString();
  return Number.isInteger(serial) ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
};

/** `B12` -> 1 (zero-based column index). */
const columnIndex = (ref: string): number => {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? '';
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
};

interface WorkbookContext {
  sharedStrings: string[];
  dateStyles: boolean[];
  epochMs: number;
}

const cellValue = (cell: XmlElement, ctx: WorkbookContext): string => {
  const type = attr(cell, 't');
  const value = child(cell, 'v')?.textContent ?? '';
  if (!value && type !== 'inlineStr') {
    // Some writers save a formula without its result.
    const formula = child(cell, 'f')?.textContent;
    return formula ? `=${formula}` : '';
  }
  switch (type) {
    case 's': return ctx.sharedStrings[Number(value)] ?? '';
    case 'inlineStr': {
      const inline = child(cell, 'is');
      return inline ? stringText(inline) : '';
    }
    case 'b': return value === '1' ? 'TRUE' : 'FALSE';
    case 'str':
    case 'e':
      return value;
    default: {
      const serial = Number(value);
      const isDate = ctx.dateStyles[Number(attr(cell, 's') ?? '0')] && Number.isFinite(serial) && serial >= 0;
      return isDate ? formatSerialDate(serial, ctx.epochMs) : value;
    }
  }
};

interface SheetRows {
  rows: string[][];
  omittedRows: number;
  omittedCells: number;
}

const readSheetRows = (source: string | undefined, ctx: WorkbookContext): SheetRows => {
  const doc = parseXml(source);
  const data = doc ? child(doc, 'sheetData') : undefined;
  const rows: string[][] = [];
  let omittedRows = 0;
  let omittedCells = 0;
  for (const row of data ? children(data, 'row') : []) {
    const cells: string[] = [];
    let cutCells = 0;
    children(row, 'c').forEach((cell, position) => {
      const ref = attr(cell, 'r');
      const index = ref ? columnIndex(ref) : position;
      const value = tableCell(cellValue(cell, ctx));
      if (index < 0 || index >= MAX_COLUMNS) {
        if (value) cutCells += 1;
        return;
      }
      cells[index] = value;
    });
    const filled = Array.from(cells, (cell) => cell ?? '');
    if (!filled.some(Boolean) && cutCells === 0) continue;
    if (rows.length >= XLSX_MAX_ROWS_PER_SHEET) {
      omittedRows += 1;
    } else {
      rows.push(filled);
      omittedCells += cutCells;
    }
  }
  return { rows, omittedRows, omittedCells };
};

/** Drops columns that are empty in every kept row. */
const dropEmptyColumns = (rows: string[][]): string[][] => {
  const width = Math.max(0, ...rows.map((row) => row.length));
  const keep = Array.from({ length: width }, (_, column) => rows.some((row) => row[column]));
  return rows.map((row) => keep.flatMap((kept, column) => (kept ? [row[column] ?? ''] : [])));
};

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

const resolveSheetPart = (target: string): string => (
  target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
);

/** Converts the bytes of a .xlsx file to Markdown. Throws when the file is not
 *  a readable Excel workbook. */
export const xlsxToMarkdown = (bytes: Uint8Array): string => {
  const files = readZipParts(bytes, (name) => (
    name === WORKBOOK_PART
    || name === WORKBOOK_RELS_PART
    || name === SHARED_STRINGS_PART
    || name === STYLES_PART
    || WORKSHEET_PATTERN.test(name)
  ));
  const workbook = parseXml(files.get(WORKBOOK_PART));
  const sheets = workbook ? child(workbook, 'sheets') : undefined;
  if (!sheets) throw new Error('Not an Excel workbook');

  const rels = parseXml(files.get(WORKBOOK_RELS_PART));
  const targets = new Map<string, string>();
  for (const rel of rels ? children(rels, 'Relationship') : []) {
    const id = attr(rel, 'Id');
    const target = attr(rel, 'Target');
    if (id && target) targets.set(id, resolveSheetPart(target));
  }
  const date1904 = attr(child(workbook ?? undefined, 'workbookPr'), 'date1904');
  const ctx: WorkbookContext = {
    sharedStrings: readSharedStrings(files.get(SHARED_STRINGS_PART)),
    dateStyles: readDateStyles(files.get(STYLES_PART)),
    epochMs: date1904 === '1' || date1904 === 'true' ? EPOCH_1904_MS : EPOCH_1900_MS,
  };

  return children(sheets, 'sheet').map((sheet) => {
    const heading = `## Sheet: ${escapeText(attr(sheet, 'name') ?? '')}`;
    const part = targets.get(relationshipId(sheet) ?? '');
    const { rows, omittedRows, omittedCells } = readSheetRows(part ? files.get(part) : undefined, ctx);
    if (rows.length === 0) return `${heading}\n\n(empty)`;
    const parts = [heading, renderTable(dropEmptyColumns(rows))];
    if (omittedRows > 0) parts.push(`(${plural(omittedRows, 'more row')} not shown)`);
    if (omittedCells > 0) parts.push(`(${plural(omittedCells, 'cell')} right of column CV not shown)`);
    return parts.filter(Boolean).join('\n\n');
  }).join('\n\n');
};
