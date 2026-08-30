import { ApiClient, type ProfileDto } from "../api/client.js";

export class ProfileStore {
  private current: ProfileDto | null = null;

  constructor(private readonly api: ApiClient) {}

  async load(userId: string): Promise<ProfileDto> {
    this.current = await this.api.fetchProfile(userId);
    return this.current;
  }

  async save(displayName: string): Promise<ProfileDto> {
    if (this.current === null) throw new Error("PROFILE_NOT_LOADED");
    this.current = await this.api.updateProfile({ ...this.current, displayName });
    return this.current;
  }
}
