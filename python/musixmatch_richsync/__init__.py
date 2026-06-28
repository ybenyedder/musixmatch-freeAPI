"""
musixmatch-richsync — word-by-word (richsync) synced lyrics from Musixmatch.

Uses the token-based client flow on apic-desktop.musixmatch.com (the one the
Musixmatch web/desktop client uses internally), NOT the HMAC-signed
www.musixmatch.com/ws endpoint that older libraries rely on (currently broken).

Quick start:

    from musixmatch_richsync import MusixmatchRichsync

    mx = MusixmatchRichsync()
    res = mx.get_lyrics(title="Skyfall", artist="Adele", duration=286)
    if res:
        print(res.kind)   # "word" | "line"
        print(res.lrc)    # enhanced LRC ([mm:ss.cc]<mm:ss.cc>word ...) or line-level LRC
"""

from .client import LyricsResult, MusixmatchError, MusixmatchRichsync, richsync_to_lrc

__all__ = ["MusixmatchRichsync", "LyricsResult", "MusixmatchError", "richsync_to_lrc"]
__version__ = "1.0.0"
