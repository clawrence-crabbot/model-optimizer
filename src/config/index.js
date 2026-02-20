/**
 * SOUL.md configuration updater
 * Focuses strictly on model routing sections.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { TASK_TYPE_MAP } from '../optimizer/index.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const TAXONOMY_PATH = join(__dirname, '../../data/taxonomy.json');
const TARGET_SECTIONS = {
  dailyConversation: 'Daily Conversation Track:',
  actionTasks: 'Action Task Track:',
  escalation: 'Further escalation:'
};
const SECTION_ORDER = ['dailyConversation', 'actionTasks', 'escalation'];
const MODEL_LABEL_OVERRIDES = {
  'deepseek/deepseek-chat': 'DeepSeek Chat',
  'deepseek/deepseek-reasoner': 'DeepSeek Reasoner',
  'google/gemini-flash-lite': 'Gemini Flash Lite',
  'google/gemini-3-flash-preview': 'Gemini 3 Flash',
  'google/gemini-2.5-flash': 'Gemini 2.5 Flash',
  'google/gemini-3-pro-preview': 'Gemini 3 Pro',
  'google/gemini-2.5-pro': 'Gemini 2.5 Pro',
  'claude-haiku-4-5-20251001': 'Claude Haiku',
  'claude-sonnet-4-6': 'Claude Sonnet',
  'claude-opus-4-6': 'Claude Opus'
};

function resolveHomePath(inputPath) {
  if (!inputPath) return inputPath;
  if (inputPath === '~') return process.env.HOME || '';
  if (inputPath.startsWith('~/')) {
    return join(process.env.HOME || '', inputPath.slice(2));
  }
  return inputPath;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function loadTaxonomyTaskIds() {
  if (!existsSync(TAXONOMY_PATH)) {
    return new Set();
  }

  const raw = readFileSync(TAXONOMY_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  return new Set((parsed.tasks || []).map(task => task.id));
}

function normalizeModelLabel(modelName) {
  if (!modelName) return modelName;
  if (MODEL_LABEL_OVERRIDES[modelName]) {
    return MODEL_LABEL_OVERRIDES[modelName];
  }

  const short = modelName.includes('/') ? modelName.split('/').pop() : modelName;
  return short
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(part => (/^\d+(\.\d+)?$/.test(part) ? part : `${part[0].toUpperCase()}${part.slice(1)}`))
    .join(' ');
}

function sectionKeyFromLine(line) {
  const trimmed = line.trim();
  for (const [key, marker] of Object.entries(TARGET_SECTIONS)) {
    if (trimmed.includes(marker)) {
      return key;
    }
  }
  return null;
}

function findTaskMatches(line) {
  const matches = [];
  const text = line.trim();

  for (const [description, taskType] of Object.entries(TASK_TYPE_MAP)) {
    if (text.includes(description)) {
      matches.push({ description, taskType });
    }
  }

  return matches.sort((a, b) => b.description.length - a.description.length);
}

function buildRuleMap(parsed) {
  const byTaskType = {};

  for (const sectionName of SECTION_ORDER) {
    for (const lineInfo of parsed.sections[sectionName].rules) {
      for (const match of lineInfo.matches) {
        if (!byTaskType[match.taskType]) {
          byTaskType[match.taskType] = [];
        }

        byTaskType[match.taskType].push({
          section: sectionName,
          lineNumber: lineInfo.lineNumber,
          description: match.description,
          line: lineInfo.text
        });
      }
    }
  }

  return byTaskType;
}

function replaceModelForTask(line, taskType, description, newModelLabel) {
  const escapedDescription = escapeRegExp(description);

  if (taskType === 'file-edits-cheap') {
    return line.replace(/(cheap\/simple edits use\s+)([^,\n]+)/i, `$1${newModelLabel}`);
  }

  if (taskType === 'file-edits-high-risk') {
    return line.replace(/(higher risk edits use\s+)([^,\n]+)/i, `$1${newModelLabel}`);
  }

  if (taskType === 'code-changes') {
    const regex = new RegExp(`(${escapedDescription}\\s*:\\s*)([^,\\n]+?)(\\s+first\\b)?(?=$|,|\\.|;)`, 'i');
    return line.replace(regex, (_full, prefix, _model, suffix = '') => `${prefix}${newModelLabel}${suffix}`);
  }

  const genericRegex = new RegExp(`(${escapedDescription}\\s*(?::|→)\\s*)([^,\\n]+)(?=$|,|\\.|;)`, 'i');
  if (genericRegex.test(line)) {
    return line.replace(genericRegex, `$1${newModelLabel}`);
  }

  // If no direct delimiter pattern is found, preserve line.
  return line;
}

function recommendationsToMap(optimizedRecommendations) {
  const map = {};

  for (const rec of optimizedRecommendations || []) {
    if (!rec || !rec.taskType) {
      continue;
    }

    const modelId = rec.recommendedModel || rec.model || rec.targetModel;
    if (!modelId) {
      continue;
    }

    map[rec.taskType] = normalizeModelLabel(modelId);
  }

  return map;
}

function buildChangesFromRecommendations(parsed, optimizedRecommendations) {
  const modelByTaskType = recommendationsToMap(optimizedRecommendations);
  const newLines = [...parsed.lines];
  const modifiedLines = [];

  for (const sectionName of SECTION_ORDER) {
    for (const lineInfo of parsed.sections[sectionName].rules) {
      let updated = lineInfo.text;

      for (const match of lineInfo.matches) {
        const modelLabel = modelByTaskType[match.taskType];
        if (!modelLabel) continue;

        updated = replaceModelForTask(updated, match.taskType, match.description, modelLabel);
      }

      if (updated !== lineInfo.text) {
        newLines[lineInfo.lineNumber - 1] = updated;
        modifiedLines.push({
          lineNumber: lineInfo.lineNumber,
          section: sectionName,
          before: lineInfo.text,
          after: updated,
          taskTypes: lineInfo.matches.map(m => m.taskType)
        });
      }
    }
  }

  return {
    path: parsed.path,
    resolvedPath: parsed.resolvedPath,
    originalContent: parsed.content,
    proposedContent: newLines.join('\n'),
    modifiedLines
  };
}

export function parseSoulFile(path) {
  const resolvedPath = resolve(resolveHomePath(path));
  const content = readFileSync(resolvedPath, 'utf8');
  const lines = content.split('\n');

  const sections = {
    dailyConversation: { startLine: null, endLine: null, rules: [] },
    actionTasks: { startLine: null, endLine: null, rules: [] },
    escalation: { startLine: null, endLine: null, rules: [] }
  };

  let currentSection = null;
  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx];
    const lineNumber = idx + 1;

    const sectionKey = sectionKeyFromLine(line);
    if (sectionKey) {
      if (currentSection && sections[currentSection].endLine === null) {
        sections[currentSection].endLine = lineNumber - 1;
      }

      currentSection = sectionKey;
      sections[currentSection].startLine = lineNumber;
      continue;
    }

    if (!currentSection) {
      continue;
    }

    const trimmed = line.trim();
    if (trimmed.startsWith('-')) {
      sections[currentSection].rules.push({
        lineNumber,
        text: line,
        matches: findTaskMatches(line)
      });
    }
  }

  if (currentSection && sections[currentSection].endLine === null) {
    sections[currentSection].endLine = lines.length;
  }

  return {
    path,
    resolvedPath,
    content,
    lines,
    sections,
    rulesByTaskType: buildRuleMap({ sections })
  };
}

export function generateDiff(currentRules, optimizedRules) {
  const recMap = recommendationsToMap(optimizedRules);
  const rows = [];

  for (const sectionName of SECTION_ORDER) {
    for (const ruleLine of currentRules.sections[sectionName].rules) {
      const before = ruleLine.text;
      let after = before;

      for (const match of ruleLine.matches) {
        if (!recMap[match.taskType]) continue;
        after = replaceModelForTask(after, match.taskType, match.description, recMap[match.taskType]);
      }

      if (after !== before) {
        rows.push({
          section: sectionName,
          lineNumber: ruleLine.lineNumber,
          before: before.trim(),
          after: after.trim()
        });
      }
    }
  }

  if (rows.length === 0) {
    return '## SOUL.md Routing Diff\n\nNo model routing changes proposed.';
  }

  const sectionLabel = {
    dailyConversation: 'Daily Conversation Track',
    actionTasks: 'Action Task Track',
    escalation: 'Further escalation'
  };

  let output = '## SOUL.md Routing Diff\n\n';
  output += `Proposed changes: **${rows.length}**\n\n`;
  output += '| Section | Line | Current | Proposed |\n';
  output += '|---|---:|---|---|\n';

  for (const row of rows) {
    output += `| ${sectionLabel[row.section]} | ${row.lineNumber} | \`${row.before}\` | \`${row.after}\` |\n`;
  }

  return output;
}

export function validateChanges(changes) {
  if (!changes || typeof changes !== 'object') {
    return { valid: false, errors: ['Changes payload is required.'] };
  }

  const errors = [];
  const {
    originalContent,
    proposedContent,
    modifiedLines
  } = changes;

  if (typeof originalContent !== 'string' || typeof proposedContent !== 'string') {
    errors.push('Changes must include originalContent and proposedContent strings.');
  }

  if (!Array.isArray(modifiedLines)) {
    errors.push('Changes must include modifiedLines array.');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const originalLines = originalContent.split('\n');
  const proposedLines = proposedContent.split('\n');

  if (originalLines.length !== proposedLines.length) {
    errors.push('Line count changed; destructive edits are not allowed.');
  }

  for (const change of modifiedLines) {
    if (!SECTION_ORDER.includes(change.section)) {
      errors.push(`Invalid section on line ${change.lineNumber}: ${change.section}`);
      continue;
    }

    if (!originalLines[change.lineNumber - 1] || !proposedLines[change.lineNumber - 1]) {
      errors.push(`Invalid line reference: ${change.lineNumber}`);
      continue;
    }

    if (!String(change.before).trim().startsWith('-') || !String(change.after).trim().startsWith('-')) {
      errors.push(`Only bullet routing rules may be updated (line ${change.lineNumber}).`);
    }

    if (originalLines[change.lineNumber - 1] !== change.before) {
      errors.push(`Before snapshot mismatch on line ${change.lineNumber}.`);
    }

    if (proposedLines[change.lineNumber - 1] !== change.after) {
      errors.push(`After snapshot mismatch on line ${change.lineNumber}.`);
    }
  }

  // Ensure no out-of-band modifications happened.
  let detectedDiffCount = 0;
  for (let idx = 0; idx < originalLines.length; idx += 1) {
    if (originalLines[idx] !== proposedLines[idx]) {
      detectedDiffCount += 1;
    }
  }

  if (detectedDiffCount !== modifiedLines.length) {
    errors.push('Detected diff count does not match modifiedLines; possible out-of-scope edits.');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export function applyChanges(path, changes, dryRun = true) {
  const resolvedPath = resolve(resolveHomePath(path));
  const validation = validateChanges(changes);

  if (!validation.valid) {
    throw new Error(`Change validation failed: ${validation.errors.join(' | ')}`);
  }

  if (dryRun) {
    return {
      applied: false,
      dryRun: true,
      path: resolvedPath,
      modifiedLines: changes.modifiedLines,
      proposedContent: changes.proposedContent
    };
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${resolvedPath}.bak.${timestamp}`;

  const existingContent = readFileSync(resolvedPath, 'utf8');
  if (existingContent !== changes.originalContent) {
    throw new Error('SOUL.md changed since diff generation. Re-run before applying.');
  }

  writeFileSync(backupPath, existingContent, 'utf8');

  try {
    writeFileSync(resolvedPath, changes.proposedContent, 'utf8');

    const written = readFileSync(resolvedPath, 'utf8');
    if (written !== changes.proposedContent) {
      throw new Error('Post-write validation failed: written content mismatch.');
    }

    // Structural check: the three routing sections must still parse.
    const reparsed = parseSoulFile(resolvedPath);
    for (const sectionName of SECTION_ORDER) {
      if (reparsed.sections[sectionName].startLine === null) {
        throw new Error(`Post-write validation failed: missing section ${sectionName}.`);
      }
    }

    return {
      applied: true,
      dryRun: false,
      path: resolvedPath,
      backupPath,
      modifiedLines: changes.modifiedLines
    };
  } catch (error) {
    writeFileSync(resolvedPath, readFileSync(backupPath, 'utf8'), 'utf8');
    throw error;
  }
}

export function generateApprovalMessage(diff) {
  const maxLen = 3400;
  const diffText = String(diff || '').trim();
  const safeDiff = diffText.length > maxLen ? `${diffText.slice(0, maxLen)}\n\n...truncated` : diffText;

  return {
    text: `*Model Routing Update Proposal*\n\n${safeDiff}\n\nApprove applying these SOUL.md routing updates?`,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Approve', callback_data: 'soul_update:approve' },
          { text: 'Reject', callback_data: 'soul_update:reject' }
        ]
      ]
    }
  };
}

export function updateSoulConfig(
  optimizedRecommendations,
  soulPath = '~/.openclaw/workspace/SOUL.md',
  dryRun = true
) {
  const resolvedPath = resolve(resolveHomePath(soulPath));
  const taxonomyTaskIds = loadTaxonomyTaskIds();

  const recommendations = (optimizedRecommendations || []).filter(rec => {
    if (!rec || !rec.taskType) return false;
    if (taxonomyTaskIds.size === 0) return true;
    return taxonomyTaskIds.has(rec.taskType);
  });

  const parsed = parseSoulFile(resolvedPath);
  const changes = buildChangesFromRecommendations(parsed, recommendations);

  const validation = validateChanges(changes);
  if (!validation.valid) {
    throw new Error(`Invalid SOUL.md update set: ${validation.errors.join(' | ')}`);
  }

  const diff = generateDiff(parsed, recommendations);
  const approvalMessage = generateApprovalMessage(diff);

  const applyResult = applyChanges(resolvedPath, changes, dryRun);

  return {
    dryRun,
    path: resolvedPath,
    recommendationsConsidered: recommendations.length,
    modifiedCount: changes.modifiedLines.length,
    diff,
    approvalMessage,
    changes,
    result: applyResult
  };
}

export default {
  parseSoulFile,
  generateDiff,
  applyChanges,
  validateChanges,
  generateApprovalMessage,
  updateSoulConfig
};
