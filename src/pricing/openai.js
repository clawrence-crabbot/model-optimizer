/**
 * OpenAI pricing (static table)
 */

/**
 * @returns {Promise<Array<{model: string, inputPerM: number, outputPerM: number, contextWindow?: number, vision: boolean, cache: boolean}>>}
 */
export async function fetchOpenAIPricing() {
  return [
    {
      model: 'openai/gpt-4.1',
      inputPerM: 7.50,
      outputPerM: 22.50,
      vision: false,
      cache: true
    },
    {
      model: 'openai/gpt-4o',
      inputPerM: 5.00,
      outputPerM: 15.00,
      vision: true,
      cache: true
    },
    {
      model: 'openai/gpt-4o-mini',
      inputPerM: 0.15,
      outputPerM: 0.60,
      vision: true,
      cache: true
    }
  ];
}

export default {
  fetchOpenAIPricing
};
