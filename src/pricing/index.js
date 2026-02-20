/**
 * Pricing module index
 * Exports all provider scrapers
 */

export { fetchAnthropicPricing } from './anthropic.js';

// TODO: Add other providers
// export { fetchGooglePricing } from './google.js';
// export { fetchDeepSeekPricing } from './deepseek.js';
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
  
  // Add other providers as implemented
  // try {
  //   const { fetchGooglePricing } = await import('./google.js');
  //   results.google = await fetchGooglePricing();
  // } catch (error) {
  //   console.error('Failed to fetch Google pricing:', error.message);
  //   results.google = null;
  // }
  
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