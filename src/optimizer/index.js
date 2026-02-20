/**
 * Model Optimizer Algorithm
 * Calculates optimal model routing based on cost-quality trade-offs
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { fetchAllPricing } from '../pricing/index.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const MODEL_LABEL_HINTS = {
  'deepseek chat': 'deepseek/deepseek-chat',
  'deepseek reasoner': 'deepseek/deepseek-reasoner',
  'gemini 3 flash': 'google/gemini-3-flash-preview',
  'gemini 2.5 flash': 'google/gemini-2.5-flash',
  'gemini flash lite': 'google/gemini-flash-lite',
  'gemini 2.5 pro': 'google/gemini-2.5-pro',
  'claude haiku': 'claude-haiku-4-5-20251001',
  'claude sonnet': 'claude-sonnet-4-6',
  'claude opus': 'claude-opus-4-6'
};

/**
 * Quality scores for different model-task combinations
 * Scale: 1-10 (10 = best quality for task)
 */
const QUALITY_SCORES = {
  // Daily Conversation tasks
  'casual-chat': {
    'deepseek/deepseek-chat': 9,
    'deepseek/deepseek-reasoner': 8,
    'google/gemini-flash-lite': 6,
    'google/gemini-3-flash-preview': 7,
    'claude-haiku-4-5-20251001': 8
  },
  'simple-qa': {
    'deepseek/deepseek-chat': 8,
    'deepseek/deepseek-reasoner': 9,
    'google/gemini-flash-lite': 5,
    'google/gemini-3-flash-preview': 7,
    'claude-haiku-4-5-20251001': 8
  },
  
  // Action Tasks
  'browser-operations': {
    'google/gemini-3-flash-preview': 9,
    'google/gemini-2.5-flash': 8,
    'deepseek/deepseek-reasoner': 7,
    'claude-haiku-4-5-20251001': 6
  },
  'exec-commands': {
    'claude-haiku-4-5-20251001': 9,
    'deepseek/deepseek-reasoner': 8,
    'google/gemini-3-flash-preview': 6,
    'claude-sonnet-4-6': 10
  },
  'file-operations': {
    'google/gemini-2.5-flash': 9,
    'google/gemini-flash-lite': 8,
    'deepseek/deepseek-chat': 6,
    'claude-haiku-4-5-20251001': 7
  },
  'web-search-fetch': {
    'google/gemini-3-flash-preview': 9,
    'google/gemini-2.5-flash': 8,
    'deepseek/deepseek-reasoner': 7,
    'claude-haiku-4-5-20251001': 6
  },
  'process-management': {
    'claude-haiku-4-5-20251001': 9,
    'deepseek/deepseek-reasoner': 8,
    'google/gemini-3-flash-preview': 6
  },
  'github-cli': {
    'claude-haiku-4-5-20251001': 9,
    'deepseek/deepseek-reasoner': 8,
    'google/gemini-3-flash-preview': 5
  },
  'sub-agent-coordination': {
    'claude-haiku-4-5-20251001': 9,
    'deepseek/deepseek-reasoner': 8,
    'google/gemini-3-flash-preview': 6
  },
  'multi-step-planning': {
    'deepseek/deepseek-reasoner': 9,
    'claude-haiku-4-5-20251001': 8,
    'claude-sonnet-4-6': 10,
    'google/gemini-3-pro-preview': 7
  },
  'requirements-engineering': {
    'deepseek/deepseek-reasoner': 9,
    'claude-haiku-4-5-20251001': 8,
    'claude-sonnet-4-6': 10,
    'google/gemini-2.5-pro': 7
  },
  'calendar-email-checking': {
    'claude-haiku-4-5-20251001': 9,
    'deepseek/deepseek-reasoner': 8,
    'google/gemini-3-flash-preview': 7
  },
  'research-synthesis': {
    'google/gemini-3-flash-preview': 9,
    'google/gemini-2.5-pro': 8,
    'deepseek/deepseek-reasoner': 7,
    'claude-haiku-4-5-20251001': 6
  },
  'complex-problem-solving': {
    'deepseek/deepseek-reasoner': 9,
    'claude-haiku-4-5-20251001': 8,
    'claude-sonnet-4-6': 10,
    'google/gemini-3-pro-preview': 7
  },
  'analysis-breakdowns': {
    'deepseek/deepseek-reasoner': 9,
    'claude-haiku-4-5-20251001': 8,
    'claude-sonnet-4-6': 10,
    'google/gemini-2.5-pro': 7
  },
  
  // Escalation tasks
  'code-changes': {
    'claude-haiku-4-5-20251001': 8,
    'claude-sonnet-4-6': 10,
    'deepseek/deepseek-reasoner': 7,
    'claude-opus-4-6': 9
  },
  'debugging': {
    'claude-haiku-4-5-20251001': 9,
    'deepseek/deepseek-reasoner': 8,
    'claude-sonnet-4-6': 10
  },
  'formatting': {
    'claude-haiku-4-5-20251001': 9,
    'deepseek/deepseek-chat': 7,
    'google/gemini-2.5-flash': 8
  },
  'summaries': {
    'google/gemini-3-flash-preview': 9,
    'google/gemini-2.5-pro': 8,
    'deepseek/deepseek-chat': 7,
    'claude-haiku-4-5-20251001': 6
  },
  'file-edits-cheap': {
    'google/gemini-2.5-flash': 9,
    'google/gemini-flash-lite': 8,
    'deepseek/deepseek-chat': 6
  },
  'file-edits-high-risk': {
    'claude-haiku-4-5-20251001': 9,
    'deepseek/deepseek-reasoner': 8,
    'claude-sonnet-4-6': 10
  }
};

