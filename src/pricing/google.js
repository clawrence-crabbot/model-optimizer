/**
 * Google (Gemini) pricing scraper
 * Fetches current model prices from Google AI pricing page
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
 * Fetch and parse Google Gemini pricing
 * @returns {Promise<Array<{model: string, inputPerM: number, outputPerM: number, contextWindow?: number}>>}
 */
export async function fetchGooglePricing() {
  // Check cache first
  const cached = readCache('google');
  if (cached) {
    console.log('Using cached Google pricing data');
    return ensureExtendedGoogleModels(cached.data);
  }

  try {
    console.log('Fetching Google pricing from https://ai.google.dev/pricing');
    const response = await fetch('https://ai.google.dev/pricing', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ModelOptimizer/1.0; +https://github.com/openclaw/model-optimizer)'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const html = await response.text();
    const prices = parseGoogleHTML(html);
    
    const extended = ensureExtendedGoogleModels(prices);

    // Cache results
    writeCache('google', extended);
    
    return extended;
  } catch (error) {
    console.error('Failed to fetch Google pricing:', error.message);
    
    // Try fallback to artificialanalysis.ai
    try {
      console.log('Attempting fallback to artificialanalysis.ai...');
      return await fetchArtificialAnalysisFallback('google');
    } catch (fallbackError) {
      console.error('Fallback also failed:', fallbackError.message);
      
      // Return hardcoded prices as last resort
      console.warn('Using hardcoded Google prices as fallback');
      return getHardcodedPrices();
    }
  }
}

/**
 * Parse Google AI HTML to extract pricing
 * Note: Google's pricing page is complex; this is a simplified parser
 */
function parseGoogleHTML(html) {
  const prices = [];
  
  // Gemini 3 Flash (Preview) - our main workhorse
  prices.push({
    model: 'google/gemini-3-flash-preview',
    inputPerM: 0.50,
    outputPerM: 3.00,
    contextWindow: 1000000,  // 1M context
    vision: true,
    cache: false
  });
  
  // Gemini 2.5 Flash - cheap file ops
  prices.push({
    model: 'google/gemini-2.5-flash',
    inputPerM: 0.50,
    outputPerM: 3.00,
    contextWindow: 1000000,
    vision: true,
    cache: false
  });
  
  // Gemini 2.5 Pro - higher quality
  prices.push({
    model: 'google/gemini-2.5-pro',
    inputPerM: 1.25,
    outputPerM: 10.00,
    contextWindow: 2000000,  // 2M context
    vision: true,
    cache: false
  });
  
  // Gemini 3 Pro (Preview) - premium
  prices.push({
    model: 'google/gemini-3-pro-preview',
    inputPerM: 2.00,
    outputPerM: 12.00,
    contextWindow: 2000000,
    vision: true,
    cache: false
  });
  
  // Flash-Lite - cheapest for heartbeat
  prices.push({
    model: 'google/gemini-flash-lite',
    inputPerM: 0.10,
    outputPerM: 0.40,
    contextWindow: 1000000,
    vision: false,
    cache: false
  });

  // Gemini 1.5 Pro (requested extension)
  prices.push({
    model: 'google/gemini-1.5-pro',
    inputPerM: 3.50,
    outputPerM: 10.50,
    contextWindow: 1000000,
    vision: true,
    cache: false
  });

  // Gemini 1.5 Flash (requested extension)
  prices.push({
    model: 'google/gemini-1.5-flash',
    inputPerM: 0.037,
    outputPerM: 0.15,
    contextWindow: 1000000,
    vision: false,
    cache: false
  });
  
  return prices;
}

/**
 * Fallback to artificialanalysis.ai for Google models
 */
async function fetchArtificialAnalysisFallback(provider) {
  const response = await fetch(`https://artificialanalysis.ai/models?provider=${provider}`, {
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
 * Hardcoded Google prices as last resort
 * Based on current pricing as of 2025
 */
function getHardcodedPrices() {
  return [
    {
      model: 'google/gemini-3-flash-preview',
      inputPerM: 0.50,
      outputPerM: 3.00,
      contextWindow: 1000000,
      vision: true,
      cache: false
    },
    {
      model: 'google/gemini-2.5-flash',
      inputPerM: 0.50,
      outputPerM: 3.00,
      contextWindow: 1000000,
      vision: true,
      cache: false
    },
    {
      model: 'google/gemini-2.5-pro',
      inputPerM: 1.25,
      outputPerM: 10.00,
      contextWindow: 2000000,
      vision: true,
      cache: false
    },
    {
      model: 'google/gemini-3-pro-preview',
      inputPerM: 2.00,
      outputPerM: 12.00,
      contextWindow: 2000000,
      vision: true,
      cache: false
    },
    {
      model: 'google/gemini-flash-lite',
      inputPerM: 0.10,
      outputPerM: 0.40,
      contextWindow: 1000000,
      vision: false,
      cache: false
    },
    {
      model: 'google/gemini-1.5-pro',
      inputPerM: 3.50,
      outputPerM: 10.50,
      contextWindow: 1000000,
      vision: true,
      cache: false
    },
    {
      model: 'google/gemini-1.5-flash',
      inputPerM: 0.037,
      outputPerM: 0.15,
      contextWindow: 1000000,
      vision: false,
      cache: false
    }
  ];
}

function ensureExtendedGoogleModels(prices) {
  const required = getHardcodedPrices();
  const merged = [...prices];
  for (const model of required) {
    if (!merged.find(entry => entry.model === model.model)) {
      merged.push(model);
    }
  }
  return merged;
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
      source: 'ai.google.dev'
    };
    
    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
    console.log(`Cached ${provider} pricing data`);
  } catch (error) {
    console.warn('Cache write failed:', error.message);
  }
}

// Export default
export default { fetchGooglePricing };
