class ProfileReport:
    def count_named_profiles(self, names: list[str]) -> int:
        return len([name for name in names if name])
