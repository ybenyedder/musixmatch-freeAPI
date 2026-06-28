#!/usr/bin/env python3
"""Minimal example: fetch word-by-word lyrics and print the enhanced LRC."""

from musixmatch_richsync import MusixmatchRichsync

mx = MusixmatchRichsync()

for title, artist, duration in [
    ("Skyfall", "Adele", 286),
    ("Diamonds", "Rihanna", 225),
    ("Blinding Lights", "The Weeknd", 200),
]:
    res = mx.get_lyrics(title=title, artist=artist, duration=duration)
    if not res:
        print(f"✗ {artist} – {title}: no match")
        continue
    print(f"{'✓ WORD' if res.is_word_synced else '· line'} {res.artist_name} – {res.track_name}")
    print("\n".join(res.lrc.splitlines()[:3]))
    print("-" * 60)
