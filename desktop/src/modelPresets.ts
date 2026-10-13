// Model services offered as one-click choices: the public address, API type and where to get a key.
// The user still pastes their own key; no key ships with Suo. Model IDs come from the service's own
// list at setup time, so `prefer` only picks a sensible default from that list.
export type Preset = { id: string; name: string; api: string; baseUrl: string; keyUrl: string; prefer: string[] };

export const PRESETS: Preset[] = [
  { id: 'deepseek', name: 'DeepSeek', api: 'openai-completions', baseUrl: 'https://api.deepseek.com', keyUrl: 'https://platform.deepseek.com/api_keys', prefer: ['deepseek-chat'] },
  { id: 'kimi', name: 'Kimi', api: 'openai-completions', baseUrl: 'https://api.moonshot.cn/v1', keyUrl: 'https://platform.moonshot.cn/console/api-keys', prefer: ['kimi-k2', 'kimi-latest', 'moonshot-v1-32k'] },
  { id: 'qwen', name: '通义千问', api: 'openai-completions', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', keyUrl: 'https://bailian.console.aliyun.com/', prefer: ['qwen-plus', 'qwen-max', 'qwen-turbo'] },
  { id: 'glm', name: '智谱 GLM', api: 'openai-completions', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', keyUrl: 'https://open.bigmodel.cn/', prefer: ['glm-4.6', 'glm-4.5', 'glm-4-plus'] },
  { id: 'siliconflow', name: '硅基流动', api: 'openai-completions', baseUrl: 'https://api.siliconflow.cn/v1', keyUrl: 'https://cloud.siliconflow.cn/account/ak', prefer: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen3', 'moonshotai/Kimi-K2'] },
  { id: 'openrouter', name: 'OpenRouter', api: 'openai-completions', baseUrl: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys', prefer: ['anthropic/claude-sonnet', 'openai/gpt-5', 'deepseek/deepseek-chat'] },
  { id: 'openai', name: 'OpenAI', api: 'openai-completions', baseUrl: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys', prefer: ['gpt-5', 'gpt-4.1', 'gpt-4o'] },
  { id: 'anthropic', name: 'Anthropic', api: 'anthropic-messages', baseUrl: 'https://api.anthropic.com', keyUrl: 'https://console.anthropic.com/settings/keys', prefer: ['claude-sonnet', 'claude-opus'] },
];

const plain = (url: string) => url.trim().replace(/\/+$/u, '').toLowerCase();
export const presetFor = (baseUrl: string) => PRESETS.find(item => plain(item.baseUrl) === plain(baseUrl));

// The first listed model that matches the service's preferred names, in order of preference.
export function recommendedModel(preset: Preset | undefined, ids: string[]) {
  for (const prefix of preset?.prefer ?? []) {
    const found = ids.find(id => id.toLowerCase().startsWith(prefix.toLowerCase()));
    if (found) return found;
  }
  return undefined;
}
