/**
 * Anthropic pricing scraper tests
 */

import { fetchAnthropicPricing } from '../../src/pricing/anthropic.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const CACHE_FILE = join(__dirname, '../../data/pricing-cache.json');

// Mock fetch for testing
let originalFetch;
let mockFetch;

beforeEach(() => {
  // Save original fetch
  originalFetch = globalThis.fetch;
  
  // Create mock fetch
  mockFetch = jest.fn();
  globalThis.fetch = mockFetch;
});

afterEach(() => {
  // Restore original fetch
  globalThis.fetch = originalFetch;
  
  // Clean up cache file if it exists
  try {
    if (existsSync(CACHE_FILE)) {
      require('fs').unlinkSync(CACHE_FILE);
    }
  } catch (error) {
    // Ignore cleanup errors
  }
});

describe('fetchAnthropicPricing', () => {
  test('returns array of pricing objects', async () => {
    // Mock successful response with minimal HTML
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => '<html><body>Pricing page</body></html>'
    });
    
    const prices = await fetchAnthropicPricing();
    
    expect(Array.isArray(prices)).toBe(true);
    expect(prices.length).toBeGreaterThan(0);
    
    // Check structure of first item
    const firstPrice = prices[0];
    expect(firstPrice).toHaveProperty('model');
    expect(firstPrice).toHaveProperty('inputPerM');
    expect(firstPrice).toHaveProperty('outputPerM');
    expect(typeof firstPrice.model).toBe('string');
    expect(typeof firstPrice.inputPerM).toBe('number');
    expect(typeof firstPrice.outputPerM).toBe('number');
  });
  
  test('includes expected Anthropic models', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => '<html><body>Pricing</body></html>'
    });
    
    const prices = await fetchAnthropicPricing();
    const modelNames = prices.map(p => p.model);
    
    // Should include at least these models
    expect(modelNames).toContain('claude-haiku-4-5-20251001');
    expect(modelNames).toContain('claude-sonnet-4-6');
    expect(modelNames).toContain('claude-opus-4-6');
  });
  
  test('handles network errors gracefully', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));
    
    // Should still return prices (hardcoded fallback)
    const prices = await fetchAnthropicPricing();
    expect(Array.isArray(prices)).toBe(true);
    expect(prices.length).toBeGreaterThan(0);
  });
  
  test('handles HTTP errors gracefully', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found'
    });
    
    // Should still return prices (fallback)
    const prices = await fetchAnthropicPricing();
    expect(Array.isArray(prices)).toBe(true);
  });
  
  test('caches results', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => '<html><body>Pricing</body></html>'
    });
    
    // First call should fetch
    await fetchAnthropicPricing();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    
    // Reset mock to track second call
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => '<html><body>Pricing</body></html>'
    });
    
    // Second call within cache TTL should use cache
    await fetchAnthropicPricing();
    expect(mockFetch).toHaveBeenCalledTimes(0);
  });
});

describe('pricing structure', () => {
  test('prices are reasonable numbers', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => '<html><body>Pricing</body></html>'
    });
    
    const prices = await fetchAnthropicPricing();
    
    for (const price of prices) {
      // Input prices should be less than output prices
      expect(price.inputPerM).toBeLessThan(price.outputPerM);
      
      // Prices should be positive
      expect(price.inputPerM).toBeGreaterThan(0);
      expect(price.outputPerM).toBeGreaterThan(0);
      
      // Prices should be reasonable (not millions)
      expect(price.inputPerM).toBeLessThan(100);
      expect(price.outputPerM).toBeLessThan(500);
    }
  });
});