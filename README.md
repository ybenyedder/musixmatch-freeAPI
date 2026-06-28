# musixmatch-richsync

**Word-by-word (richsync) synced lyrics from Musixmatch — the timing that powers karaoke.**

Most open lyrics sources (LRCLIB, lyrics.ovh, …) only give *line-level* sync. Musixmatch
is the one large catalogue with **per-word** timing ("richsync"). This library fetches it
and converts it to **enhanced LRC**:

```
[00:57.52]<00:57.52>For <00:57.74>this <00:57.81>is <00:57.95>the <00:58.06>end
```

Available for **Python** (`python/`) and **TypeScript/Node** (`typescript/`). Both are
zero-dependency.

> ⚠️ This uses an **unofficial** Musixmatch endpoint (no API key). It is for personal /
> educational use and may break or rate-limit at any time. Respect Musixmatch's Terms of
> Service. Not affiliated with Musixmatch.

---

## Why this exists (the reverse-engineering)

Older libraries (e.g. `musicxmatch-api`) sign requests to `www.musixmatch.com/ws/1.1/`
with an HMAC secret scraped from the site's JS bundle. **That endpoint is currently dead**
— it returns `503 hostname doesn't match against certificate` (a Fastly→origin TLS error),
globally, regardless of region.

This library instead replicates the flow the Musixmatch **web/desktop client** uses
internally, on a different host (`apic-desktop.musixmatch.com`), which works:

1. **`token.get`** → an anonymous `user_token`.
   *Rate-limited per IP — so the token is cached and persisted; don't fetch one per track.*
2. **`macro.subtitles.get`** with `q_track` / `q_artist` / `q_album` / `q_duration` →
   matches the track and returns it together with its **line-level subtitle** (LRC).
3. **`track.richsync.get?commontrack_id=…`** → the **per-word** timing
   (`richsync_body`: `[{ts, x, l:[{c:chunk, o:offset}]}]`, where a word's absolute time is
   `ts + o`).

No HMAC, no JS-bundle scraping. A `user_token` has a limited call quota; on HTTP `401`
(exhausted) the client transparently fetches a fresh token (with backoff) and retries.

---

## Python

```bash
pip install ./python          # or: pip install musixmatch-richsync  (once published)
```

```python
from musixmatch_richsync import MusixmatchRichsync

mx = MusixmatchRichsync()
res = mx.get_lyrics(title="Skyfall", artist="Adele", duration=286)

if res:
    print(res.kind)              # "word" or "line"
    print(res.is_word_synced)    # True for real karaoke timing
    print(res.lrc)               # enhanced LRC, ready to write as a .lrc sidecar
```

Run the demo: `python python/example.py`

## TypeScript / Node (>= 18)

```bash
cd typescript && npm install && npm run build
```

```ts
import { MusixmatchRichsync } from "musixmatch-richsync";

const mx = new MusixmatchRichsync();
const res = await mx.getLyrics({ title: "Skyfall", artist: "Adele", duration: 286 });

if (res) {
  console.log(res.kind);   // "word" | "line"
  console.log(res.lrc);    // enhanced LRC
}
```

---

## The enhanced-LRC format

```
[mm:ss.cc]<mm:ss.cc>word1 <mm:ss.cc>word2 <mm:ss.cc>word3
```

- The leading `[mm:ss.cc]` is the **line** start (compatible with any LRC player).
- Each `<mm:ss.cc>` stamps the **word** that follows — drive a karaoke wipe from these.

A player that ignores `<…>` tags still gets correct line-level sync, so the output is
backwards-compatible with ordinary `.lrc` consumers.

## API

Both clients expose the same surface:

| Python | TypeScript | Returns |
| --- | --- | --- |
| `get_lyrics(title, artist, album="", duration=0, words_only=False)` | `getLyrics({ title, artist, album?, duration?, wordsOnly? })` | best synced lyrics (word → line fallback) or `None`/`null` |
| `get_richsync(commontrack_id)` | `getRichsync(commontrackId)` | enhanced LRC for a known track, or `""` |
| `get_token(force=False)` | `getToken(force?)` | the cached user token |
| `richsync_to_lrc(body)` | `richsyncToLrc(body)` | convert a raw `richsync_body` to enhanced LRC |

## License

MIT — see [LICENSE](LICENSE).
