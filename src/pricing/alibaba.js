/**
 * Alibaba pricing (static table)
 */

/**
 * @returns {Promise<Array<{model: string, inputPerM: number, outputPerM: number, contextWindow?: number, vision: boolean, cache: boolean, free?: boolean}>>}
 */
export async function fetchAlibabaPricing() {
  return [
    {
      model: 'alibaba/qwen2.5-max',
      inputPerM: 0.75,
      outputPerM: 3.00,
      vision: true,
      cache: true
    },
    {
      model: 'alibaba/qwen2.5-plus',
      inputPerM: 0.25,
      outputPerM: 1.00,
      vision: true,
      cache: true
    },
    {
      model: 'alibaba/qwen2.5-7b',
      inputPerM: 0,
      outputPerM: 0,
      vision: true,
      cache: false,
      free: true
    }
  ];
}

export default {
  fetchAlibabaPricing
};
