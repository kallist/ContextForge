def normalize_job_name(value: str) -> str:
    return value.strip().lower().replace(" ", "-")
