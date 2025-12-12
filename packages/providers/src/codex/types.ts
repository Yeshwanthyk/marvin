export interface CodexTokenPayload {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId: string;
}

export interface CodexTokenStorage {
  load(): Promise<CodexTokenPayload | undefined> | CodexTokenPayload | undefined;
  save(payload?: CodexTokenPayload): Promise<void> | void;
}
