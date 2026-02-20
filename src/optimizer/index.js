/**
 * Model Optimizer Algorithm
 * Calculates optimal model routing based on cost-quality trade-offs
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { fetchAllPricing } from '../pricing/index.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

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

/**
 * Task type mappings from SOUL.md descriptions
 */
const TASK_TYPE_MAP = {
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

/**
 * Calculate optimization score for a model-task combination
 * @param {Object} model - Model pricing data
 * @param {string} taskType - Task type identifier
 * @param {number} qualityWeight - Weight for quality vs cost (0-1)
 * @returns {number} Optimization score (higher is better)
 */
function calculateOptimizationScore(model, taskType, qualityWeight = 0.7) {
  const qualityScore = QUALITY_SCORES[taskType]?.[model.model] || 5;
  const totalCost = model.inputPerM + model.outputPerM;
  
  // Normalize cost (lower cost = higher score)
  // Assume max cost is $100/M for normalization
  const normalizedCostScore = Math.max(0, 10 - (totalCost / 10));
  
  // Weighted combination
  return (qualityWeight * qualityScore) + ((1 - qualityWeight) * normalizedCostScore);
}

/**
 * Find optimal model for a task
 * @param {Array} models - Available models with pricing
 * @param {string} taskType - Task type identifier
 * @param {Object} constraints - Optimization constraints
 * @returns {Object|null} Optimal model or null if none found
 */
function findOptimalModel(models, taskType, constraints = {}) {
  const { minQuality = 6, maxCost = null, preferredProviders = [] } = constraints;
  
  let candidates = models.filter(model => {
    // Check quality requirement
    const quality = QUALITY_SCORES[taskType]?.[model.model] || 0;
    if (quality < minQuality) return false;
    
    // Check cost constraint
    if (maxCost !== null) {
      const totalCost = model.inputPerM + model.outputPerM;
      if (totalCost > maxCost) return false;
    }
    
    return true;
  });
  
  if (candidates.length === 0) {
    // Relax constraints if no candidates found
    candidates = models;
  }
  
  // Calculate scores for all candidates
  const scoredCandidates = candidates.map(model => ({
    model,
    score: calculateOptimizationScore(model, taskType),
    quality: QUALITY_SCORES[taskType]?.[model.model] || 5,
    totalCost: model.inputPerM + model.outputPerM
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
  
  let currentTotalCost = 0;
  let optimizedTotalCost = 0;
  const taskImprovements = [];
  
  // Calculate costs for each task type
  for (const [taskType, usagePercent] of Object.entries(actualUsageMix)) {
    // Find current model for this task (simplified - would need actual mapping)
    const currentModel = models.find(m => 
      m.model.includes('deepseek') && taskType.includes('chat')
    ) || models.find(m => m.model.includes('haiku')) || models[0];
    
    const optimizedRec = recommendations.find(r => r.taskType === taskType);
    const optimizedModel = optimizedRec 
      ? models.find(m => m.model === optimizedRec.recommendedModel)
      : currentModel;
    
    if (currentModel && optimizedModel) {
      const currentCost = (currentModel.inputPerM + currentModel.outputPerM) * usagePercent;
      const optimizedCost = (optimizedModel.inputPerM + optimizedModel.outputPerM) * usagePercent;
      
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
  
  let report = `# Model Optimization Report\n`;
  report += `**Generated:** ${new Date(results.timestamp).toLocaleString()}\n`;
  report += `**Models Analyzed:** ${results.modelsAnalyzed}\n`;
  report += `**Current Rules:** ${results.currentRules.dailyConversation} daily + ${results.currentRules.actionTasks} action + ${results.currentRules.escalation} escalation\n\n`;
  
  report += `## 📊 Summary\n`;
  report += `- **Monthly Savings Potential:** $${savings.monthlySavings} (${savings.savingsPercent}%)\n`;
  report += `- **Quality Impact:** ${qualityImpact.tasksImproved} improved, ${qualityImpact.tasksMaintained} maintained, ${qualityImpact.tasksDegraded} degraded\n`;
  report += `- **High-Impact Changes:** ${results.implementationPriority.length} tasks\n\n`;
  
  report += `## 💰 Cost Analysis\n`;
  report += `| Metric | Current | Optimized | Savings |\n`;
  report += `|--------|---------|-----------|---------|\n`;
  report += `| Monthly Cost (per 1M tokens) | $${savings.currentMonthlyCost} | $${savings.optimizedMonthlyCost} | **$${savings.monthlySavings}** |\n\n`;
  
  if (savings.taskImprovements.length > 0) {
    report += `### 🎯 Top Savings Opportunities\n`;
    report += `| Task Type | Current Model | Optimized Model | Savings |\n`;
    report += `|-----------|---------------|-----------------|---------|\n`;
    
    savings.taskImprovements.slice(0, 5).forEach(improvement => {
      report += `| ${improvement.taskType} | ${improvement.currentModel.split('/').pop()} | ${improvement.optimizedModel.split('/').pop()} | ${improvement.savingsPercent}% ($${improvement.monthlySavings}) |\n`;
    });
    report += '\n';
  }
  
  report += `## 🚀 Recommended Changes\n`;
  report += `| Priority | Task Type | Recommended Model | Score | Quality | Cost/M |\n`;
  report += `|----------|-----------|-------------------|-------|---------|--------|\n`;
  
  recommendations.slice(0, 8).forEach(rec => {
    const priority = rec.score >= 8 ? '🔴 High' : rec.score >= 6 ? '🟡 Medium' : '🟢 Low';
    report += `| ${priority} | ${rec.taskType} | ${rec.recommendedModel.split('/').pop()} | ${rec.score.toFixed(1)} | ${rec.quality}/10 | $${rec.totalCost.toFixed(2)} |\n`;
  });
  
  report += '\n';
  
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
  optimizeRouting,
  generateReport,
  compareRouting,
  parseSoulRouting,
  calculateOptimizationScore,
  findOptimalModel
};