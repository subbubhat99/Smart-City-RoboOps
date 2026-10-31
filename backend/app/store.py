import json
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path


class Store:
    """All mutations serialize and atomically persist the operational snapshot."""
    def __init__(self, path: str, seed):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.path, self.seed, self.lock = path, seed, threading.RLock()
        with self.transaction() as state:
            pass

    @contextmanager
    def transaction(self):
        with self.lock, sqlite3.connect(self.path, timeout=10) as connection:
            connection.execute('CREATE TABLE IF NOT EXISTS dashboard (id INTEGER PRIMARY KEY CHECK(id=1), document TEXT NOT NULL)')
            connection.execute('BEGIN IMMEDIATE')
            row = connection.execute('SELECT document FROM dashboard WHERE id=1').fetchone()
            state = json.loads(row[0]) if row else self.seed()
            yield state
            connection.execute('INSERT OR REPLACE INTO dashboard VALUES (1, ?)', (json.dumps(state, allow_nan=False),))

    def read(self):
        with self.transaction() as state:
            return state
