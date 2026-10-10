/**
 * Legacy backup file formats (see README.md for the full description) and their parser.
 *
 * 1. `bkp-v1` — one firm per file, written by `bkpRun` (index.html 8979) as a claude.ai asset and downloaded with
 *    "⬇ Последната копија (ZIP)" (`bkZip`, 9013) as `<firm>_<fid>.json` inside a stored ZIP:
 *      `{ v: 1, at: ISO, firm: {…without logo/sign/stamp}, data: { <14 COLS>: [docs] } }`
 * 2. `firm-json` — "⬇ Само оваа фирма (JSON)" (`backupJson`, 5060):
 *      `{ firm: {…incl. logo/sign/stamp}, exported: ISO, data: { <COLS>: [docs] } }`
 * 3. `full-export` — optional office-wide export (users and office settings are in no legacy backup; see
 *    README "Корисници"): `{ kind: 'wise-legacy-export', v: 1, at, users|appusers: [...], settings: {path: doc},
 *    firms: [{ firm, data }] }`.
 * 4. The backup index document `backups/{bk-…}` (`{ files: [...], glob: {...} }`) carries only the office settings
 *    `appsettings/schemes`, `appsettings/fx`, `settings/pay` — accepted for those.
 *
 * Every per-firm collection is an array of plain documents with a string `id` (Firestore-like `S.db`).
 */
import { isZip, readZip } from './zip';

/** Legacy `COLS` (index.html 3200): the 14 per-firm collections. */
export const LEGACY_COLS = [
  'codes', 'employees', 'partners', 'items', 'invoices', 'purchases', 'bank', 'sales', 'journal', 'payroll', 'moves',
  'production', 'assets', 'docs',
] as const;
export type LegacyCol = (typeof LEGACY_COLS)[number];

/** A legacy document: free-form JSON with a string id. Field access is defensive everywhere (data is user-typed). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LDoc = Record<string, any> & { id: string };
export type LegacyData = Record<LegacyCol, LDoc[]>;

export type BackupFormat = 'bkp-v1' | 'firm-json' | 'full-export';

export interface LegacyFirmBackup {
  /** Firm record `firms/{fid}`; `id` is the legacy firm id. */
  firm: LDoc;
  data: LegacyData;
  /** When the backup was taken (`at` / `exported`), ISO; null when unknown. */
  at: string | null;
  format: BackupFormat;
  /** File (and ZIP entry) it came from. */
  source: string;
}

/** Legacy `appusers/{id}`. */
export interface LegacyUser {
  id: string; name?: string; username?: string; email?: string; role?: string; firms?: string[]; active?: boolean;
  salt?: string; hash?: string; kp?: { out?: boolean; in?: boolean };
  [k: string]: unknown;
}

export interface LegacyBundle {
  firms: LegacyFirmBackup[];
  users: LegacyUser[];
  /** Office-wide documents by legacy path: `appsettings/schemes`, `appsettings/fx`, `settings/pay`, `appsettings/office`, … */
  glob: Record<string, unknown>;
  warnings: string[];
}

