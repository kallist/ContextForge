export interface SessionRecord {
  id: string;
  userId: string;
  revoked: boolean;
}

export class SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();

  createSession(record: SessionRecord): void {
    this.sessions.set(record.id, record);
  }

  revokeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) session.revoked = true;
  }

  getSession(sessionId: string): SessionRecord | null {
    return this.sessions.get(sessionId) ?? null;
  }
}
