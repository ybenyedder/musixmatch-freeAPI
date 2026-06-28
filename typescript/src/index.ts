// musixmatch-richsync — word-by-word (richsync) synced lyrics from Musixmatch.
//
// Uses the token-based client flow on apic-desktop.musixmatch.com (the one the
// Musixmatch web/desktop client uses internally), NOT the HMAC-signed
// www.musixmatch.com/ws endpoint older libraries rely on (currently broken).
//
// Zero dependencies — needs a global `fetch` (Node >= 18, Bun, Deno, browsers).

export interface LyricsResult {
  /** Enhanced LRC (`[mm:ss.cc]<mm:ss.cc>word ...`) for word sync, or line-level LRC. */
  lrc: string;
  /** "word" = per-word (richsync); "line" = line-level subtitle. */
  kind: "word" | "line";
  trackName: string;
  artistName: string;
  commontrackId: number;
}

export interface GetLyricsQuery {
  title: string;
  artist: string;
  album?: string;
  /** Track length in seconds — improves matching when provided. */
  duration?: number;
  /** Return only word-by-word results (skip line-level fallback). */
  wordsOnly?: boolean;
}

export interface ClientOptions {
  /** API host override (default apic-desktop). */
  baseUrl?: string;
  /** Per-request timeout in ms (default 15000). */
  timeoutMs?: number;
  /** How long to reuse a token before refetching, ms (default 6h). */
  tokenTtlMs?: number;
}

