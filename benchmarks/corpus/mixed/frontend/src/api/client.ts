export interface ProfileDto {
  userId: string;
  displayName: string;
}

export class ApiClient {
  async fetchProfile(userId: string): Promise<ProfileDto> {
    return { userId, displayName: "Ada" };
  }

  async updateProfile(profile: ProfileDto): Promise<ProfileDto> {
    return profile;
  }
}
