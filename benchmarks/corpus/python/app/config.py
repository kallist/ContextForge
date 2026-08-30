from dataclasses import dataclass


@dataclass(frozen=True)
class QueueSettings:
    lease_seconds: int
    maximum_attempts: int


def load_queue_settings(environment: dict[str, str]) -> QueueSettings:
    lease_seconds = int(environment.get("QUEUE_LEASE_SECONDS", "30"))
    maximum_attempts = int(environment.get("QUEUE_MAXIMUM_ATTEMPTS", "3"))
    if lease_seconds <= 0 or maximum_attempts <= 0:
        raise ValueError("QUEUE_SETTINGS_INVALID")
    return QueueSettings(lease_seconds, maximum_attempts)