const MODEL_EXPANSION_QUALITY_SCORES = {
  'casual-chat': {
    'openai/gpt-4o-mini': 8,
    'alibaba/qwen2.5-plus': 8,
    'meta/llama-3.3-8b': 7,
    'microsoft/phi-4-mini': 7,
    'alibaba/qwen2.5-7b': 7
  },
  'simple-qa': {
    'openai/gpt-4o-mini': 8,
    'alibaba/qwen2.5-plus': 7,
    'meta/llama-3.3-8b': 7,
    'microsoft/phi-4-mini': 7
  },
  'multi-step-planning': {
    'moonshot/kimi-k2.5': 10,
    'moonshot/kimi-k2': 9,
    'openai/gpt-4.1': 9,
    'openai/gpt-4o': 8,
    'deepseek/deepseek-r1': 9,
    'deepseek/deepseek-v3': 8,
    'alibaba/qwen2.5-max': 8
  },
  'requirements-engineering': {
    'moonshot/kimi-k2.5': 9,
    'openai/gpt-4.1': 9,
    'openai/gpt-4o': 8,
    'anthropic/claude-3.5-sonnet': 9,
    'deepseek/deepseek-r1': 8,
    'alibaba/qwen2.5-max': 8
  },
  'research-synthesis': {
    'moonshot/kimi-k2.5': 9,
    'openai/gpt-4.1': 9,
    'openai/gpt-4o': 9,
    'google/gemini-1.5-pro': 9,
    'google/gemini-1.5-flash': 7,
    'anthropic/claude-3.5-sonnet': 8,
    'alibaba/qwen2.5-max': 8
  },
  'complex-problem-solving': {
    'moonshot/kimi-k2.5': 10,
    'moonshot/kimi-k2': 9,
    'openai/gpt-4.1': 9,
    'deepseek/deepseek-r1': 10,
    'deepseek/deepseek-v3': 8,
    'anthropic/claude-3.5-sonnet': 9,
    'meta/llama-3.3-70b': 8
  },
  'analysis-breakdowns': {
    'moonshot/kimi-k2.5': 9,
    'openai/gpt-4.1': 9,
    'deepseek/deepseek-r1': 9,
    'deepseek/deepseek-r1-distill': 7,
    'anthropic/claude-3.5-sonnet': 8,
    'google/gemini-1.5-pro': 8
  },
  'code-changes': {
    'moonshot/kimi-k2.5': 10,
    'moonshot/kimi-k2': 9,
    'openai/gpt-4.1': 10,
    'openai/gpt-4o': 9,
    'deepseek/deepseek-v3': 9,
    'deepseek/deepseek-r1': 8,
    'deepseek/deepseek-r1-distill': 7,
    'alibaba/qwen2.5-max': 8,
    'meta/llama-3.3-70b': 8
  },
  'debugging': {
    'moonshot/kimi-k2.5': 9,
    'openai/gpt-4.1': 10,
    'openai/gpt-4o': 9,
    'deepseek/deepseek-r1': 9,
    'deepseek/deepseek-v3': 8,
    'anthropic/claude-3.5-sonnet': 9
  },
  'formatting': {
    'openai/gpt-4o-mini': 8,
    'alibaba/qwen2.5-plus': 7,
    'microsoft/phi-4-mini': 7,
    'google/gemini-1.5-flash': 7
  },
  'summaries': {
    'anthropic/claude-3.5-haiku': 9,
    'google/gemini-1.5-flash': 8,
    'openai/gpt-4o-mini': 8,
    'alibaba/qwen2.5-plus': 8
  },
  'file-edits-cheap': {
    'openai/gpt-4o-mini': 8,
    'alibaba/qwen2.5-plus': 8,
    'deepseek/deepseek-r1-distill': 7,
    'microsoft/phi-4-mini': 7,
    'meta/llama-3.3-8b': 7
  },
  'file-edits-high-risk': {
    'moonshot/kimi-k2.5': 9,
    'openai/gpt-4.1': 10,
    'anthropic/claude-3.5-sonnet': 9,
    'deepseek/deepseek-r1': 8
  },
  'vision-tasks': {
    'openai/gpt-4o': 9,
    'openai/gpt-4o-mini': 8,
    'google/gemini-1.5-pro': 9,
    'moonshot/kimi-k2.5': 8,
    'moonshot/kimi-k2': 8,
    'alibaba/qwen2.5-max': 8,
    'alibaba/qwen2.5-plus': 7,
    'alibaba/qwen2.5-7b': 6,
    'anthropic/claude-3.5-sonnet': 8,
    'anthropic/claude-3.5-haiku': 7
  },
  'long-reasoning': {
    'moonshot/kimi-k2.5': 10,
    'moonshot/kimi-k2': 9,
    'deepseek/deepseek-r1': 10,
    'openai/gpt-4.1': 9,
    'google/gemini-1.5-pro': 8,
    'alibaba/qwen2.5-max': 8,
    'meta/llama-3.3-70b': 7
  }
};

