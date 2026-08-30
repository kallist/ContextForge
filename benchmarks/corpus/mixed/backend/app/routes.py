from .profile_service import ProfileService


class ProfileRoutes:
    def __init__(self, profiles: ProfileService) -> None:
        self.profiles = profiles

    def get_profile(self, user_id: str) -> dict[str, str]:
        return self.profiles.get_profile(user_id)

    def update_profile(self, user_id: str, body: dict[str, str]) -> dict[str, str]:
        return self.profiles.update_profile(user_id, body["displayName"])
