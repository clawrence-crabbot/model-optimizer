/**
 * Moonshot pricing (static table)
 */

/**
 * @returns {Promise<Array<{model: string, inputPerM: number, outputPerM: number, contextWindow?: number, vision: boolean, cache: boolean, cacheHitInputPerM?: number, cacheMissInputPerM?: number}>>}
 */
export async function fetchMoonshotPricing() {
  return [
    {
      model: 'moonshot/kimi-k2.5',
      inputPerM: 0.60,
      outputPerM: 3.00,
      vision: true,
      cache: false
    },
    {
      model: 'moonshot/kimi-k2',
      inputPerM: 0.60,
      outputPerM: 2.50,
      vision: true,
      cache: true,
      cacheReadPerM: 0.15,
      cacheWritePerM: 0.60,
      cacheHitInputPerM: 0.15,
      cacheMissInputPerM: 0.60
    }
  ];
}

export default {
  fetchMoonshotPricing
};
