// Reports LLM wiring without ever printing a secret: key presence is a boolean only.
import { resolveLLMConfig } from './llm.mjs';

try {
  const { provider, apiKey, endpoint, model } = resolveLLMConfig();
  console.log(JSON.stringify({ provider, model, endpoint, keyPresent: Boolean(apiKey) }));
  if (!apiKey) {
    console.error('No key resolved. Set PIE_LLM_API_KEY, or the provider key var in .env, then rerun.');
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Config error: ${error.message}`);
  process.exitCode = 1;
}