const DEFAULT_BASE = "https://apic-desktop.musixmatch.com/ws/1.1/";
const APP_ID = "web-desktop-app-v1.0";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ── helpers ───────────────────────────────────────────────────────────────────
function normalize(s: string): string {
  return (s || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\(feat\.[^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function deepFind(obj: unknown, key: string): unknown {
  if (Array.isArray(obj)) {
    for (const v of obj) {
      const r = deepFind(v, key);
      if (r !== undefined) return r;
    }
  } else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      if (k === key) return v;
      const r = deepFind(v, key);
      if (r !== undefined) return r;
    }
  }
  return undefined;
}

function stamp(total: number): string {
  let t = Math.max(0, total);
  let m = Math.floor(t / 60);
  let s = Math.floor(t % 60);
  let c = Math.round((t - Math.floor(t)) * 100);
  if (c >= 100) { c -= 100; s += 1; }
  if (s >= 60) { s -= 60; m += 1; }
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(m)}:${p(s)}.${p(c)}`;
}

interface RichsyncChunk { c?: string; o?: number }
interface RichsyncEntry { ts?: number; x?: string; l?: RichsyncChunk[] }

/** Convert a `richsync_body` JSON string to enhanced (word-timed) LRC, or "". */
export function richsyncToLrc(richsyncBody: string): string {
  let entries: RichsyncEntry[];
  try {
    entries = JSON.parse(richsyncBody);
  } catch {
    return "";
  }
  if (!Array.isArray(entries)) return "";
  const lines: Array<{ ts: number; text: string }> = [];
  let hasWords = false;
  for (const e of entries) {
    const ts = Number(e.ts);
    if (!Number.isFinite(ts)) continue;
    const words = (e.l ?? [])
      .map((w) => ({ t: ts + Number(w.o ?? 0), c: String(w.c ?? "").trim() }))
      .filter((w) => w.c.length > 0 && Number.isFinite(w.t));
    if (words.length > 0) {
      hasWords = true;
      lines.push({ ts, text: `[${stamp(ts)}]` + words.map((w) => `<${stamp(w.t)}>${w.c}`).join(" ") });
    } else if (e.x && e.x.trim()) {
      lines.push({ ts, text: `[${stamp(ts)}]` + e.x.trim() });
    }
  }
  if (!hasWords) return "";
  lines.sort((a, b) => a.ts - b.ts);
  return lines.map((l) => l.text).join("\n");
}

interface MxmTrack {
  track_name?: string;
  artist_name?: string;
  track_length?: number;
  commontrack_id?: number;
  has_richsync?: number;
  instrumental?: number;
}

// ── client ────────────────────────────────────────────────────────────────────
export class MusixmatchRichsync {
  private baseUrl: string;
  private timeoutMs: number;
  private tokenTtlMs: number;
  private token: string | null = null;
  private tokenAt = 0;

  constructor(opts: ClientOptions = {}) {
    this.baseUrl = (opts.baseUrl || DEFAULT_BASE).replace(/\/?$/, "/");
    this.timeoutMs = opts.timeoutMs ?? 15000;
    this.tokenTtlMs = opts.tokenTtlMs ?? 6 * 60 * 60 * 1000;
  }

  private async get(endpoint: string, params: Record<string, string | number>): Promise<unknown | null> {
    const query = Object.entries({ app_id: APP_ID, format: "json", ...params })
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${endpoint}?${query}`, {
        headers: { "User-Agent": USER_AGENT, Cookie: "x-mxm-token-guid=" },
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const text = await res.text();
      if (text.trimStart().startsWith("<")) return null; // captcha / HTML
      return JSON.parse(text);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Get a usable anonymous user token (cached for `tokenTtlMs`, retried with backoff). */
  async getToken(force = false): Promise<string | null> {
    if (!force && this.token && Date.now() - this.tokenAt < this.tokenTtlMs) return this.token;
    for (const delay of [0, 20000, 45000, 90000]) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      const json = (await this.get("token.get", { t: `${Date.now()}` })) as
        | { message?: { body?: { user_token?: string } } }
        | null;
      const tok = json?.message?.body?.user_token;
      if (tok && !tok.startsWith("UpgradeOnly")) {
        this.token = tok;
        this.tokenAt = Date.now();
        return tok;
      }
    }
    return this.token;
  }

  private trusted(t: MxmTrack, title: string, artist: string, duration: number): boolean {
    const wt = normalize(title);
    const wa = normalize(artist);
    const gt = normalize(t.track_name ?? "");
    const ga = normalize(t.artist_name ?? "");
    const dd =
      typeof t.track_length === "number" && duration ? Math.abs(t.track_length - duration) : Infinity;
    if (dd > 15 && Number.isFinite(dd)) return false;
    const titleOk = !!gt && (gt === wt || gt.includes(wt) || wt.includes(gt));
    const artistOk = !!ga && (ga === wa || ga.includes(wa) || wa.includes(ga));
    return (titleOk && artistOk) || (dd <= 4 && (titleOk || artistOk));
  }

  private macroParams(q: GetLyricsQuery, token: string) {
    return {
      namespace: "lyrics_richsynched",
      subtitle_format: "lrc",
      q_track: q.title,
      q_artist: q.artist,
      q_album: q.album || "",
      q_duration: q.duration ? Math.round(q.duration) : "",
      usertoken: token,
    };
  }

  /** Enhanced (word-timed) LRC for a commontrack_id, or "". */
  async getRichsync(commontrackId: number): Promise<string> {
    const token = await this.getToken();
    if (!token) return "";
    const rich = await this.get("track.richsync.get", { commontrack_id: commontrackId, usertoken: token });
    const body = deepFind(rich, "richsync_body");
    return typeof body === "string" && body ? richsyncToLrc(body) : "";
  }

  /** Match a track and return its best synced lyrics (word-by-word preferred). */
  async getLyrics(q: GetLyricsQuery): Promise<LyricsResult | null> {
    if (!q.title || !q.artist) return null;
    let token = await this.getToken();
    if (!token) return null;

    let macro = await this.get("macro.subtitles.get", this.macroParams(q, token));
    if (deepFind(macro, "status_code") === 401) {
      const fresh = await this.getToken(true);
      if (!fresh) return null;
      token = fresh;
      macro = await this.get("macro.subtitles.get", this.macroParams(q, token));
    }
    if (!macro) return null;

    const track = (deepFind(deepFind(macro, "matcher.track.get"), "track") as MxmTrack | undefined) ?? undefined;
    if (!track || !this.trusted(track, q.title, q.artist, q.duration ?? 0) || track.instrumental) return null;
    const ctid = track.commontrack_id ?? 0;
    const meta = { trackName: track.track_name ?? "", artistName: track.artist_name ?? "", commontrackId: ctid };

    if (track.has_richsync && ctid) {
      const lrc = await this.getRichsync(ctid);
      if (lrc) return { lrc, kind: "word", ...meta };
    }
    if (!q.wordsOnly) {
      const sub = deepFind(macro, "subtitle_body");
      if (typeof sub === "string" && sub.includes("[") && sub.trim()) return { lrc: sub.trim(), kind: "line", ...meta };
    }
    return null;
  }
}

export default MusixmatchRichsync;
