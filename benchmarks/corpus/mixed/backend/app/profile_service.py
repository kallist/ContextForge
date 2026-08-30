from .cache import ProfileCache


class ProfileService:
    def __init__(self, cache: ProfileCache) -> None:
        self.cache = cache

    def get_profile(self, user_id: str) -> dict[str, str]:
        cached = self.cache.get(user_id)
        if cached is not None:
            return cached
        profile = {"userId": user_id, "displayName": "Ada"}
        self.cache.set(user_id, profile)
        return profile

    def update_profile(self, user_id: str, display_name: str) -> dict[str, str]:
        self.cache.invalidate(user_id)
        profile = {"userId": user_id, "displayName": display_name}
        self.cache.set(user_id, profile)
        return profile
