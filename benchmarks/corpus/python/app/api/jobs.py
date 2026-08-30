from app.queue.store import Job, JobStore


class JobsApi:
    def __init__(self, store: JobStore) -> None:
        self.store = store

    def submit_job(self, job_id: str) -> dict[str, str]:
        self.store.submit(Job(job_id))
        return {"job_id": job_id, "state": "pending"}

    def status(self, job_id: str) -> dict[str, str]:
        job = self.store.jobs[job_id]
        return {"job_id": job.job_id, "state": job.state}
