/**
 * Firestore 백업·복구 코어 (docs/backup_restore_spec.md 구현)
 *
 * 앱 코드가 아니라 도구다 — `fs`를 쓰므로 `src/` 밑에 두지 않는다.
 * 백업 스크립트·복구 스크립트·위험 직전 스냅샷 헬퍼가 공유한다.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  Timestamp,
  GeoPoint,
  DocumentReference,
  type CollectionReference,
  type Firestore,
} from "firebase-admin/firestore";

export const SCHEMA_VERSION = 1;

/** 기본 저장 위치는 **저장소 밖**이다 (스펙 §4-1: 안에 두면 언젠가 커밋된다). */
export function defaultBackupRoot(): string {
  return process.env.SCHOOL_BACKUP_DIR || path.join(os.homedir(), "school-backups");
}

// ─────────────────────────────────────────────────────────
// 값 인코딩 — JSON에 없는 Firestore 타입을 왕복 가능하게 태깅
// 모르는 타입은 조용히 문자열로 만들지 않고 즉시 중단한다 (스펙 §1-2).
// ─────────────────────────────────────────────────────────
const TAG = "__fs__";

export function encodeValue(v: any, where: string): any {
  if (v === null || v === undefined) return null;
  const t = typeof v;
  if (t === "string" || t === "number" || t === "boolean") return v;
  if (Array.isArray(v)) return v.map((x, i) => encodeValue(x, `${where}[${i}]`));

  if (v instanceof Timestamp) return { [TAG]: "timestamp", seconds: v.seconds, nanoseconds: v.nanoseconds };
  if (v instanceof Date) return { [TAG]: "timestamp", seconds: Math.floor(v.getTime() / 1000), nanoseconds: (v.getTime() % 1000) * 1e6 };
  if (v instanceof GeoPoint) return { [TAG]: "geopoint", latitude: v.latitude, longitude: v.longitude };
  if (v instanceof DocumentReference) return { [TAG]: "ref", path: v.path };
  if (Buffer.isBuffer(v)) return { [TAG]: "bytes", base64: v.toString("base64") };

  if (t === "object" && (v.constructor === Object || v.constructor === undefined)) {
    const out: Record<string, any> = {};
    for (const k of Object.keys(v)) {
      if (k === TAG) throw new Error(`백업 중단: 예약 키 '${TAG}'가 실제 필드로 존재한다 (${where}). 인코딩 규약과 충돌하므로 사람이 판단해야 한다.`);
      out[k] = encodeValue(v[k], `${where}.${k}`);
    }
    return out;
  }

  throw new Error(
    `백업 중단: 알 수 없는 값 타입 (${v?.constructor?.name ?? t}) at ${where}\n` +
      `조용히 손상시키는 대신 멈춘다 — scripts/lib/firestoreBackup.ts의 encodeValue에 이 타입을 추가하라.`
  );
}

export function decodeValue(v: any, db: Firestore): any {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => decodeValue(x, db));

  if (typeof v[TAG] === "string") {
    switch (v[TAG]) {
      case "timestamp": return new Timestamp(v.seconds, v.nanoseconds);
      case "geopoint": return new GeoPoint(v.latitude, v.longitude);
      case "ref": return db.doc(v.path);
      case "bytes": return Buffer.from(v.base64, "base64");
      default: throw new Error(`복구 중단: 알 수 없는 인코딩 태그 '${v[TAG]}'`);
    }
  }

  const out: Record<string, any> = {};
  for (const k of Object.keys(v)) out[k] = decodeValue(v[k], db);
  return out;
}