for (const [taskType, taskScores] of Object.entries(MODEL_EXPANSION_QUALITY_SCORES)) {
  QUALITY_SCORES[taskType] = {
    ...(QUALITY_SCORES[taskType] || {}),
    ...taskScores
  };
}

// Conservative default model set to prevent aggressive jumps to experimental providers.
const DEFAULT_ALLOWED_MODELS = new Set([
  'deepseek/deepseek-chat',
  'deepseek/deepseek-reasoner',
  'google/gemini-3-flash-preview',
  'google/gemini-2.5-flash',
  'google/gemini-flash-lite',
  'google/gemini-2.5-pro',
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-opus-4-6'
]);

// Bias towards the requested operating mix: more DeepSeek Chat, moderate Reasoner/Flash.
const TASK_MODEL_PREFERENCES = {
  'casual-chat': ['deepseek/deepseek-chat'],
  'simple-qa': ['deepseek/deepseek-chat', 'deepseek/deepseek-reasoner'],
  'multi-step-planning': ['deepseek/deepseek-reasoner'],
  'requirements-engineering': ['deepseek/deepseek-reasoner'],
  'research-synthesis': ['google/gemini-3-flash-preview', 'deepseek/deepseek-chat'],
  'complex-problem-solving': ['deepseek/deepseek-reasoner', 'google/gemini-3-flash-preview'],
  'analysis-breakdowns': ['deepseek/deepseek-reasoner', 'deepseek/deepseek-chat'],
  'summaries': ['google/gemini-3-flash-preview', 'deepseek/deepseek-chat'],
  'code-changes': ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'],
  'debugging': ['claude-haiku-4-5-20251001', 'deepseek/deepseek-reasoner']
};

// Hard pins for sensitive routes so optimizer does not drift without explicit override.
const DEFAULT_PINNED_TASK_MODELS = {
  'simple-qa': 'deepseek/deepseek-chat',
  'code-changes': 'claude-haiku-4-5-20251001'
};

function parseCsvSet(value) {
  if (!value) return null;
  const entries = String(value)
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
  return entries.length > 0 ? new Set(entries) : null;
}

function resolveAllowedModels() {
  if (process.env.MODEL_OPTIMIZER_ALLOW_EXPERIMENTAL === 'true') {
    return null;
  }
  return parseCsvSet(process.env.MODEL_OPTIMIZER_ALLOWED_MODELS) || DEFAULT_ALLOWED_MODELS;
}

function resolvePinnedTaskModels() {
  const raw = process.env.MODEL_OPTIMIZER_PINNED_TASK_MODELS;
  if (!raw) return DEFAULT_PINNED_TASK_MODELS;

  const parsed = {};
  for (const segment of raw.split(';')) {
    const [taskType, model] = segment.split('=').map(v => (v || '').trim());
    if (taskType && model) parsed[taskType] = model;
  }

  return Object.keys(parsed).length > 0 ? parsed : DEFAULT_PINNED_TASK_MODELS;
}

/**
 * Task type mappings from SOUL.md descriptions
 */
export const TASK_TYPE_MAP = {
  // Daily Conversation
  'Casual chat, greetings, jokes': 'casual-chat',
  'Simple Q&A (one-line answers)': 'simple-qa',
  
  // Action Tasks
  'Browser operations': 'browser-operations',
  'Exec commands': 'exec-commands',
  'File operations': 'file-operations',
  'Web search/fetch': 'web-search-fetch',
  'Process management': 'process-management',
  'GitHub CLI': 'github-cli',
  'Sub-agent coordination': 'sub-agent-coordination',
  'Multi-step planning': 'multi-step-planning',
  'Requirements engineering': 'requirements-engineering',
  'Calendar/email checking': 'calendar-email-checking',
  'Research and synthesis': 'research-synthesis',
  'Complex problem-solving': 'complex-problem-solving',
  'Analysis and breakdowns': 'analysis-breakdowns',
  
  // Escalation
  'Code changes': 'code-changes',
  'Debugging': 'debugging',
  'Formatting': 'formatting',
  'Summaries': 'summaries',
  'Vision tasks': 'vision-tasks',
  'Long reasoning': 'long-reasoning',
  'cheap/simple edits use Gemini 2.5 Flash': 'file-edits-cheap',
  'higher risk edits use Haiku': 'file-edits-high-risk'
};

