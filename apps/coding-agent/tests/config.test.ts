import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadAppConfig } from '../src/config';

describe('coding-agent config overrides', () => {
  it('allows running without config file when provider+model are provided', async () => {
    const configDir = path.join(os.tmpdir(), `marvin-agent-no-config-${Date.now()}`);
    const loaded = await loadAppConfig({ configDir, provider: 'openai', model: 'gpt-4.1' });
    expect(loaded.provider).toBe('openai');
    expect(loaded.modelId).toBe('gpt-4.1');
  });

  it('CLI overrides config file values', async () => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-agent-config-'));
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
