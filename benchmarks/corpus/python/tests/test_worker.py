from datetime import datetime, timedelta

from app.queue.lease import LeasePolicy
from app.queue.store import Job, JobStore
from app.queue.worker import Worker


def test_expired_lease_requeued() -> bool:
    store = JobStore()
    store.submit(Job("job-1", state="running"))
    now = datetime.now()
    worker = Worker(store, LeasePolicy(30))
    return worker.run_once("job-1", now - timedelta(seconds=31), now)
