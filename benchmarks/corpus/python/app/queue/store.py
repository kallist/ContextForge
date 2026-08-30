from dataclasses import dataclass


@dataclass
class Job:
    job_id: str
    state: str = "pending"
    attempts: int = 0


class JobStore:
    def __init__(self) -> None:
        self.jobs: dict[str, Job] = {}

    def submit(self, job: Job) -> None:
        self.jobs.setdefault(job.job_id, job)

    def claim(self, job_id: str) -> Job | None:
        job = self.jobs.get(job_id)
        if job is None or job.state != "pending":
            return None
        job.state = "running"
        job.attempts += 1
        return job

    def complete(self, job_id: str) -> None:
        job = self.jobs[job_id]
        job.state = "completed"

    def release_stale(self, job_id: str) -> None:
        job = self.jobs[job_id]
        if job.state == "running":
            job.state = "pending"
