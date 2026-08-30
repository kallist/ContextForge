class ProfileCache:
    def __init__(self) -> None:
        self.values: dict[str, dict[str, str]] = {}

    def get(self, user_id: str) -> dict[str, str] | None:
        return self.values.get(user_id)

    def set(self, user_id: str, profile: dict[str, str]) -> None:
        self.values[user_id] = profile

    def invalidate(self, user_id: str) -> None:
        self.values.pop(user_id, None)
