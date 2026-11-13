"""In-process pub/sub for job events (SSE). Thread-safe: handlers run in a thread pool."""

from __future__ import annotations

import asyncio
import threading
from collections import defaultdict
from typing import Any


class EventBus:
    def __init__(self) -> None:
        self._subs: dict[str, set[tuple[asyncio.AbstractEventLoop, asyncio.Queue]]] = defaultdict(set)
        self._lock = threading.Lock()

    def subscribe(self, job_id: str) -> tuple[asyncio.Queue, Any]:
        loop = asyncio.get_running_loop()
        q: asyncio.Queue = asyncio.Queue(maxsize=256)
        item = (loop, q)
        with self._lock:
            self._subs[job_id].add(item)

        def unsubscribe() -> None:
            with self._lock:
                self._subs[job_id].discard(item)
                if not self._subs[job_id]:
                    self._subs.pop(job_id, None)

        return q, unsubscribe

    def publish(self, job_id: str, event: str, data: dict) -> None:
        with self._lock:
            targets = list(self._subs.get(job_id, ()))
        for loop, q in targets:
            def put(q=q, item=(event, data)) -> None:
                if q.full():  # drop the oldest progress tick rather than block the publisher
                    try:
                        q.get_nowait()
                    except asyncio.QueueEmpty:
                        pass
                q.put_nowait(item)

            try:
                loop.call_soon_threadsafe(put)
            except RuntimeError:  # loop closed
                pass
