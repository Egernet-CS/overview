import type { OverviewConfig } from '../types.js';

export interface HealthStatus {
  available: boolean;
  models: string[];
  error?: string;
}

export async function checkLocalLlmHealth(config: OverviewConfig): Promise<HealthStatus> {
  try {
    const url = config.localLlmUrl.replace(/\/v1$/, '') + '/v1/models';
    const response = await fetch(url);
    if (!response.ok) {
      return { available: false, models: [], error: `HTTP ${response.status}` };
    }
    const data = await response.json() as { data?: Array<{ id: string }> };
    const models = (data.data ?? []).map(m => m.id);
    if (models.length === 0) {
      return { available: false, models: [], error: 'No models loaded' };
    }
    return { available: true, models };
  } catch (err) {
    return {
      available: false,
      models: [],
      error: err instanceof Error ? err.message : 'Connection failed',
    };
  }
}
