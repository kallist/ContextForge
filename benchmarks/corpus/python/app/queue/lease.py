from datetime import datetime, timedelta


class LeasePolicy:
    def __init__(self, lease_seconds: int) -> None:
        self.lease_seconds = lease_seconds

    def is_expired(self, claimed_at: datetime, now: datetime) -> bool:
        return now >= claimed_at + timedelta(seconds=self.lease_seconds)