/**
 * Parse SOUL.md routing rules
 * @param {string} soulContent - SOUL.md content
 * @returns {Object} Parsed routing rules
 */
function parseSoulRouting(soulContent) {
  const rules = {
    dailyConversation: [],
    actionTasks: [],
    escalation: []
  };
  
  const lines = soulContent.split('\n');
  let currentSection = null;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Detect sections
    if (trimmed.includes('Daily Conversation Track:')) {
      currentSection = 'dailyConversation';
      continue;
    } else if (trimmed.includes('Action Task Track:')) {
      currentSection = 'actionTasks';
      continue;
    } else if (trimmed.includes('Further escalation:')) {
      currentSection = 'escalation';
      continue;
    }
    
    // Parse rules
    if (currentSection && trimmed.startsWith('-')) {
      const rule = trimmed.substring(1).trim();
      
      if (currentSection === 'dailyConversation') {
        rules.dailyConversation.push(rule);
      } else if (currentSection === 'actionTasks') {
        rules.actionTasks.push(rule);
      } else if (currentSection === 'escalation') {
        rules.escalation.push(rule);
      }
    }
  }
  
  return rules;
}

function normalizeLabel(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9.+\s/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractCurrentModelLabel(ruleText, taskType, description) {
  const text = String(ruleText || '');
  if (taskType === 'code-changes') {
    const m = text.match(/:\s*([^,\n]+?)(?:\s+first)?(?:\s*$|,)/i);
    return m?.[1]?.trim() || null;
  }
  if (taskType === 'file-edits-cheap') {
    const m = text.match(/cheap\/simple edits use\s+([^,\n]+)/i);
    return m?.[1]?.trim() || null;
  }
  if (taskType === 'file-edits-high-risk') {
    const m = text.match(/higher risk edits use\s+([^,\n]+)/i);
    return m?.[1]?.trim() || null;
  }

  if (description) {
    const escaped = description.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(`${escaped}\\s*(?::|→)\\s*([^,\\n]+)`, 'i');
    const m = text.match(rx);
    if (m?.[1]) return m[1].trim();
  }

  const generic = text.match(/(?:→|:)\s*([^,\n]+)/);
  return generic?.[1]?.trim() || null;
}

function resolveModelIdFromLabel(label, models) {
  if (!label) return null;
  const normalized = normalizeLabel(label).replace(/\bfirst\b/g, '').trim();
  if (MODEL_LABEL_HINTS[normalized]) return MODEL_LABEL_HINTS[normalized];

  const byHints = Object.entries(MODEL_LABEL_HINTS).find(([hint]) => normalized.includes(hint));
  if (byHints) return byHints[1];

  const found = models.find(model => normalizeLabel(model.model).includes(normalized));
  return found?.model || null;
}

function buildCurrentRoutingIndex(currentRules, models) {
  const byTaskType = {};
  const groups = [
    ...currentRules.dailyConversation,
    ...currentRules.actionTasks,
    ...currentRules.escalation
  ];

  for (const rule of groups) {
    for (const [description, taskType] of Object.entries(TASK_TYPE_MAP)) {
      if (!rule.includes(description)) continue;
      const label = extractCurrentModelLabel(rule, taskType, description);
      const modelId = resolveModelIdFromLabel(label, models);
      if (modelId) {
        byTaskType[taskType] = modelId;
      }
    }
  }
  return byTaskType;
}

function getModelCostMap(models) {
  const map = {};
  for (const model of models) {
    map[model.model] = calculateModelTotalCost(model);
  }
  return map;
}

/**
 * Calculate optimization score for a model-task combination
 * @param {Object} model - Model pricing data
 * @param {string} taskType - Task type identifier
 * @param {number} qualityWeight - Weight for quality vs cost (0-1)
 * @returns {number} Optimization score (higher is better)
 */
function calculateEffectiveInputPerM(model, cacheHitProbability = 0.5) {
  if (
    model.cache &&
    Number.isFinite(model.cacheHitInputPerM) &&
    Number.isFinite(model.cacheMissInputPerM)
  ) {
    return (
      (cacheHitProbability * model.cacheHitInputPerM) +
      ((1 - cacheHitProbability) * model.cacheMissInputPerM)
    );
  }
  return model.inputPerM;
}

function calculateModelTotalCost(model, cacheHitProbability = 0.5) {
  return calculateEffectiveInputPerM(model, cacheHitProbability) + model.outputPerM;
}

function calculateOptimizationScore(model, taskType, qualityWeight = 0.5, cacheHitProbability = 0.5) {
  const qualityScore = QUALITY_SCORES[taskType]?.[model.model] || 5;
  const totalCost = calculateModelTotalCost(model, cacheHitProbability);
  
  // Normalize cost (lower cost = higher score)
  // Assume max cost is $100/M for normalization
  const normalizedCostScore = Math.max(0, 10 - (totalCost / 10));

  const preferred = TASK_MODEL_PREFERENCES[taskType] || [];
  const preferenceBonus = preferred.includes(model.model) ? 0.8 : 0;

  // Weighted combination + small policy bias.
  return (qualityWeight * qualityScore) + ((1 - qualityWeight) * normalizedCostScore) + preferenceBonus;
}

/**
 * Find optimal model for a task
 * @param {Array} models - Available models with pricing
 * @param {string} taskType - Task type identifier
 * @param {Object} constraints - Optimization constraints
 * @returns {Object|null} Optimal model or null if none found
 */
function findOptimalModel(models, taskType, constraints = {}) {
  const {
    minQuality = 6,
    maxCost = null,
    preferredProviders = [],
    cacheHitProbability = 0.5,
    allowedModels = resolveAllowedModels()
  } = constraints;
  const pinnedTaskModels = resolvePinnedTaskModels();
  
  let candidates = models.filter(model => {
    if (allowedModels && !allowedModels.has(model.model)) return false;
    if (taskType === 'vision-tasks' && !model.vision) return false;

    // Check quality requirement
    const quality = QUALITY_SCORES[taskType]?.[model.model] || 0;
    if (quality < minQuality) return false;
    
    // Check cost constraint
    if (maxCost !== null) {
      const totalCost = calculateModelTotalCost(model, cacheHitProbability);
      if (totalCost > maxCost) return false;
    }

    if (Array.isArray(preferredProviders) && preferredProviders.length > 0) {
      const provider = String(model.model || '').split('/')[0];
      if (!preferredProviders.includes(provider)) return false;
    }
    
    return true;
  });
  
  if (candidates.length === 0) {
    // Relax constraints if no candidates found
    candidates = models;
  }

  const pinnedModelId = pinnedTaskModels[taskType];
  if (pinnedModelId) {
    const pinnedModel = candidates.find(candidate => candidate.model === pinnedModelId);
    if (pinnedModel) {
      return {
        model: pinnedModel,
        score: calculateOptimizationScore(pinnedModel, taskType, 0.5, cacheHitProbability),
        quality: QUALITY_SCORES[taskType]?.[pinnedModel.model] || 5,
        totalCost: calculateModelTotalCost(pinnedModel, cacheHitProbability)
      };
    }
  }
  
  // Calculate scores for all candidates
  const scoredCandidates = candidates.map(model => ({
    model,
    score: calculateOptimizationScore(model, taskType, 0.5, cacheHitProbability),
    quality: QUALITY_SCORES[taskType]?.[model.model] || 5,
    totalCost: calculateModelTotalCost(model, cacheHitProbability)
  }));
  
  // Sort by score (descending)
  scoredCandidates.sort((a, b) => b.score - a.score);
  
  return scoredCandidates.length > 0 ? scoredCandidates[0] : null;
}

/**
 * Generate optimized routing recommendations
 * @param {Object} currentRules - Current routing rules from SOUL.md
 * @param {Array} models - Available models with pricing
 * @returns {Object} Optimization results
 */
function generateOptimizedRouting(currentRules, models) {
  const recommendations = [];
  const taskTypes = new Set();
  
  // Extract task types from current rules
  [...currentRules.dailyConversation, ...currentRules.actionTasks, ...currentRules.escalation].forEach(rule => {
    for (const [description, taskType] of Object.entries(TASK_TYPE_MAP)) {
      if (rule.includes(description)) {
        taskTypes.add(taskType);
        break;
      }
    }
  });
  
  // Generate recommendations for each task type
  for (const taskType of taskTypes) {
    const optimal = findOptimalModel(models, taskType);
    
    if (optimal) {
      recommendations.push({
        taskType,
        recommendedModel: optimal.model.model,
        score: optimal.score,
        quality: optimal.quality,
        totalCost: optimal.totalCost,
        reasoning: `Balances quality (${optimal.quality}/10) with cost ($${optimal.totalCost.toFixed(2)}/M)`
      });
    }
  }
  
  // Sort by potential impact (combination of usage frequency and improvement)
  recommendations.sort((a, b) => b.score - a.score);
  
  return recommendations;
}

/**
 * Calculate potential savings
 * @param {Object} currentRules - Current routing rules
 * @param {Array} recommendations - Optimized recommendations
 * @param {Array} models - All models with pricing
 * @param {Object} usageMix - Estimated usage mix
 * @returns {Object} Savings analysis
 */
function calculateSavings(currentRules, recommendations, models, usageMix = {}) {
  // Default usage mix if not provided
  const defaultUsageMix = {
    'casual-chat': 0.15,
    'simple-qa': 0.10,
    'browser-operations': 0.08,
    'exec-commands': 0.07,
    'file-operations': 0.06,
    'web-search-fetch': 0.08,
    'process-management': 0.05,
    'github-cli': 0.04,
    'multi-step-planning': 0.06,
    'requirements-engineering': 0.05,
    'calendar-email-checking': 0.04,
    'research-synthesis': 0.07,
    'complex-problem-solving': 0.05,
    'analysis-breakdowns': 0.05
  };
  
  const actualUsageMix = { ...defaultUsageMix, ...usageMix };
  const currentRoutingByTask = buildCurrentRoutingIndex(currentRules, models);
  
  let currentTotalCost = 0;
  let optimizedTotalCost = 0;
  const taskImprovements = [];
  
  // Calculate costs for each task type
  for (const [taskType, usagePercent] of Object.entries(actualUsageMix)) {
    const currentModelId = currentRoutingByTask[taskType];
    const currentModel = currentModelId
      ? models.find(m => m.model === currentModelId)
      : null;
    
    const optimizedRec = recommendations.find(r => r.taskType === taskType);
    const optimizedModel = optimizedRec 
      ? models.find(m => m.model === optimizedRec.recommendedModel)
      : currentModel;
    
    if (currentModel && optimizedModel) {
      const currentCost = calculateModelTotalCost(currentModel) * usagePercent;
      const optimizedCost = calculateModelTotalCost(optimizedModel) * usagePercent;
      
      currentTotalCost += currentCost;
      optimizedTotalCost += optimizedCost;
      
      if (currentModel.model !== optimizedModel.model) {
        const savings = currentCost - optimizedCost;
        const savingsPercent = savings > 0 ? (savings / currentCost) * 100 : 0;
        
        if (savingsPercent > 1) { // Only show meaningful improvements
          taskImprovements.push({
            taskType,
            currentModel: currentModel.model,
            optimizedModel: optimizedModel.model,
            savingsPercent: savingsPercent.toFixed(1),
            monthlySavings: (savings * 1000).toFixed(2) // Per 1M tokens
          });
        }
      }
    }
  }
  
  const totalSavings = currentTotalCost - optimizedTotalCost;
  const savingsPercent = currentTotalCost > 0 ? (totalSavings / currentTotalCost) * 100 : 0;
  
  return {
    currentMonthlyCost: (currentTotalCost * 1000).toFixed(2), // Per 1M tokens
    optimizedMonthlyCost: (optimizedTotalCost * 1000).toFixed(2),
    monthlySavings: (totalSavings * 1000).toFixed(2),
    savingsPercent: savingsPercent.toFixed(1),
    taskImprovements,
    assumptions: {
      monthlyTokens: '1,000,000',
      usageMix: actualUsageMix
    }
  };
}

/**
 * Main optimizer function
 * @param {string} soulPath - Path to SOUL.md file
 * @returns {Promise<Object>} Optimization results
 */
export async function optimizeRouting(soulPath = null) {
  try {
    // Load pricing data
    console.log('Loading pricing data...');
    const pricing = await fetchAllPricing();
    const allModels = Object.values(pricing).flat().filter(Boolean);
    
    if (allModels.length === 0) {
      throw new Error('No pricing data available');
    }
    
    // Load SOUL.md rules
    console.log('Parsing SOUL.md routing rules...');
    const soulFile = soulPath || join(__dirname, '../../test/fixtures/SOUL.md');
    const soulContent = readFileSync(soulFile, 'utf8');
    const currentRules = parseSoulRouting(soulContent);
    const currentRoutingByTask = buildCurrentRoutingIndex(currentRules, allModels);
    
    // Generate optimized routing
    console.log('Calculating optimized routing...');
    const recommendations = generateOptimizedRouting(currentRules, allModels);
    
    // Calculate savings
    console.log('Calculating potential savings...');
    const savings = calculateSavings(currentRules, recommendations, allModels);
    
    // Prepare results
    const results = {
      timestamp: new Date().toISOString(),
      modelsAnalyzed: allModels.length,
      currentRules: {
        dailyConversation: currentRules.dailyConversation.length,
        actionTasks: currentRules.actionTasks.length,
        escalation: currentRules.escalation.length
      },
      recommendations: recommendations.slice(0, 10), // Top 10 recommendations
      currentRoutingByTask,
      modelCatalog: allModels.map(m => ({
        model: m.model,
        inputPerM: m.inputPerM,
        outputPerM: m.outputPerM,
        totalPerM: calculateModelTotalCost(m)
      })),
      savings,
      qualityImpact: {
        tasksImproved: recommendations.filter(r => r.quality >= 7).length,
        tasksMaintained: recommendations.filter(r => r.quality >= 5 && r.quality < 7).length,
        tasksDegraded: recommendations.filter(r => r.quality < 5).length
      },
      implementationPriority: recommendations
        .filter(r => r.score > 7)
        .map(r => ({
          taskType: r.taskType,
          model: r.recommendedModel,
          impact: 'high'
        }))
    };
    
    console.log(`Optimization complete: ${recommendations.length} recommendations generated`);
    return results;
    
  } catch (error) {
    console.error('Optimization failed:', error.message);
    throw error;
  }
}

/**
 * Generate optimization report
 * @param {Object} results - Optimization results
 * @returns {string} Markdown report
 */
export function generateReport(results) {
  const { recommendations, savings, qualityImpact } = results;
  const modelCatalog = Array.isArray(results.modelCatalog) ? results.modelCatalog : [];
  const currentRoutingByTask = results.currentRoutingByTask || {};

  const costByModel = Object.fromEntries(
    modelCatalog.map(model => [model.model, Number(model.totalPerM || 0)])
  );

  const usedModelRows = {};
  for (const [taskType, model] of Object.entries(currentRoutingByTask)) {
    if (!usedModelRows[model]) {
      usedModelRows[model] = { model, tasks: [] };
    }
    usedModelRows[model].tasks.push(taskType);
  }

  const comparisonRows = recommendations
    .map(rec => {
      const currentModel = currentRoutingByTask[rec.taskType] || null;
      if (!currentModel) return null;
      const currentCost = Number(costByModel[currentModel] || 0);
      const recommendedCost = Number(rec.totalCost || 0);
      const delta = currentCost - recommendedCost;
      const deltaPct = currentCost > 0 ? (delta / currentCost) * 100 : 0;
      return {
        taskType: rec.taskType,
        currentModel,
        currentCost,
        recommendedModel: rec.recommendedModel,
        recommendedCost,
        delta,
        deltaPct
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.delta - a.delta);
  const actionableRows = comparisonRows.filter(row => row.currentModel !== row.recommendedModel);
  
  let report = `# Model Optimization Report\n`;
  report += `**Generated:** ${new Date(results.timestamp).toLocaleString()}\n`;
  report += `**Models Analyzed:** ${results.modelsAnalyzed}\n`;
  report += `**Current Rules:** ${results.currentRules.dailyConversation} daily + ${results.currentRules.actionTasks} action + ${results.currentRules.escalation} escalation\n\n`;
  
  report += `## 📊 Summary\n`;
  report += `- **Monthly Savings Potential:** $${savings.monthlySavings} (${savings.savingsPercent}%)\n`;
  report += `- **Actionable Routing Changes:** ${actionableRows.length}\n`;
  report += `- **Scored Opportunities (reference):** ${recommendations.length}\n`;
  report += `- **Quality Impact (scored set):** ${qualityImpact.tasksImproved} improved, ${qualityImpact.tasksMaintained} maintained, ${qualityImpact.tasksDegraded} degraded\n\n`;
  
  report += `## 💰 Cost Analysis\n`;
  report += `| Metric | Current | Optimized | Savings |\n`;
  report += `|--------|---------|-----------|---------|\n`;
  report += `| Monthly Cost (per 1M tokens) | $${savings.currentMonthlyCost} | $${savings.optimizedMonthlyCost} | **$${savings.monthlySavings}** |\n\n`;

  report += `## 📦 Found Model Costs\n`;
  report += `| Model | Input/M | Output/M | Total/M |\n`;
  report += `|-------|---------|----------|---------|\n`;
  for (const model of modelCatalog.sort((a, b) => a.model.localeCompare(b.model))) {
    report += `| ${model.model} | $${Number(model.inputPerM).toFixed(3)} | $${Number(model.outputPerM).toFixed(3)} | $${Number(model.totalPerM).toFixed(3)} |\n`;
  }
  report += '\n';

  report += `## 🧭 Currently Used Models\n`;
  report += `| Model | Total/M | Task Count | Tasks |\n`;
  report += `|-------|---------|------------|-------|\n`;
  for (const row of Object.values(usedModelRows).sort((a, b) => b.tasks.length - a.tasks.length)) {
    report += `| ${row.model} | $${Number(costByModel[row.model] || 0).toFixed(3)} | ${row.tasks.length} | ${row.tasks.join(', ')} |\n`;
  }
  report += '\n';

  report += `## 🔄 Current vs Suggested Comparison\n`;
  report += `| Task | Current Model | Current Cost/M | Suggested Model | Suggested Cost/M | Delta | Delta % |\n`;
  report += `|------|---------------|----------------|-----------------|------------------|-------|---------|\n`;
  for (const row of comparisonRows) {
    report += `| ${row.taskType} | ${row.currentModel} | $${row.currentCost.toFixed(3)} | ${row.recommendedModel} | $${row.recommendedCost.toFixed(3)} | $${row.delta.toFixed(3)} | ${row.deltaPct.toFixed(1)}% |\n`;
  }
  report += '\n';

  report += `## ✅ Suggestion Items (Require Per-Item Approval)\n`;
  let item = 1;
  for (const row of actionableRows) {
    report += `${item}. **${row.taskType}**: ${row.currentModel} → ${row.recommendedModel} (Δ $${row.delta.toFixed(3)}/M)\n`;
    item += 1;
  }
  if (item === 1) {
    report += `No routing changes suggested.\n`;
  }
  report += '\n';
  
  if (actionableRows.length > 0) {
    report += `### 🎯 Top Savings Opportunities\n`;
    report += `| Task Type | Current Model | Optimized Model | Savings |\n`;
    report += `|-----------|---------------|-----------------|---------|\n`;

    actionableRows.slice(0, 5).forEach(row => {
      const pct = row.currentCost > 0 ? ((row.delta / row.currentCost) * 100) : 0;
      report += `| ${row.taskType} | ${row.currentModel.split('/').pop()} | ${row.recommendedModel.split('/').pop()} | ${pct.toFixed(1)}% ($${row.delta.toFixed(3)}) |\n`;
    });
    report += '\n';
  }

  if (actionableRows.length > 0) {
    report += `## 🚀 Recommended Changes\n`;
    report += `| Priority | Task Type | Recommended Model | Score | Quality | Cost/M |\n`;
    report += `|----------|-----------|-------------------|-------|---------|--------|\n`;

    recommendations
      .filter(rec => actionableRows.some(row => row.taskType === rec.taskType))
      .slice(0, 8)
      .forEach(rec => {
        const priority = rec.score >= 8 ? '🔴 High' : rec.score >= 6 ? '🟡 Medium' : '🟢 Low';
        report += `| ${priority} | ${rec.taskType} | ${rec.recommendedModel.split('/').pop()} | ${rec.score.toFixed(1)} | ${rec.quality}/10 | $${rec.totalCost.toFixed(2)} |\n`;
      });

    report += '\n';
  } else {
    report += `## 🚀 Recommended Changes\n`;
    report += `No actionable routing changes in this run. Current routing already matches optimizer policy.\n\n`;
    report += `### Reference Ranking (No Approval Needed)\n`;
    report += `| Task Type | Preferred Model | Score | Cost/M |\n`;
    report += `|-----------|-----------------|-------|--------|\n`;
    recommendations.slice(0, 8).forEach(rec => {
      report += `| ${rec.taskType} | ${rec.recommendedModel.split('/').pop()} | ${rec.score.toFixed(1)} | $${rec.totalCost.toFixed(2)} |\n`;
    });
    report += '\n';
  }
  
  report += `## 📋 Implementation Recommendations\n`;
  report += `1. **Start with high-impact changes** (score ≥ 8)\n`;
  report += `2. **Monitor quality** for 1-2 weeks after changes\n`;
  report += `3. **Adjust usage mix** based on actual performance\n`;
  report += `4. **Re-run optimization** monthly for continuous improvement\n\n`;
  
  report += `## ⚠️ Assumptions & Limitations\n`;
  report += `- **Monthly tokens:** ${savings.assumptions.monthlyTokens}\n`;
  report += `- **Usage mix:** Estimated based on typical patterns\n`;
  report += `- **Quality scores:** Subjective assessments\n`;
  report += `- **Cost data:** ${new Date().toLocaleDateString()} pricing\n`;
  
  return report;
}

/**
 * Compare current vs optimized routing
 * @param {Object} currentRules - Current routing rules
 * @param {Array} recommendations - Optimized recommendations
 * @returns {Object} Comparison results
 */
export function compareRouting(currentRules, recommendations) {
  const comparison = [];
  
  // Simplified comparison - would need actual task-model mapping
  recommendations.forEach(rec => {
    comparison.push({
      taskType: rec.taskType,
      current: 'Unknown', // Would need actual mapping from SOUL.md
      optimized: rec.recommendedModel,
      improvement: rec.score > 6 ? 'Yes' : 'Minimal'
    });
  });
  
  return {
    totalComparisons: comparison.length,
    improvements: comparison.filter(c => c.improvement === 'Yes').length,
    details: comparison
  };
}

export default {
  TASK_TYPE_MAP,
  optimizeRouting,
  generateReport,
  compareRouting,
  parseSoulRouting,
  calculateOptimizationScore,
  findOptimalModel
};