export class BackupFormatError extends Error {
  constructor(m: string) { super(m); this.name = 'BackupFormatError'; }
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** Normalise `data`: the 14 collections as arrays of docs with string ids; unknown keys reported. */
export function normaliseData(raw: unknown, where: string, warnings: string[]): LegacyData {
  const src = isObj(raw) ? raw : {};
  const out = {} as LegacyData;
  for (const c of LEGACY_COLS) {
    const arr = Array.isArray(src[c]) ? (src[c] as unknown[]) : [];
    const seen = new Set<string>();
    out[c] = [];
    for (const d of arr) {
      if (!isObj(d)) continue;
      const id = d.id == null ? '' : String(d.id);
      if (!id) { warnings.push(`${where}: запис без id во „${c}“ – прескокнат.`); continue; }
      if (seen.has(id)) { warnings.push(`${where}: двоен id „${id}“ во „${c}“ – задржан е првиот.`); continue; }
      seen.add(id);
      out[c].push({ ...d, id } as LDoc);
    }
  }
  for (const k of Object.keys(src)) {
    if (!(LEGACY_COLS as readonly string[]).includes(k)) warnings.push(`${where}: непозната збирка „${k}“ – игнорирана.`);
  }
  return out;
}

function firmBackup(o: Record<string, unknown>, format: BackupFormat, source: string, warnings: string[]): LegacyFirmBackup {
  const firm = o.firm;
  if (!isObj(firm) || firm.id == null || !String(firm.id)) throw new BackupFormatError(`${source}: фирмата нема id.`);
  const at = typeof o.at === 'string' ? o.at : typeof o.exported === 'string' ? o.exported : null;
  return {
    firm: { ...firm, id: String(firm.id) } as LDoc,
    data: normaliseData(o.data, `${source} (${String(firm.name ?? firm.id)})`, warnings),
    at, format, source,
  };
}

/** Parse one parsed JSON value into a bundle (any of the four shapes, or an array of them). */
export function parseBackupJson(j: unknown, source: string): LegacyBundle {
  const B: LegacyBundle = { firms: [], users: [], glob: {}, warnings: [] };
  const take = (o: unknown) => {
    if (!isObj(o)) throw new BackupFormatError(`${source}: Ова не е резервна копија од програмата.`);
    if (o.kind === 'wise-legacy-export' || Array.isArray(o.firms) || Array.isArray(o.appusers) || Array.isArray(o.users)) {
      for (const f of (Array.isArray(o.firms) ? o.firms : []) as unknown[]) {
        if (isObj(f)) B.firms.push(firmBackup({ at: o.at, ...f }, 'full-export', source, B.warnings));
      }
      const U = (Array.isArray(o.users) ? o.users : Array.isArray(o.appusers) ? o.appusers : []) as unknown[];
      for (const u of U) if (isObj(u) && u.id != null) B.users.push({ ...u, id: String(u.id) } as LegacyUser);
      if (isObj(o.settings)) Object.assign(B.glob, o.settings);
      if (isObj(o.glob)) Object.assign(B.glob, o.glob);
      return;
    }
    if (isObj(o.firm) && isObj(o.data)) {
      B.firms.push(firmBackup(o, o.v === 1 ? 'bkp-v1' : 'firm-json', source, B.warnings));
      return;
    }
    if (Array.isArray(o.files) && isObj(o.glob)) {
      Object.assign(B.glob, o.glob);
      B.warnings.push(`${source}: индекс на резервна копија – земени се само поставките (шеми, курсна листа, параметри за плата); податоците на фирмите се во ZIP датотеката.`);
      return;
    }
    throw new BackupFormatError(`${source}: Ова не е резервна копија од програмата.`);
  };
  if (Array.isArray(j)) j.forEach(take);
  else take(j);
  return B;
}

/** Parse an uploaded file: a ZIP of backup JSON files, or one JSON file. */
export function parseBackupFile(name: string, bytes: Uint8Array): LegacyBundle {
  if (isZip(bytes)) {
    const parts = readZip(bytes).filter((e) => /\.json$/i.test(e.name));
    if (!parts.length) throw new BackupFormatError(`${name}: ZIP архивата нема JSON датотеки.`);
    return mergeBundles(parts.map((e) => parseBackupBytes(`${name} › ${e.name}`, e.data)));
  }
  return parseBackupBytes(name, bytes);
}

function parseBackupBytes(source: string, bytes: Uint8Array): LegacyBundle {
  let text = new TextDecoder('utf-8').decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let j: unknown;
  try { j = JSON.parse(text); } catch { throw new BackupFormatError(`${source}: Датотеката не може да се прочита (не е JSON).`); }
  return parseBackupJson(j, source);
}

const IMG_KEYS = ['logo', 'sign', 'stamp'] as const;

/**
 * Merge several bundles: one entry per legacy firm id — the newest backup wins (by `at`); firm images
 * (`logo/sign/stamp`, only in "Само оваа фирма" files) are carried over from an older file when the newer one lacks them.
 */
export function mergeBundles(list: readonly LegacyBundle[]): LegacyBundle {
  const out: LegacyBundle = { firms: [], users: [], glob: {}, warnings: [] };
  const byId = new Map<string, LegacyFirmBackup>();
  const users = new Map<string, LegacyUser>();
  for (const b of list) {
    out.warnings.push(...b.warnings);
    Object.assign(out.glob, b.glob);
    for (const u of b.users) users.set(u.id, u);
    for (const f of b.firms) {
      const prev = byId.get(f.firm.id);
      if (!prev) { byId.set(f.firm.id, f); continue; }
      const newer = String(f.at ?? '') >= String(prev.at ?? '') ? f : prev;
      const older = newer === f ? prev : f;
      for (const k of IMG_KEYS) if (newer.firm[k] == null && older.firm[k] != null) newer.firm = { ...newer.firm, [k]: older.firm[k] };
      out.warnings.push(`Фирмата „${String(newer.firm.name ?? newer.firm.id)}“ е во повеќе датотеки – се увезува најновата копија (${newer.source}).`);
      byId.set(f.firm.id, newer);
    }
  }
  out.firms = [...byId.values()];
  out.users = [...users.values()];
  return out;
}

/** Record counts per collection (for the report and the progress display). */
export const collectionCounts = (d: LegacyData): Record<LegacyCol, number> =>
  Object.fromEntries(LEGACY_COLS.map((c) => [c, d[c].length])) as Record<LegacyCol, number>;
