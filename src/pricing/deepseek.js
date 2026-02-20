/**
 * DeepSeek pricing scraper
 * Fetches current model prices from DeepSeek pricing page
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

// Use dynamic import for node-fetch (ESM compatibility)
let fetch;
try {
  fetch = (await import('node-fetch')).default;
} catch {
  // Fallback to global fetch if available
  fetch = globalThis.fetch || (() => {
    throw new Error('Fetch not available. Install node-fetch or use web_fetch tool.');
  });
}

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const CACHE_FILE = join(__dirname, '../../data/pricing-cache.json');
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Read from cache
 * @param {string} provider - Provider name (e.g., 'deepseek')
 * @returns {Object|null} Cached data or null if not found/expired
 */
function readCache(provider) {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    
    const cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    const entry = cache[provider];
    
    if (!entry) return null;
    
    const age = Date.now() - entry.timestamp;
    if (age > CACHE_TTL) {
      console.log(`Cache expired for ${provider} (${Math.round(age / 3600000)} hours old)`);
      return null;
    }
    
    return entry;
  } catch (error) {
    console.warn(`Failed to read cache for ${provider}:`, error.message);
    return null;
  }
}

/**
 * Write to cache
 * @param {string} provider - Provider name
 * @param {Array} data - Pricing data
 * @param {string} source - Data source (e.g., 'deepseek.com')
 */
function writeCache(provider, data, source) {
  try {
    let cache = {};
    if (existsSync(CACHE_FILE)) {
      cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    }
    
    cache[provider] = {
      timestamp: Date.now(),
      data,
      source
    };
    
    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (error) {
    console.warn(`Failed to write cache for ${provider}:`, error.message);
  }
}

/**
 * Fetch DeepSeek pricing from official sources
 * @returns {Promise<Array>} Array of pricing objects
 */
async function fetchFromSource() {
  console.log('Fetching DeepSeek pricing from official sources...');
  
  try {
    // Try DeepSeek pricing page first
    const response = await fetch('https://api-docs.deepseek.com/pricing', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ModelOptimizer/1.0; +https://github.com/openclaw/model-optimizer)'
      },
      timeout: 10000
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const html = await response.text();
    
    // Parse HTML for pricing information
    // This is a simplified parser - actual implementation would need to adapt to DeepSeek's page structure
    const prices = [];
    
    // Look for DeepSeek Chat pricing
    const chatMatch = html.match(/DeepSeek Chat.*?\$(\d+\.?\d*).*?\$(\d+\.?\d*)/i);
    if (chatMatch) {
      prices.push({
        model: 'deepseek/deepseek-chat',
        inputPerM: parseFloat(chatMatch[1]),
        outputPerM: parseFloat(chatMatch[2]),
        contextWindow: 128000 // Default context window
      });
    }
    
    // Look for DeepSeek Reasoner pricing
    const reasonerMatch = html.match(/DeepSeek Reasoner.*?\$(\d+\.?\d*).*?\$(\d+\.?\d*)/i);
    if (reasonerMatch) {
      prices.push({
        model: 'deepseek/deepseek-reasoner',
        inputPerM: parseFloat(reasonerMatch[1]),
        outputPerM: parseFloat(reasonerMatch[2]),
        contextWindow: 128000 // Default context window
      });
    }
    
    if (prices.length > 0) {
      console.log(`Successfully parsed ${prices.length} DeepSeek models from pricing page`);
      return prices;
    }
    
    // If parsing failed, try API endpoint
    console.log('HTML parsing failed, trying API endpoint...');
    const apiResponse = await fetch('https://api.deepseek.com/v1/models', {
      headers: {
        'Authorization': 'Bearer dummy', // Will fail but might give us rate limit info
        'User-Agent': 'ModelOptimizer/1.0'
      },
      timeout: 5000
    });
    
    // Even if API fails, we'll use fallback pricing
    console.log('API response status:', apiResponse.status);
    
  } catch (error) {
    console.warn('Failed to fetch DeepSeek pricing:', error.message);
  }
  
  // Return fallback pricing if scraping fails
  return getFallbackPricing();
}

/**
 * Get fallback pricing (hardcoded values)
 * @returns {Array} Array of pricing objects
 */
function getFallbackPricing() {
  console.warn('Using fallback DeepSeek pricing (scraping failed)');
  
  return [
    {
      model: 'deepseek/deepseek-chat',
      inputPerM: 0.07,
      outputPerM: 1.10,
      contextWindow: 128000,
      vision: false,
      cache: false,
      note: 'Fallback pricing from TOOLS.md'
    },
    {
      model: 'deepseek/deepseek-reasoner',
      inputPerM: 0.07,
      outputPerM: 1.10,
      contextWindow: 128000,
      vision: false,
      cache: false,
      note: 'Fallback pricing (same as Chat)'
    },
    {
      model: 'deepseek/deepseek-v3',
      inputPerM: 0.80,
      outputPerM: 1.60,
      contextWindow: 128000,
      vision: false,
      cache: true
    },
    {
      model: 'deepseek/deepseek-r1',
      inputPerM: 0.80,
      outputPerM: 1.60,
      contextWindow: 128000,
      vision: false,
      cache: true
    },
    {
      model: 'deepseek/deepseek-r1-distill',
      inputPerM: 0,
      outputPerM: 0,
      contextWindow: 128000,
      vision: false,
      cache: false,
      free: true
    }
  ];
}

function ensureExtendedDeepSeekModels(prices) {
  const required = getFallbackPricing();
  const merged = [...prices];
  for (const model of required) {
    if (!merged.find(entry => entry.model === model.model)) {
      merged.push(model);
    }
  }
  return merged;
}

/**
 * Fetch DeepSeek pricing with caching
 * @returns {Promise<Array>} Array of pricing objects
 */
export async function fetchDeepSeekPricing() {
  // Check cache first
  const cached = readCache('deepseek');
  if (cached) {
    console.log('Using cached DeepSeek pricing data');
    return ensureExtendedDeepSeekModels(cached.data);
  }
  
  try {
    // Fetch from source
    const prices = await fetchFromSource();
    
    // Cache the results
    const extended = ensureExtendedDeepSeekModels(prices);
    writeCache('deepseek', extended, 'deepseek.com + fallback');
    
    return extended;
  } catch (error) {
    console.error('Failed to fetch DeepSeek pricing:', error.message);
    
    // Return fallback pricing even if everything fails
    const fallback = ensureExtendedDeepSeekModels(getFallbackPricing());
    writeCache('deepseek', fallback, 'fallback (fetch failed)');
    return fallback;
  }
}

export default {
  fetchDeepSeekPricing
};
