import type { SessionRecord } from "./session-store.js";

export class TokenService {
  issue(session: SessionRecord, ttlSeconds: number): string {
    return `${session.id}:${ttlSeconds}`;
  }

  verify(token: string, session: SessionRecord | null): boolean {
    return session !== null && !session.revoked && token.startsWith(`${session.id}:`);
  }
}
