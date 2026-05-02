import Anthropic from '@anthropic-ai/sdk';
import type { OverviewConfig, LlmClient } from '../types.js';

export class ClaudeClient implements LlmClient {
  private client: Anthropic;
  private model: string;
  private retryAttempts: number;

  constructor(config: OverviewConfig) {
    this.client = new Anthropic({ apiKey: config.anthropicApiKey });
    this.model = config.claudeModel;
    this.retryAttempts = config.retryAttempts;
  }

  getModelName(): string {
    return this.model;
  }

  async chat(systemPrompt: string, userMessage: string): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retryAttempts; attempt++) {
      try {
        if (attempt > 0) {
          const wait = Math.min(2000 * Math.pow(2, attempt), 15000);
          await new Promise(r => setTimeout(r, wait));
        }

        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: 2048,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
        });

        return response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map(b => b.text)
          .join('');
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const status = (err as { status?: number }).status;
        if (status !== 529 && status !== 429) throw lastError;
      }
    }

    throw lastError!;
  }
}
