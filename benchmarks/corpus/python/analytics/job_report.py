class JobReport:
    def summarize(self, completed: int, failed: int) -> dict[str, int]:
        return {"completed": completed, "failed": failed}
