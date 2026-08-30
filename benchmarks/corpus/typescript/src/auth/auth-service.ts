import { SessionStore, type SessionRecord } from "./session-store.js";
import { TokenService } from "./token-service.js";

export class AuthService {
  constructor(
    private readonly sessions: SessionStore,
    private readonly tokens: TokenService,
  ) {}

  login(record: SessionRecord, ttlSeconds: number): string {
    this.sessions.createSession(record);
    return this.tokens.issue(record, ttlSeconds);
  }

  logout(sessionId: string): void {
    this.sessions.revokeSession(sessionId);
  }

  isAuthenticated(sessionId: string, token: string): boolean {
    return this.tokens.verify(token, this.sessions.getSession(sessionId));
  }
}
