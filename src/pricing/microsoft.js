/**
 * Microsoft pricing (static table)
 */

/**
 * @returns {Promise<Array<{model: string, inputPerM: number, outputPerM: number, contextWindow?: number, vision: boolean, cache: boolean, free?: boolean}>>}
 */
export async function fetchMicrosoftPricing() {
  return [
    {
      model: 'microsoft/phi-4-mini',
      inputPerM: 0,
      outputPerM: 0,
      vision: false,
      cache: false,
      free: true
    }
  ];
}

export default {
  fetchMicrosoftPricing
};
