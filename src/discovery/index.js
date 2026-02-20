/**
 * Task Discovery Engine for Model Optimizer
 * Handles unknown task types through fuzzy matching and LLM classification
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { TASK_TYPE_MAP } from '../optimizer/index.js';

let fetch;
try {
  fetch = (await import('node-fetch')).default;
} catch {
  fetch = globalThis.fetch || (() => {
    throw new Error('Fetch not available. Install node-fetch.');
  });
}

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Path to taxonomy database
const TAXONOMY_PATH = join(__dirname, '../../data/taxonomy.json');

/**
 * Load taxonomy from JSON file
 * @returns {Object} Taxonomy data
 */
export function loadTaxonomy() {
  try {
    const data = readFileSync(TAXONOMY_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    // Return default taxonomy if file doesn't exist
    return {
      tasks: [],
      categories: ['Daily Conversation', 'Action Tasks', 'Escalation'],
      version: '1.0.0'
    };
  }
}

/**
 * Save taxonomy to JSON file
 * @param {Object} taxonomy Taxonomy data
 */
export function saveTaxonomy(taxonomy) {
  try {
    writeFileSync(TAXONOMY_PATH, JSON.stringify(taxonomy, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Failed to save taxonomy:', error.message);
    return false;
  }
}

/**
 * Fuzzy match task description against known tasks
 * @param {string} description Task description from SOUL.md
 * @returns {string|null} Matched task type ID or null
 */
export function fuzzyMatchTask(description) {
  const descLower = description.toLowerCase();
  const normalizedDesc = normalizeTaskText(description);
  
  // Check exact matches in TASK_TYPE_MAP
  for (const [knownDesc, taskType] of Object.entries(TASK_TYPE_MAP)) {
    const knownLower = knownDesc.toLowerCase();
    const normalizedKnown = normalizeTaskText(knownDesc);
    
    if (descLower.includes(knownLower) ||
        knownLower.includes(descLower) ||
        normalizedDesc.includes(normalizedKnown) ||
        normalizedKnown.includes(normalizedDesc)) {
      return taskType;
    }
    
    // Token overlap matching for semantically close variants.
    const overlap = tokenOverlapScore(normalizedDesc, normalizedKnown);
    if (overlap >= 0.6) return taskType;
  }
  
  // Check against taxonomy tasks
  const taxonomy = loadTaxonomy();
  for (const task of taxonomy.tasks) {
    const taskName = task.name.toLowerCase();
    const taskDescription = (task.description || '').toLowerCase();
    const normalizedName = normalizeTaskText(task.name || '');
    const normalizedDescription = normalizeTaskText(task.description || '');
    
    if (descLower.includes(taskName) ||
        descLower.includes(taskDescription) ||
        taskName.includes(descLower) ||
        taskDescription.includes(descLower) ||
        normalizedDesc.includes(normalizedName) ||
        normalizedDesc.includes(normalizedDescription) ||
        tokenOverlapScore(normalizedDesc, normalizedName) >= 0.6 ||
        tokenOverlapScore(normalizedDesc, normalizedDescription) >= 0.6) {
      return task.id;
    }
  }
  
  return null;
}

/**
 * Classify unknown tasks using Gemini Flash Lite API
 * @param {string} description Task description
 * @returns {Object} Classification result
 */
export async function classifyUnknownTask(description) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_CLASSIFIER_MODEL || 'gemini-2.5-flash';

  if (!apiKey) {
    return classifyWithLocalPatterns(description, 'missing-api-key');
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const prompt = buildClassificationPrompt(description);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json'
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API HTTP ${response.status}: ${errorText.substring(0, 200)}`);
    }

    const data = await response.json();
    const outputText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!outputText) {
      throw new Error('Gemini response missing output text');
    }

    const parsed = parseGeminiClassification(outputText);
    return {
      taskType: sanitizeTaskType(parsed.taskType || 'general-task'),
      confidence: clampConfidence(parsed.confidence, 0.65),
      category: parsed.category || 'Action Tasks',
      source: `gemini:${model}`,
      reasoning: parsed.reasoning || 'Classified by Gemini 2.5 Flash'
    };
  } catch (error) {
    console.warn(`Gemini classification failed for "${description}": ${error.message}`);
    return classifyWithLocalPatterns(description, 'gemini-fallback');
  }
}

/**
 * Extract task descriptions from SOUL.md content
 * @param {string} soulContent SOUL.md content
 * @returns {Array} Array of task descriptions
 */
export function extractTaskDescriptions(soulContent) {
  const tasks = [];
  const lines = soulContent.split('\n');
  let inTaskSection = false;
  const debug = process.env.DISCOVERY_DEBUG === '1';
  
  if (debug) {
    console.log(`[DISCOVERY] Starting extraction over ${lines.length} lines`);
  }

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    
    // Detect task sections (supports variants like "Track (details):")
    if (isTaskSectionHeader(trimmed)) {
      if (debug) {
        console.log(`[DISCOVERY] Entering task section at line ${index + 1}: "${trimmed}"`);
      }
      inTaskSection = true;
      continue;
    }
    
    // Skip section headers
    if (trimmed.startsWith('##') || trimmed.startsWith('**')) {
      continue;
    }
    
    // Extract task descriptions from bullet points
    if (inTaskSection && trimmed.startsWith('-')) {
      // Remove bullet and extract task description
      const withoutBullet = trimmed.substring(1).trim();
      
      // Clean the text: remove checkmarks, emojis, etc.
      // Match: "- ✅ Task description → Model" or "- Task: Model" or "- Task description"
      let cleaned = withoutBullet
        .replace(/^[✅✔️⚡🔍🎯🔧⚙️🛠️🧰]+/, '') // Remove leading emojis
        .replace(/^[✔️☑️✅]+/, '') // Remove checkmarks
        .trim();
      
      // Extract task part (before → or :)
      let taskDesc = cleaned;
      const arrowIndex = cleaned.indexOf('→');
      const colonIndex = cleaned.indexOf(':');
      
      if (arrowIndex !== -1) {
        taskDesc = cleaned.substring(0, arrowIndex).trim();
      } else if (colonIndex !== -1) {
        taskDesc = cleaned.substring(0, colonIndex).trim();
      }
      
      // Also handle cases like "File edits: cheap/simple edits use Gemini 2.5 Flash"
      // We want "File edits" not the whole description
      if (taskDesc.includes('use') && taskDesc.includes('edits')) {
        // Extract just the first part before "use"
        const useIndex = taskDesc.indexOf('use');
        if (useIndex !== -1) {
          taskDesc = taskDesc.substring(0, useIndex).trim();
        }
      }
      
      if (taskDesc) {
        tasks.push(taskDesc);
        if (debug) {
          console.log(`[DISCOVERY] Extracted task: "${taskDesc}"`);
        }
      }
    }
    
    // Reset section flag on empty lines or new sections
    if (trimmed === '' && inTaskSection) {
      if (debug) {
        console.log(`[DISCOVERY] Leaving task section at line ${index + 1}`);
      }
      inTaskSection = false;
    }
  }
  
  if (debug) {
    console.log(`[DISCOVERY] Extraction complete: ${tasks.length} tasks`);
  }
  
  return tasks;
}

function isTaskSectionHeader(line) {
  const normalized = line
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  if (!normalized) return false;

  // Allow richer headings like:
  // "Action Task Track (specific routing per tool type):"
  // by matching the keyword anywhere on the line.
  const hasTrack = normalized.includes('track');
  const hasEscalation = normalized.includes('escalation');

  return hasTrack || hasEscalation;
}

function normalizeTaskText(value) {
  if (!value) return '';
  return value
    .toLowerCase()
    .replace(/sub[\s-]*agent/g, 'multi agent')
    .replace(/agents?/g, 'agent')
    .replace(/coordination|coordinating/g, 'coordinate')
    .replace(/[()]/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenOverlapScore(textA, textB) {
  if (!textA || !textB) return 0;
  const aTokens = new Set(textA.split(' ').filter(Boolean));
  const bTokens = new Set(textB.split(' ').filter(Boolean));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap++;
  }

  return overlap / Math.max(aTokens.size, bTokens.size);
}

function buildClassificationPrompt(description) {
  return `Classify this SOUL routing task description into a task type.

Description: "${description}"

Rules:
- Return strict JSON only (no markdown).
- taskType must be kebab-case.
- category must be one of: Daily Conversation, Action Tasks, Escalation.
- confidence must be between 0 and 1.
- Prefer "sub-agent-coordination" when coordination between agents is implied.

JSON schema:
{"taskType":"string","category":"string","confidence":0.0,"reasoning":"string"}`;
}

function parseGeminiClassification(text) {
  const direct = tryParseJson(text);
  if (direct) return direct;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    const parsed = tryParseJson(fenced[1]);
    if (parsed) return parsed;
  }

  throw new Error('Unable to parse Gemini JSON response');
}

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function sanitizeTaskType(taskType) {
  return (taskType || 'general-task')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'general-task';
}

function clampConfidence(value, fallback = 0.6) {
  const num = Number(value);
  if (Number.isNaN(num)) return fallback;
  return Math.max(0, Math.min(1, num));
}

function classifyWithLocalPatterns(description, source = 'pattern-match') {
  const patterns = [
    { pattern: /sub.?agent|multi.?agent|agent.?coordination/i, taskType: 'sub-agent-coordination', confidence: 0.9, category: 'Action Tasks' },
    { pattern: /coordination|orchestration/i, taskType: 'coordination', confidence: 0.8, category: 'Action Tasks' },
    { pattern: /review|audit|inspection/i, taskType: 'review-analysis', confidence: 0.8, category: 'Action Tasks' },
    { pattern: /translation|language/i, taskType: 'translation', confidence: 0.8, category: 'Action Tasks' },
    { pattern: /creative|writing|story/i, taskType: 'creative-writing', confidence: 0.8, category: 'Action Tasks' },
    { pattern: /data.?extract|scraping/i, taskType: 'data-extraction', confidence: 0.8, category: 'Action Tasks' },
    { pattern: /automation|workflow/i, taskType: 'automation', confidence: 0.8, category: 'Action Tasks' }
  ];

  for (const { pattern, taskType, confidence, category } of patterns) {
    if (pattern.test(description)) {
      return {
        taskType,
        confidence,
        category,
        source,
        reasoning: `Matched fallback pattern: ${pattern.toString()}`
      };
    }
  }

  return {
    taskType: 'general-task',
    confidence: 0.3,
    category: 'Action Tasks',
    source,
    reasoning: 'No specific pattern matched, using generic task type'
  };
}

/**
 * Discover and classify task types from SOUL.md
 * @param {string} soulContent SOUL.md content
 * @returns {Object} Discovery results
 */
export async function discoverTaskTypes(soulContent) {
  const taskDescriptions = extractTaskDescriptions(soulContent);
  const results = {
    totalTasks: taskDescriptions.length,
    knownTasks: [],
    unknownTasks: [],
    newlyDiscovered: [],
    taxonomy: loadTaxonomy()
  };
  
  for (const description of taskDescriptions) {
    // Try fuzzy matching first
    const matchedType = fuzzyMatchTask(description);
    
    if (matchedType) {
      results.knownTasks.push({
        description,
        taskType: matchedType,
        source: 'fuzzy-match'
      });
    } else {
      // Use LLM classification for unknown tasks
      const classification = await classifyUnknownTask(description);
      
      results.unknownTasks.push({
        description,
        classification,
        source: 'llm-classification'
      });
      
      // Check if this is a new task type to add to taxonomy
      const existingTask = results.taxonomy.tasks.find(t => t.id === classification.taskType);
      if (!existingTask && classification.confidence > 0.6) {
        results.newlyDiscovered.push({
          id: classification.taskType,
          name: classification.taskType.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          description,
          category: 'Action Tasks', // Default category
          confidence: classification.confidence
        });
      }
    }
  }
  
  // Update taxonomy with newly discovered tasks
  if (results.newlyDiscovered.length > 0) {
    results.newlyDiscovered.forEach(task => {
      results.taxonomy.tasks.push({
        id: task.id,
        name: task.name,
        description: task.description,
        category: task.category,
        discoveredAt: new Date().toISOString()
      });
      
      // Ensure category exists
      if (!results.taxonomy.categories.includes(task.category)) {
        results.taxonomy.categories.push(task.category);
      }
    });
    
    // Save updated taxonomy
    saveTaxonomy(results.taxonomy);
  }
  
  return results;
}

/**
 * Generate discovery report
 * @param {Object} results Discovery results
 * @returns {string} Markdown report
 */
export function generateDiscoveryReport(results) {
  let report = `# Task Discovery Report\n`;
  report += `**Generated:** ${new Date().toISOString()}\n`;
  report += `**Total Tasks Analyzed:** ${results.totalTasks}\n`;
  report += `**Known Tasks:** ${results.knownTasks.length}\n`;
  report += `**Unknown Tasks:** ${results.unknownTasks.length}\n`;
  report += `**Newly Discovered:** ${results.newlyDiscovered.length}\n\n`;
  
  if (results.knownTasks.length > 0) {
    report += `## ✅ Known Tasks\n`;
    report += `| Description | Task Type | Source |\n`;
    report += `|-------------|-----------|--------|\n`;
    results.knownTasks.forEach(task => {
      report += `| ${task.description} | ${task.taskType} | ${task.source} |\n`;
    });
    report += '\n';
  }
  
  if (results.unknownTasks.length > 0) {
    report += `## 🔍 Unknown Tasks (Classified)\n`;
    report += `| Description | Classified As | Confidence | Reasoning |\n`;
    report += `|-------------|---------------|------------|-----------|\n`;
    results.unknownTasks.forEach(task => {
      report += `| ${task.description} | ${task.classification.taskType} | ${task.classification.confidence.toFixed(2)} | ${task.classification.reasoning} |\n`;
    });
    report += '\n';
  }
  
  if (results.newlyDiscovered.length > 0) {
    report += `## 🎉 Newly Discovered Task Types\n`;
    report += `| ID | Name | Description | Category |\n`;
    report += `|----|------|-------------|----------|\n`;
    results.newlyDiscovered.forEach(task => {
      report += `| ${task.id} | ${task.name} | ${task.description.substring(0, 50)}... | ${task.category} |\n`;
    });
    report += '\n';
    
    report += `**Taxonomy Updated:** Added ${results.newlyDiscovered.length} new task types to taxonomy.json\n`;
  }
  
  report += `## 📊 Summary\n`;
  report += `- **Coverage:** ${((results.knownTasks.length / results.totalTasks) * 100).toFixed(1)}% of tasks recognized\n`;
  report += `- **Discovery Rate:** ${((results.newlyDiscovered.length / results.unknownTasks.length) * 100).toFixed(1)}% of unknown tasks classified\n`;
  report += `- **Taxonomy Size:** ${results.taxonomy.tasks.length} task types across ${results.taxonomy.categories.length} categories\n`;
  
  return report;
}

export default {
  loadTaxonomy,
  saveTaxonomy,
  fuzzyMatchTask,
  classifyUnknownTask,
  extractTaskDescriptions,
  discoverTaskTypes,
  generateDiscoveryReport
};
