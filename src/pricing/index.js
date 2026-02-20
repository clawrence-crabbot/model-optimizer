/**
 * Pricing module index
 * Exports all provider scrapers
 */

export { fetchAnthropicPricing } from './anthropic.js';
export { fetchGooglePricing } from './google.js';
export { fetchDeepSeekPricing } from './deepseek.js';

// TODO: Add other providers
// export { fetchOpenAIPricing } from './openai.js';

/**
 * Fetch all provider pricing
 * @returns {Promise<Object>} Object keyed by provider with pricing arrays
 */
export async function fetchAllPricing() {
  const results = {};
  
  try {
    const { fetchAnthropicPricing } = await import('./anthropic.js');
    results.anthropic = await fetchAnthropicPricing();
  } catch (error) {
    console.error('Failed to fetch Anthropic pricing:', error.message);
    results.anthropic = null;
  }
  
  try {
    const { fetchGooglePricing } = await import('./google.js');
    results.google = await fetchGooglePricing();
  } catch (error) {
    console.error('Failed to fetch Google pricing:', error.message);
    results.google = null;
  }
  
  // Add other providers as implemented
  try {
    const { fetchDeepSeekPricing } = await import('./deepseek.js');
    results.deepseek = await fetchDeepSeekPricing();
  } catch (error) {
    console.error('Failed to fetch DeepSeek pricing:', error.message);
    results.deepseek = null;
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