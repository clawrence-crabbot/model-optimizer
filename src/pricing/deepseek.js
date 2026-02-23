/**
 * DeepSeek pricing scraper
 * Discovers available models first, then scrapes live DeepSeek pricing
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';

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
const DEEPSEEK_MODELS_ENDPOINT = 'https://api.deepseek.com/v1/models';
const DEEPSEEK_PRICING_URL = 'https://api-docs.deepseek.com/quick_start/pricing-details-usd';

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
    const discoveredModels = await discoverDeepSeekModels();
    console.log(`DeepSeek model discovery: ${discoveredModels.length} model(s)`);

    const response = await fetch(DEEPSEEK_PRICING_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ModelOptimizer/1.0; +https://github.com/openclaw/model-optimizer)'
      },
      timeout: 10000
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const html = await response.text();
    const scrapedPrices = parseDeepSeekPricingHTML(html);
    const prices = attachPricingToDiscoveredModels(discoveredModels, scrapedPrices);
    
    if (prices.length > 0) {
      console.log(`Successfully parsed ${prices.length} DeepSeek models from pricing page`);
      return prices;
    }
  } catch (error) {
    console.warn('Failed to fetch DeepSeek pricing:', error.message);
  }
  
  // Return fallback pricing if scraping fails
  return getFallbackPricing();
}

function parseDeepSeekPricingHTML(html) {
  const $ = cheerio.load(html);
  const tablePrices = parsePricingDetailsTable($);
  if (tablePrices.length > 0) return tablePrices;

  const fullText = $('body').text().replace(/\s+/g, ' ');

  // Fallback parse: docs may expose generic rates without per-model rows.
  const cacheHit = extractDollar(fullText, /1M INPUT TOKENS\s*\(CACHE HIT\)\s*\$([0-9]+(?:\.[0-9]+)?)/i);
  const cacheMiss = extractDollar(fullText, /1M INPUT TOKENS\s*\(CACHE MISS\)\s*\$([0-9]+(?:\.[0-9]+)?)/i);
  const output = extractDollar(fullText, /1M OUTPUT TOKENS\s*\$([0-9]+(?:\.[0-9]+)?)/i);

  if (cacheHit == null || cacheMiss == null || output == null) {
    throw new Error('Could not parse DeepSeek pricing values from docs');
  }

  return [
    {
      model: 'deepseek/deepseek-chat',
      inputPerM: cacheMiss,
      outputPerM: output,
      contextWindow: 128000,
      vision: false,
      cache: true,
      cacheHitInputPerM: cacheHit,
      cacheMissInputPerM: cacheMiss
    },
    {
      model: 'deepseek/deepseek-reasoner',
      inputPerM: cacheMiss,
      outputPerM: output,
      contextWindow: 128000,
      vision: false,
      cache: true,
      cacheHitInputPerM: cacheHit,
      cacheMissInputPerM: cacheMiss
    }
  ];
}

function parsePricingDetailsTable($) {
  const models = new Map();
  $('table tr').each((_, row) => {
    const cells = $(row)
      .find('th, td')
      .map((__, cell) => $(cell).text().trim())
      .get();

    if (cells.length < 7) return;
    const label = String(cells[0] || '').toLowerCase();
    if (label === 'model' || label.includes('model')) return;

    const isChat = label.includes('deepseek-chat');
    const isReasoner = label.includes('deepseek-reasoner');
    if (!isChat && !isReasoner) return;

    const cacheHit = parsePrice(cells[4]);
    const cacheMiss = parsePrice(cells[5]);
    const output = parsePrice(cells[6]);
    if (cacheHit == null || cacheMiss == null || output == null) return;

    const model = isReasoner ? 'deepseek/deepseek-reasoner' : 'deepseek/deepseek-chat';
    models.set(model, {
      model,
      inputPerM: cacheMiss,
      outputPerM: output,
      contextWindow: 128000,
      vision: false,
      cache: true,
      cacheHitInputPerM: cacheHit,
      cacheMissInputPerM: cacheMiss
    });
  });

  return [...models.values()];
}

function parsePrice(text) {
  const match = String(text).replace(/,/g, '').match(/([0-9]+(?:\.[0-9]+)?)/);
  return match ? Number.parseFloat(match[1]) : null;
}

function extractDollar(text, regex) {
  const match = String(text).match(regex);
  return match ? Number.parseFloat(match[1]) : null;
}

async function discoverDeepSeekModels() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return [];

  try {
    const response = await fetch(DEEPSEEK_MODELS_ENDPOINT, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': 'Mozilla/5.0 (compatible; ModelOptimizer/1.0; +https://github.com/openclaw/model-optimizer)'
      },
      timeout: 10000
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const json = await response.json();
    const list = Array.isArray(json.data) ? json.data : [];
    const discovered = [];
    for (const model of list) {
      const normalized = normalizeDeepSeekModelId(model?.id);
      if (normalized) discovered.push(normalized);
    }
    return [...new Set(discovered)];
  } catch (error) {
    console.warn('DeepSeek model discovery failed:', error.message);
    return [];
  }
}

function normalizeDeepSeekModelId(id) {
  if (!id) return null;
  const name = String(id).trim().toLowerCase();
  if (!name.startsWith('deepseek-')) return null;
  return `deepseek/${name}`;
}

function attachPricingToDiscoveredModels(discoveredModels, scrapedPrices) {
  if (!Array.isArray(discoveredModels) || discoveredModels.length === 0) {
    return scrapedPrices;
  }

  const mapped = [];
  for (const model of discoveredModels) {
    const direct = scrapedPrices.find(entry => entry.model === model);
    if (direct) {
      mapped.push({ ...direct, model });
      continue;
    }

    const fallback = mapDiscoveredToDeepSeekPrice(model, scrapedPrices);
    if (fallback) {
      mapped.push({
        ...fallback,
        model
      });
    }
  }

  return mapped.length > 0 ? dedupeByModel(mapped) : scrapedPrices;
}

function mapDiscoveredToDeepSeekPrice(model, scrapedPrices) {
  const name = model.replace(/^deepseek\//, '');
  const reasoner = scrapedPrices.find(entry => entry.model === 'deepseek/deepseek-reasoner');
  const chat = scrapedPrices.find(entry => entry.model === 'deepseek/deepseek-chat');

  if (name.includes('reasoner') || name.includes('-r1')) return reasoner || chat || null;
  if (name.includes('chat') || name.includes('-v3')) return chat || reasoner || null;
  return chat || reasoner || null;
}

function dedupeByModel(prices) {
  const map = new Map();
  for (const entry of prices) map.set(entry.model, entry);
  return [...map.values()];
}

/**
 * Get fallback pricing (hardcoded values)
 * @returns {Array} Array of pricing objects
 */
function getFallbackPricing({ logWarning = true } = {}) {
  if (logWarning) {
    console.warn('Using fallback DeepSeek pricing (scraping failed)');
  }

  return [
    {
      model: 'deepseek/deepseek-chat',
      inputPerM: 0.27,
      outputPerM: 1.1,
      contextWindow: 128000,
      vision: false,
      cache: true,
      cacheHitInputPerM: 0.07,
      cacheMissInputPerM: 0.27,
      note: 'Fallback pricing from DeepSeek docs (pricing-details-usd)'
    },
    {
      model: 'deepseek/deepseek-reasoner',
      inputPerM: 0.55,
      outputPerM: 2.19,
      contextWindow: 128000,
      vision: false,
      cache: true,
      cacheHitInputPerM: 0.14,
      cacheMissInputPerM: 0.55,
      note: 'Fallback pricing from DeepSeek docs (pricing-details-usd)'
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
  const required = getFallbackPricing({ logWarning: false });
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
    writeCache('deepseek', extended, 'api-docs.deepseek.com/quick_start/pricing-details-usd');
    
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
