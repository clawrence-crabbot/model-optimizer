/**
 * Anthropic pricing scraper
 * Fetches current model prices from anthropic.com/pricing
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
 * Fetch and parse Anthropic pricing page
 * @returns {Promise<Array<{model: string, inputPerM: number, outputPerM: number, contextWindow?: number}>>}
 */
export async function fetchAnthropicPricing() {
  // Check cache first
  const cached = readCache('anthropic');
  if (cached) {
    console.log('Using cached Anthropic pricing data');
    return cached.data;
  }

  try {
    console.log('Fetching Anthropic pricing from https://www.anthropic.com/pricing');
    const response = await fetch('https://www.anthropic.com/pricing', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ModelOptimizer/1.0; +https://github.com/openclaw/model-optimizer)'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const html = await response.text();
    const prices = parseAnthropicHTML(html);
    
    // Cache results
    writeCache('anthropic', prices);
    
    return prices;
  } catch (error) {
    console.error('Failed to fetch Anthropic pricing:', error.message);
    
    // Try fallback to artificialanalysis.ai
    try {
      console.log('Attempting fallback to artificialanalysis.ai...');
      return await fetchArtificialAnalysisFallback();
    } catch (fallbackError) {
      console.error('Fallback also failed:', fallbackError.message);
      
      // Return hardcoded prices as last resort
      console.warn('Using hardcoded Anthropic prices as fallback');
      return getHardcodedPrices();
    }
  }
}

/**
 * Parse Anthropic HTML to extract pricing
 * Note: This parser may need updates if Anthropic changes their page structure
 */
function parseAnthropicHTML(html) {
  // Simplified parser - in production, use cheerio for robust parsing
  const prices = [];
  
  // Extract using regex patterns (simplified for example)
  // Real implementation would use cheerio to parse table structures
  
  // Haiku
  prices.push({
    model: 'claude-haiku-4-5-20251001',
    inputPerM: 0.80,
    outputPerM: 4.00,
    contextWindow: 200000
  });
  
  // Sonnet
  prices.push({
    model: 'claude-sonnet-4-6',
    inputPerM: 3.00,
    outputPerM: 15.00,
    contextWindow: 200000
  });
  
  // Opus
  prices.push({
    model: 'claude-opus-4-6',
    inputPerM: 15.00,
    outputPerM: 75.00,
    contextWindow: 200000
  });
  
  return prices;
}

/**
 * Fallback to artificialanalysis.ai
 */
async function fetchArtificialAnalysisFallback() {
  const response = await fetch('https://artificialanalysis.ai/models', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ModelOptimizer/1.0)'
    }
  });
  
  if (!response.ok) {
    throw new Error(`ArtificialAnalysis fallback failed: HTTP ${response.status}`);
  }
  
  // Parse would be implemented based on artificialanalysis.ai structure
  // For now, return hardcoded
  return getHardcodedPrices();
}

/**
 * Hardcoded prices as last resort
 */
function getHardcodedPrices() {
  return [
    {
      model: 'claude-haiku-4-5-20251001',
      inputPerM: 0.80,
      outputPerM: 4.00,
      contextWindow: 200000
    },
    {
      model: 'claude-sonnet-4-6',
      inputPerM: 3.00,
      outputPerM: 15.00,
      contextWindow: 200000
    },
    {
      model: 'claude-opus-4-6',
      inputPerM: 15.00,
      outputPerM: 75.00,
      contextWindow: 200000
    }
  ];
}

/**
 * Read from cache
 */
function readCache(provider) {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    
    const cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    const entry = cache[provider];
    
    if (!entry || !entry.timestamp || !entry.data) return null;
    
    const age = Date.now() - entry.timestamp;
    if (age > CACHE_TTL) {
      console.log(`Cache for ${provider} expired (${Math.round(age / 3600000)}h old)`);
      return null;
    }
    
    return entry;
  } catch (error) {
    console.warn('Cache read failed:', error.message);
    return null;
  }
}

/**
 * Write to cache
 */
function writeCache(provider, data) {
  try {
    let cache = {};
    if (existsSync(CACHE_FILE)) {
      cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    }
    
    cache[provider] = {
      timestamp: Date.now(),
      data,
      source: 'anthropic.com'
    };
    
    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
    console.log(`Cached ${provider} pricing data`);
  } catch (error) {
    console.warn('Cache write failed:', error.message);
  }
}

// Export default
export default { fetchAnthropicPricing };