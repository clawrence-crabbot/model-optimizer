/**
 * Pricing module index
 * Exports all provider scrapers
 */
import { fetchAnthropicPricing } from './anthropic.js';
import { fetchGooglePricing } from './google.js';
import { fetchDeepSeekPricing } from './deepseek.js';
import { fetchMoonshotPricing } from './moonshot.js';
import { fetchOpenAIPricing } from './openai.js';
import { fetchAlibabaPricing } from './alibaba.js';
import { fetchMetaPricing } from './meta.js';
import { fetchMicrosoftPricing } from './microsoft.js';

export { fetchAnthropicPricing } from './anthropic.js';
export { fetchGooglePricing } from './google.js';
export { fetchDeepSeekPricing } from './deepseek.js';
export { fetchMoonshotPricing } from './moonshot.js';
export { fetchOpenAIPricing } from './openai.js';
export { fetchAlibabaPricing } from './alibaba.js';
export { fetchMetaPricing } from './meta.js';
export { fetchMicrosoftPricing } from './microsoft.js';

const SCRAPER_TIMEOUT_MS = Number(process.env.PRICING_SCRAPER_TIMEOUT_MS || 20000);

function withTimeout(promise, provider, timeoutMs = SCRAPER_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${provider} scraper timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    })
  ]);
}

/**
 * Fetch all provider pricing
 * @returns {Promise<Object>} Object keyed by provider with pricing arrays
 */
export async function fetchAllPricing() {
  const providers = [
    ['anthropic', fetchAnthropicPricing],
    ['google', fetchGooglePricing],
    ['deepseek', fetchDeepSeekPricing],
    ['moonshot', fetchMoonshotPricing],
    ['openai', fetchOpenAIPricing],
    ['alibaba', fetchAlibabaPricing],
    ['meta', fetchMetaPricing],
    ['microsoft', fetchMicrosoftPricing]
  ];

  const settled = await Promise.allSettled(
    providers.map(async ([provider, fetchFn]) => {
      const data = await withTimeout(Promise.resolve(fetchFn()), provider);
      return [provider, Array.isArray(data) ? data : []];
    })
  );

  const results = {};
  for (let i = 0; i < settled.length; i += 1) {
    const provider = providers[i][0];
    const result = settled[i];
    if (result.status === 'fulfilled') {
      results[provider] = result.value[1];
    } else {
      console.error(`Failed to fetch ${provider} pricing:`, result.reason?.message || String(result.reason));
      results[provider] = [];
    }
  }

  return results;
}

/**
 * Get pricing for a specific model
 * @param {string} modelId - Full model identifier (e.g., 'claude-haiku-4-5-20251001')
 * @returns {Promise<Object|null>} Pricing object or null if not found
 */
export async function getModelPricing(modelId) {
  const allPricing = await fetchAllPricing();
  
  for (const provider in allPricing) {
    const prices = allPricing[provider];
    if (!prices) continue;
    
    const modelPrice = prices.find(p => p.model === modelId);
    if (modelPrice) {
      return {
        ...modelPrice,
        provider
      };
    }
  }
  
  return null;
}

export default {
  fetchAllPricing,
  getModelPricing
};
