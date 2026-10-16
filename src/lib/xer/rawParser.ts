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
    return { text: new TextDecoder('windows-1252').decode(body), encoding: 'windows-1252' };
  }
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
