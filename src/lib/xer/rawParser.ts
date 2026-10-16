/**
 * Low-level XER reader. XER is a tab-delimited text export from Primavera P6:
 *   ERMHDR <version> <export date> ...      (header line)
 *   %T <TABLE>                              (start of a table)
 *   %F <field> <field> ...                  (field names)
 *   %R <value> <value> ...                  (one row)
 *   %E                                      (end of file)
 */

export interface RawTable {
  name: string;
  fields: string[];
  rows: Record<string, string>[];
}

export interface RawXer {
  header: string[];
  tables: Map<string, RawTable>;
  /** Order in which tables appeared */
  tableOrder: string[];
  errors: string[];
  warnings: string[];
  encoding: 'utf-8' | 'windows-1252';
  hasEndMarker: boolean;
}

/** Decode XER bytes. P6 writes windows-1252 by default; UTF-8 is accepted when valid. */
export function decodeXer(input: ArrayBuffer | Uint8Array | string): { text: string; encoding: RawXer['encoding'] } {
  if (typeof input === 'string') return { text: input, encoding: 'utf-8' };
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let start = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  const body = bytes.subarray(start);
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
    return { text, encoding: 'utf-8' };
  } catch {
    return { text: decodeWindows1252(body), encoding: 'windows-1252' };
  }
}

/** windows-1252 code points for bytes 0x80–0x9F (undefined bytes map to themselves). */
const CP1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8d, 0x017d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178,
];

/** Explicit windows-1252 decoder (Node's TextDecoder treats this label as Latin-1). */
export function decodeWindows1252(bytes: Uint8Array): string {
  let out = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const codes: number[] = [];
    const end = Math.min(bytes.length, i + CHUNK);
    for (let j = i; j < end; j++) {
      const b = bytes[j];
      codes.push(b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80] : b);
    }
    out += String.fromCharCode(...codes);
  }
  return out;
}

export function parseRawXer(input: ArrayBuffer | Uint8Array | string): RawXer {
  const { text, encoding } = decodeXer(input);
  const result: RawXer = {
    header: [],
    tables: new Map(),
    tableOrder: [],
    errors: [],
    warnings: [],
    encoding,
    hasEndMarker: false,
  };
  const lines = text.split(/\r\n|\n|\r/);
  let current: RawTable | null = null;
  let sawHeader = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const cells = line.split('\t');
    const tag = cells[0];
    if (!sawHeader) {
      if (tag !== 'ERMHDR') {
        result.errors.push('Not a Primavera XER file: the first line must start with "ERMHDR".');
        return result;
      }
      sawHeader = true;
      result.header = cells.slice(1);
      continue;
    }
    switch (tag) {
      case '%T': {
        const name = (cells[1] ?? '').trim();
        if (!name) {
          result.warnings.push(`Line ${i + 1}: table marker without a name was ignored.`);
          current = null;
          break;
        }
        current = { name, fields: [], rows: [] };
        if (result.tables.has(name)) {
          result.warnings.push(`Table ${name} appears more than once; rows were merged.`);
          current = result.tables.get(name)!;
        } else {
          result.tables.set(name, current);
          result.tableOrder.push(name);
        }
        break;
      }
      case '%F': {
        if (!current) {
          result.warnings.push(`Line ${i + 1}: field list outside a table was ignored.`);
          break;
        }
        const fields = cells.slice(1).map((f) => f.trim());
        if (current.fields.length === 0) current.fields = fields;
        break;
      }
      case '%R': {
        if (!current || current.fields.length === 0) {
          result.warnings.push(`Line ${i + 1}: row outside a table (or before its field list) was ignored.`);
          break;
        }
        const values = cells.slice(1);
        if (values.length > current.fields.length) {
          // Extra trailing tabs are common; only warn if they carry data.
          if (values.slice(current.fields.length).some((v) => v.trim() !== '')) {
            result.warnings.push(`Line ${i + 1}: ${current.name} row has more values than fields; extras ignored.`);
          }
        }
        const row: Record<string, string> = {};
        current.fields.forEach((f, idx) => {
          row[f] = (values[idx] ?? '').trim();
        });
        current.rows.push(row);
        break;
      }
      case '%E':
        result.hasEndMarker = true;
        current = null;
        break;
      default:
        result.warnings.push(`Line ${i + 1}: unrecognised line ignored.`);
    }
  }
  if (!sawHeader) result.errors.push('File is empty.');
  else if (!result.hasEndMarker) result.warnings.push('File has no %E end marker; it may be truncated.');
  return result;
}