// ─────────────────────────────────────────────────────────
// 순회 — 컬렉션 목록을 하드코딩하지 않는다 (스펙 §1)
// ─────────────────────────────────────────────────────────
export interface BackupDoc {
  path: string;
  data: Record<string, any>;
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/**
 * 컬렉션 하나를 재귀 순회한다.
 *
 * ⚠️ `listDocuments()`를 쓰는 것이 핵심이다. `get()`은 **존재하는 문서만** 돌려주므로,
 * `memos/{domain}` 처럼 부모 문서가 없고 하위 컬렉션만 있는 경우 그 아래가 통째로 누락된다.
 * 이 저장소는 memos·discipline_records·timetable_* 이 전부 그 구조다 (스펙 §1-1).
 */
export async function* walkCollection(col: CollectionReference): AsyncGenerator<BackupDoc> {
  const refs = await col.listDocuments();
  if (refs.length === 0) return;

  for (const part of chunk(refs, 300)) {
    const snaps = await col.firestore.getAll(...part);
    for (const s of snaps) {
      if (!s.exists) continue; // 유령 부모 문서 — 데이터는 없고 하위만 있다
      yield { path: s.ref.path, data: encodeValue(s.data(), s.ref.path) };
    }
  }

  for (const ref of refs) {
    const subs = await ref.listCollections();
    for (const sub of subs) yield* walkCollection(sub);
  }
}

export async function* walkAll(db: Firestore): AsyncGenerator<BackupDoc> {
  for (const col of await db.listCollections()) yield* walkCollection(col);
}

// ─────────────────────────────────────────────────────────
// 아카이브 쓰기/읽기 — JSONL (스펙 §5)
// ─────────────────────────────────────────────────────────
export interface Manifest {
  schemaVersion: number;
  createdAt: string;
  label: string;
  scope: "full" | "partial";
  paths?: string[];
  docCount: number;
  byCollection: Record<string, number>;
}

function stamp(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}T${p(now.getHours())}${p(now.getMinutes())}`;
}

// 문서 경로에서 소속 컬렉션 경로를 뽑는다.
// 문서 id 자리는 별표로 접어 집계 키로 쓴다: "memos/hmh.or.kr/items/abc" → "memos/(id)/items"
export function collectionKeyOf(docPath: string): string {
  const seg = docPath.split("/");
  return seg.map((s, i) => (i % 2 === 1 ? "(id)" : s)).slice(0, -1).join("/");
}

export async function writeArchive(
  docs: AsyncGenerator<BackupDoc>,
  opts: { root?: string; label: string; scope: "full" | "partial"; paths?: string[]; now: Date }
): Promise<{ dir: string; manifest: Manifest }> {
  const root = opts.root || defaultBackupRoot();
  const dir = path.join(root, `${stamp(opts.now)}_${opts.label}`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const dataPath = path.join(dir, "data.jsonl");
  const out = fs.createWriteStream(dataPath, { mode: 0o600 });
  const byCollection: Record<string, number> = {};
  let docCount = 0;

  for await (const d of docs) {
    if (!out.write(JSON.stringify(d) + "\n")) {
      await new Promise<void>((res) => out.once("drain", () => res()));
    }
    docCount++;
    const k = collectionKeyOf(d.path);
    byCollection[k] = (byCollection[k] || 0) + 1;
  }
  await new Promise<void>((res, rej) => out.end((e: any) => (e ? rej(e) : res())));

  const manifest: Manifest = {
    schemaVersion: SCHEMA_VERSION,
    createdAt: opts.now.toISOString(),
    label: opts.label,
    scope: opts.scope,
    ...(opts.paths ? { paths: opts.paths } : {}),
    docCount,
    byCollection,
  };
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  return { dir, manifest };
}

export function readArchive(dir: string): { manifest: Manifest; docs: BackupDoc[] } {
  const manifest: Manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`복구 중단: 아카이브 스키마 버전 ${manifest.schemaVersion} ≠ 현재 ${SCHEMA_VERSION}`);
  }
  const lines = fs.readFileSync(path.join(dir, "data.jsonl"), "utf8").split("\n").filter(Boolean);
  const docs: BackupDoc[] = lines.map((l, i) => {
    try { return JSON.parse(l); } catch { throw new Error(`복구 중단: data.jsonl ${i + 1}행 파손`); }
  });
  // 잘린 파일 탐지 — manifest의 건수와 실제가 다르면 멈춘다 (스펙 §5)
  if (docs.length !== manifest.docCount) {
    throw new Error(
      `복구 중단: 문서 수 불일치 — manifest ${manifest.docCount}건 vs 파일 ${docs.length}건. 아카이브가 잘렸을 수 있다.`
    );
  }
  return { manifest, docs };
}

/**
 * 위험 직전 스냅샷 (스펙 §2-A) — 파괴적 스크립트가 실행 **전에** 부른다.
 * 지정 경로만 담는다. 컬렉션 경로("memos/hmh.or.kr/items")를 넘긴다.
 */
export async function snapshotBeforeDestruction(
  db: Firestore,
  collectionPaths: string[],
  label: string
): Promise<{ dir: string; manifest: Manifest }> {
  async function* gen() {
    for (const p of collectionPaths) yield* walkCollection(db.collection(p));
  }
  const res = await writeArchive(gen(), {
    label: `pre_${label}`,
    scope: "partial",
    paths: collectionPaths,
    now: new Date(),
  });
  console.log(`[스냅샷] 실행 전 ${res.manifest.docCount}건 보관 → ${res.dir}`);
  return res;
}
