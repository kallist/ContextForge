import { ApiClient } from "../src/api/client.js";
import { ProfileStore } from "../src/state/profile-store.js";

export async function testStaleProfile(): Promise<boolean> {
  const store = new ProfileStore(new ApiClient());
  await store.load("u1");
  return (await store.save("Grace")).displayName === "Grace";
}
