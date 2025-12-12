import {
  createAuthorizationFlow,
  decodeJWT,
  exchangeAuthorizationCode,
  refreshAccessToken,
  REDIRECT_URI,
} from 'opencode-openai-codex-auth/dist/lib/auth/auth.js';
import { openBrowserUrl } from 'opencode-openai-codex-auth/dist/lib/auth/browser.js';
import { startLocalOAuthServer } from 'opencode-openai-codex-auth/dist/lib/auth/server.js';
import {
  CODEX_BASE_URL,
  JWT_CLAIM_PATH,
} from 'opencode-openai-codex-auth/dist/lib/constants.js';
import { getNormalizedModel, MODEL_MAP } from 'opencode-openai-codex-auth/dist/lib/request/helpers/model-map.js';
import { normalizeModel } from 'opencode-openai-codex-auth/dist/lib/request/request-transformer.js';
import type { CodexTokenPayload, CodexTokenStorage } from './types';

export interface CodexOAuthClientOptions {
  storage: CodexTokenStorage;
  logger?: (message: string, details?: Record<string, unknown>) => void;
}

export class CodexOAuthClient {
  private readonly storage: CodexTokenStorage;
  private readonly logger?: (message: string, details?: Record<string, unknown>) => void;

  constructor(options: CodexOAuthClientOptions) {
    this.storage = options.storage;
    this.logger = options.logger;
  }

  async getValidToken(): Promise<CodexTokenPayload | undefined> {
    const cached = await this.storage.load();
    if (!cached) {
      return undefined;
    }
    if (cached.expiresAt > Date.now() + 30_000) {
      return cached;
    }
    try {
      const refreshed = await refreshAccessToken(cached.refreshToken);
      if (refreshed.type !== 'success') {
        this.logger?.('codex.refresh.failed');
        return undefined;
      }
      const payload: CodexTokenPayload = {
        accessToken: refreshed.access,
        refreshToken: refreshed.refresh,
        expiresAt: refreshed.expires,
        accountId: cached.accountId,
      };
      await this.storage.save(payload);
      return payload;
    } catch (error) {
      this.logger?.('codex.refresh.error', { error });
      return undefined;
    }
  }

  async ensureAuthenticated(): Promise<CodexTokenPayload> {
    const cached = await this.getValidToken();
    if (cached) {
      return cached;
    }
    this.logger?.('codex.oauth.start');
    const { pkce, state, url } = await createAuthorizationFlow();
    const server = await startLocalOAuthServer({ state });
    openBrowserUrl(url);
    const result = await server.waitForCode();
    server.close();
    if (!result?.code) {
      throw new Error('Codex OAuth canceled or timed out');
    }
    const exchange = await exchangeAuthorizationCode(result.code, pkce.verifier, REDIRECT_URI);
    if (exchange.type !== 'success') {
      throw new Error('Codex OAuth exchange failed');
    }
    const decoded = decodeJWT(exchange.access);
    const accountId = decoded?.[JWT_CLAIM_PATH]?.chatgpt_account_id;
    if (!accountId) {
      throw new Error('Codex OAuth missing account identifier');
    }
    const payload: CodexTokenPayload = {
      accessToken: exchange.access,
      refreshToken: exchange.refresh,
      expiresAt: exchange.expires,
      accountId,
    };
    await this.storage.save(payload);
    return payload;
  }

  async clear(): Promise<void> {
    await this.storage.save(undefined);
  }
}

export const normalizeCodexModel = (model: string): string =>
  MODEL_MAP[model] ?? getNormalizedModel(model) ?? normalizeModel(model);

export const getCodexBaseUrl = (): string => CODEX_BASE_URL;
