"""Small, pure formatting helpers ported from `src/lib/format.ts`."""
from __future__ import annotations

import time


def clamp(value: float, lo: float, hi: float) -> float:
    return min(hi, max(lo, value))


def format_clock(ms: float) -> str:
    """'m:ss' clock from milliseconds."""
    total = max(0, round(ms / 1000))
    return f"{total // 60}:{total % 60:02d}"


def format_time_of_day(epoch_ms: float) -> str:
    """Format a wall-clock timestamp (ms since epoch) as HH:MM:SS (local time)."""
    lt = time.localtime(epoch_ms / 1000)
    return f"{lt.tm_hour:02d}:{lt.tm_min:02d}:{lt.tm_sec:02d}"


def now_ms() -> float:
    """Wall-clock milliseconds since the epoch (JS `Date.now()` analogue)."""
    return time.time() * 1000
