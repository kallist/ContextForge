import { AuthService } from "../src/auth/auth-service.js";
import { SessionStore } from "../src/auth/session-store.js";
import { TokenService } from "../src/auth/token-service.js";

export function testRevokedSession(): boolean {
  const store = new SessionStore();
  const auth = new AuthService(store, new TokenService());
  const token = auth.login({ id: "s1", userId: "u1", revoked: false }, 60);
  auth.logout("s1");
  return auth.isAuthenticated("s1", token) === false;
}
