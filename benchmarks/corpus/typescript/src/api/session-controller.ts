import { AuthService } from "../auth/auth-service.js";

export class SessionController {
  constructor(private readonly auth: AuthService) {}

  create(userId: string): string {
    return this.auth.login({ id: `session-${userId}`, userId, revoked: false }, 3600);
  }

  revoke(sessionId: string): { status: number } {
    this.auth.logout(sessionId);
    return { status: 204 };
  }
}
