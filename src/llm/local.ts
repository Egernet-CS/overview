import OpenAI from 'openai';
import type { OverviewConfig, LlmClient } from '../types.js';

export class LocalClient implements LlmClient {
  private client: OpenAI;
  private model: string;
  private baseUrl: string;
  private apiKey: string;

  constructor(config: OverviewConfig) {
    const raw = config.localLlmUrl.replace(/\/$/, '');
    this.baseUrl = raw.endsWith('/v1') ? raw : raw + '/v1';
    this.apiKey = config.localLlmApiKey;
    this.client = new OpenAI({ baseURL: this.baseUrl, apiKey: this.apiKey });
    this.model = config.localLlmModel || '';
  }

  getModelName(): string {
    return this.model || 'local';
  }

  async detectModel(): Promise<void> {
    try {
      const url = `${this.baseUrl}/models`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${this.apiKey}` } });
      if (!res.ok) return;
      const data = await res.json() as { data?: Array<{ id: string }> };
      const first = data.data?.find(m => !m.id.includes('embedding'));
      if (first) this.model = first.id;
    } catch {
      // LM Studio not available — keep default
    }
  }

  async chat(systemPrompt: string, userMessage: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.1,
      max_tokens: 2048,
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) throw new Error(`Empty response from local LLM (model: ${this.model})`);
    return content;
  }
}
