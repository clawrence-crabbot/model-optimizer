/**
 * Meta pricing (static table)
 */

/**
 * @returns {Promise<Array<{model: string, inputPerM: number, outputPerM: number, contextWindow?: number, vision: boolean, cache: boolean, computeCost?: boolean}>>}
 */
export async function fetchMetaPricing() {
  return [
    {
      model: 'meta/llama-3.3-70b',
      inputPerM: 0,
      outputPerM: 0,
      vision: false,
      cache: false,
      computeCost: true
    },
    {
      model: 'meta/llama-3.3-8b',
      inputPerM: 0,
      outputPerM: 0,
      vision: false,
      cache: false,
      computeCost: true
    }
  ];
}

export default {
  fetchMetaPricing
};
