from datetime import datetime

from .lease import LeasePolicy
from .store import JobStore


class Worker:
    def __init__(self, store: JobStore, leases: LeasePolicy) -> None:
        self.store = store
        self.leases = leases

    def run_once(self, job_id: str, claimed_at: datetime, now: datetime) -> bool:
        if self.leases.is_expired(claimed_at, now):
            self.store.release_stale(job_id)
        return self.store.claim(job_id) is not None

    def handle_failure(self, job_id: str) -> None:
        self.store.release_stale(job_id)
