import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadAppConfig } from '../src/config';

describe('coding-agent config overrides', () => {
  it('allows running without config file when provider+model are provided', async () => {
    const configDir = path.join(os.tmpdir(), `marvin-no-config-${Date.now()}`);
    const loaded = await loadAppConfig({ configDir, provider: 'openai', model: 'gpt-4.1' });
    expect(loaded.provider).toBe('openai');
    expect(loaded.modelId).toBe('gpt-4.1');
  });

  it('defaults lsp to enabled with autoInstall', async () => {
    const configDir = path.join(os.tmpdir(), `marvin-lsp-default-${Date.now()}`);
    const loaded = await loadAppConfig({ configDir, provider: 'openai', model: 'gpt-4.1' });
    expect(loaded.lsp).toEqual({ enabled: true, autoInstall: true });
  });

  it('respects lsp: false in config', async () => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-lsp-false-'));
    await fs.writeFile(
      path.join(configDir, 'config.json'),
      JSON.stringify({ provider: 'openai', model: 'gpt-4.1', lsp: false }, null, 2)
    );
    const loaded = await loadAppConfig({ configDir });
    expect(loaded.lsp).toEqual({ enabled: false, autoInstall: false });
  });

  it('respects lsp.enabled and lsp.autoInstall in config', async () => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-lsp-partial-'));
    await fs.writeFile(
      path.join(configDir, 'config.json'),
      JSON.stringify({ provider: 'openai', model: 'gpt-4.1', lsp: { enabled: true, autoInstall: false } }, null, 2)
    );
    const loaded = await loadAppConfig({ configDir });
    expect(loaded.lsp).toEqual({ enabled: true, autoInstall: false });
  });

  it('CLI overrides config file values', async () => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-config-'));
    await fs.writeFile(
      path.join(configDir, 'config.json'),
      JSON.stringify(
        {
          provider: 'anthropic',
          model: 'claude-3-5-sonnet-20241022',
          thinking: 'off',
        },
        null,
        2
      )
    );

    const loaded = await loadAppConfig({
      configDir,
      provider: 'openai',
      model: 'gpt-4.1',
      thinking: 'high',
    });

    expect(loaded.provider).toBe('openai');
    expect(loaded.modelId).toBe('gpt-4.1');
    expect(loaded.thinking).toBe('high');
  });
});
