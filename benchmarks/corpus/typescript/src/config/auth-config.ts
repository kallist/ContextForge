export interface AuthConfig {
  sessionTtlSeconds: number;
}

export function loadAuthConfig(environment: Record<string, string | undefined>): AuthConfig {
  const raw = environment.AUTH_SESSION_TTL_SECONDS ?? "3600";
  const sessionTtlSeconds = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(sessionTtlSeconds) || sessionTtlSeconds <= 0) throw new Error("AUTH_TTL_INVALID");
  return { sessionTtlSeconds };
}
