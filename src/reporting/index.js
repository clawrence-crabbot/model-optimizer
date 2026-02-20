/**
 * Telegram reporting for optimization output.
 * This module expects OpenClaw's message tool to be available at runtime.
 */

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { generateReport } from '../optimizer/index.js';

const TELEGRAM_MESSAGE_LIMIT = 4096;
const TELEGRAM_CALLBACK_LIMIT = 64;
const TABLE_ROW_LIMIT = 6;
const TRUNCATED_SUFFIX = '\n\n...\\(truncated\\)';
const execFileAsync = promisify(execFile);

function resolveMessageTool(options = {}) {
  const tool = options.messageTool
    || globalThis.message
    || globalThis.openclaw?.message
    || globalThis.OpenClaw?.message;

  if (!tool) {
    throw new Error('OpenClaw message tool is not available in this context.');
  }

  return tool;
}

async function callMessageTool(tool, payload) {
  if (typeof tool === 'function') {
    return tool(payload);
  }

  if (typeof tool.sendMessage === 'function') {
    return tool.sendMessage(payload);
  }

  if (typeof tool.send === 'function') {
    return tool.send(payload);
  }

  if (typeof tool.call === 'function') {
    return tool.call(payload);
  }

  if (typeof tool.run === 'function') {
    return tool.run(payload);
  }

  throw new Error('Unsupported message tool interface.');
}

function escapeTelegramMarkdown(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/([_\*\[\]\(\)~`>#+\-=|{}\.!])/g, '\\$1');
}

function truncateForTelegram(text, limit = TELEGRAM_MESSAGE_LIMIT) {
  if (text.length <= limit) {
    return text;
  }

  const maxBodyLength = Math.max(0, limit - TRUNCATED_SUFFIX.length);
  return `${text.slice(0, maxBodyLength)}${TRUNCATED_SUFFIX}`;
}

function isTableLine(line) {
  return /^\s*\|.*\|\s*$/.test(line);
}

function isSeparatorRow(cells) {
  return cells.every(cell => /^:?-{3,}:?$/.test(cell));
}

function parseTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => cell.trim());
}

function formatTableBlock(lines) {
  const rows = lines
    .map(parseTableRow)
    .filter(cells => cells.some(Boolean));

  if (rows.length === 0) {
    return [];
  }

  const filteredRows = rows.filter(cells => !isSeparatorRow(cells));
  if (filteredRows.length === 0) {
    return [];
  }

  const [header, ...body] = filteredRows;
  const limitedBody = body.slice(0, TABLE_ROW_LIMIT);
  const extraRows = body.length - limitedBody.length;

  const output = [`${header.join(' | ')}`];
  for (const row of limitedBody) {
    output.push(`- ${row.join(' | ')}`);
  }

  if (extraRows > 0) {
    output.push(`- ... ${extraRows} more row(s)`);
  }

  return output;
}

function normalizeMarkdown(markdown) {
  const lines = String(markdown || '')
    .replace(/\r\n/g, '\n')
    .split('\n');

  const output = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (isTableLine(line)) {
      const tableLines = [line];
      while (i + 1 < lines.length && isTableLine(lines[i + 1])) {
        i += 1;
        tableLines.push(lines[i]);
      }

      output.push(...formatTableBlock(tableLines));
      continue;
    }

    let normalized = line;

    normalized = normalized.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
    normalized = normalized.replace(/^\s*#{1,6}\s+/, '');
    normalized = normalized.replace(/^\s*[-*]\s+/, '- ');

    output.push(normalized);
  }

  return output.join('\n');
}

function extractChangeSetId(callbackData, diff, changes) {
  if (typeof callbackData === 'string' && callbackData.trim()) {
    return callbackData.trim();
  }

  if (callbackData && typeof callbackData === 'object') {
    const explicit = callbackData.jobId || callbackData.id || callbackData.hash;
    if (explicit) {
      return String(explicit);
    }
  }

  const source = `${diff || ''}::${JSON.stringify(changes || {})}`;
  return createHash('sha256').update(source).digest('hex').slice(0, 16);
}

function sanitizeCallbackId(value) {
  return String(value).replace(/[^a-zA-Z0-9:_-]/g, '_');
}

function buildCallbackData(action, changeSetId) {
  const safeId = sanitizeCallbackId(changeSetId);
  const data = `opt:${action}:${safeId}`;

  if (data.length <= TELEGRAM_CALLBACK_LIMIT) {
    return data;
  }

  const hash = createHash('sha256').update(safeId).digest('hex').slice(0, 12);
  return `opt:${action}:${hash}`;
}

function resolveTelegramTarget(options = {}) {
  const candidate = options.chatId
    || options.telegramTarget
    || process.env.MODEL_OPTIMIZER_TELEGRAM_TARGET
    || process.env.OPENCLAW_TELEGRAM_TARGET
    || process.env.OPENCLAW_TELEGRAM_CHAT_ID
    || process.env.TELEGRAM_TARGET;

  if (candidate) {
    return String(candidate);
  }

  const allowFromPath = join(
    process.env.HOME || '',
    '.openclaw',
    'credentials',
    'telegram-default-allowFrom.json'
  );

  if (!existsSync(allowFromPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(allowFromPath, 'utf8'));
    if (Array.isArray(parsed.allowFrom) && parsed.allowFrom.length > 0) {
      return String(parsed.allowFrom[0]);
    }
  } catch (error) {
    console.warn('Failed to read telegram allowFrom list:', error?.message || String(error));
  }

  return null;
}

function replyMarkupToButtons(replyMarkup) {
  const inline = replyMarkup?.inline_keyboard;
  if (!Array.isArray(inline) || inline.length === 0) {
    return null;
  }

  return inline.map(row => row.map(button => ({
    text: String(button?.text || '').slice(0, 64),
    callback_data: String(button?.callback_data || button?.callbackData || '').slice(0, TELEGRAM_CALLBACK_LIMIT)
  })));
}

async function sendViaOpenClawCli(payload, options = {}) {
  const target = resolveTelegramTarget(options);
  if (!target) {
    throw new Error(
      'Telegram target not configured. Set MODEL_OPTIMIZER_TELEGRAM_TARGET or allowFrom credentials.'
    );
  }

  const args = [
    'message',
    'send',
    '--channel',
    'telegram',
    '--target',
    target,
    '--message',
    payload.text,
    '--json'
  ];

  const buttons = replyMarkupToButtons(payload.reply_markup);
  if (buttons) {
    args.push('--buttons', JSON.stringify(buttons));
  }
  if (payload.media) {
    args.push('--media', String(payload.media));
  }

  const result = await execFileAsync('openclaw', args, {
    maxBuffer: 2 * 1024 * 1024
  });

  if (result.stdout) {
    try {
      return JSON.parse(result.stdout);
    } catch {
      return { ok: true, raw: result.stdout.trim() };
    }
  }

  return { ok: true };
}

/**
 * Converts markdown into Telegram-friendly text.
 * - Flattens headings
 * - Normalizes bullets
 * - Compacts markdown tables
 * - Escapes Telegram MarkdownV2 symbols
 */
export function formatForTelegram(markdown) {
  const normalized = normalizeMarkdown(markdown);
  const escaped = escapeTelegramMarkdown(normalized);
  return truncateForTelegram(escaped);
}

/**
 * Sends a markdown report via OpenClaw's message tool.
 * @param {string} reportMarkdown
 * @param {Object} options
 * @returns {Promise<Object>} tool response
 */
export async function sendReport(reportMarkdown, options = {}) {
  const normalized = normalizeMarkdown(reportMarkdown);
  const markdownV2Text = truncateForTelegram(escapeTelegramMarkdown(normalized));
  const plainText = truncateForTelegram(normalized);

  const payload = {
    text: markdownV2Text,
    parse_mode: 'MarkdownV2'
  };

  if (options.chatId) payload.chat_id = options.chatId;
  if (options.replyMarkup) payload.reply_markup = options.replyMarkup;
  if (options.disableWebPagePreview !== undefined) {
    payload.disable_web_page_preview = options.disableWebPagePreview;
  }

  let tool = null;
  try {
    tool = resolveMessageTool(options);
  } catch {
    tool = null;
  }

  if (tool) {
    try {
      return await callMessageTool(tool, payload);
    } catch (error) {
      const reason = error?.message || String(error);
      console.warn(`Message tool send failed, trying CLI fallback: ${reason}`);
    }
  }

  try {
    return await sendViaOpenClawCli(
      {
        ...payload,
        text: plainText
      },
      options
    );
  } catch (error) {
    const reason = error?.message || String(error);
    throw new Error(`Failed to send Telegram report: ${reason}`);
  }
}

/**
 * Sends an approval request with Approve/Reject inline buttons.
 * @param {string} diff
 * @param {Object} changes
 * @param {string|Object} callbackData
 * @param {Object} options
 * @returns {Promise<Object>} tool response
 */
export async function sendApprovalRequest(diff, changes = {}, callbackData = null, options = {}) {
  const changeSetId = extractChangeSetId(callbackData, diff, changes);
  const modifiedCount = Array.isArray(changes.modifiedLines) ? changes.modifiedLines.length : 0;

  const approvalMarkdown = [
    '# Approval Required',
    '',
    'Proposed SOUL.md routing updates are ready for review.',
    '',
    '**Fallback**: If buttons aren\'t visible, reply with \'approve\' or \'reject\'.',
    '',
    '## Change Set',
    `- ID: ${changeSetId}`,
    `- Modified lines: ${modifiedCount}`,
    '',
    '## Diff',
    String(diff || 'No diff available').slice(0, 2800)
  ].join('\n');

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: 'Approve', callback_data: buildCallbackData('approve', changeSetId) },
        { text: 'Reject', callback_data: buildCallbackData('reject', changeSetId) }
      ]
    ]
  };

  return sendReport(approvalMarkdown, {
    ...options,
    replyMarkup
  });
}

/**
 * Parse callback data or text reply for approval workflow.
 * Supports:
 * - `opt:(approve|reject):<changeSetId>` (callback data)
 * - `approve <changeSetId>` (text reply, case‑insensitive)
 * - `reject <changeSetId>` (text reply, case‑insensitive)
 * @param {string} input
 * @returns {Object}
 */
export function handleCallback(input) {
  const raw = String(input || '').trim();

  let match = /^opt:item:(approve|reject|keep):([a-zA-Z0-9._-]+):(\d+)$/.exec(raw);
  if (match) {
    return {
      handled: true,
      kind: 'item',
      action: match[1],
      batchId: match[2],
      itemIndex: Number(match[3]),
      raw,
      message: 'Per-item callback parsed.'
    };
  }

  match = /^opt:final:(apply|cancel):([a-zA-Z0-9._-]+)$/.exec(raw);
  if (match) {
    return {
      handled: true,
      kind: 'final',
      action: match[1],
      batchId: match[2],
      raw,
      message: 'Final callback parsed.'
    };
  }

  // 1. Callback pattern: opt:approve:abc123
  match = /^opt:(approve|reject):(.+)$/.exec(raw);
  if (match) {
    return {
      handled: true,
      kind: 'legacy',
      action: match[1],
      changeSetId: match[2],
      raw,
      message: 'Callback parsed.'
    };
  }

  // 2. Text reply pattern: approve abc123 (allow multiple spaces)
  match = /^(approve|reject)\s+(.+)$/i.exec(raw);
  if (match) {
    return {
      handled: true,
      kind: 'legacy',
      action: match[1].toLowerCase(),
      changeSetId: match[2].trim(),
      raw,
      message: 'Text reply parsed.'
    };
  }

  // 3. Fallback: try to extract changeSetId from raw if it's a plain ID
  // (useful when action is implied by context)
  if (/^[a-zA-Z0-9_-]+$/.test(raw)) {
    return {
      handled: false,
      action: null,
      changeSetId: raw,
      raw,
      message: 'Only changeSetId found; action unknown.'
    };
  }

  return {
    handled: false,
    action: null,
    changeSetId: null,
    raw,
    message: 'Input not recognized as callback or text reply.'
  };
}

/**
 * Generates and sends the weekly optimization report.
 * @param {Object} optimizationResults
 * @param {Object} options
 * @returns {Promise<Object>} tool response
 */
export async function sendWeeklyReport(optimizationResults, options = {}) {
  const reportMarkdown = generateReport(optimizationResults);
  return sendReport(reportMarkdown, options);
}

export async function sendBusinessSummary(summaryText, options = {}) {
  const payload = {
    text: truncateForTelegram(String(summaryText || '')),
    media: options.reportPath || null
  };
  if (options.replyMarkup) {
    payload.reply_markup = options.replyMarkup;
  }
  return sendViaOpenClawCli(payload, options);
}

export async function sendPerItemApproval(item, options = {}) {
  const { batchId, itemIndex, totalItems, lineNumber, before, after } = item;
  const callbackBase = `${sanitizeCallbackId(batchId)}:${itemIndex}`;
  const replyMarkup = {
    inline_keyboard: [[
      { text: 'Approve', callback_data: `opt:item:approve:${callbackBase}` },
      { text: 'Reject', callback_data: `opt:item:reject:${callbackBase}` },
      { text: 'Keep Current', callback_data: `opt:item:keep:${callbackBase}` }
    ]]
  };

  const text = [
    `Approval Item ${itemIndex}/${totalItems}`,
    '',
    `Batch: ${batchId}`,
    `Line: ${lineNumber}`,
    '',
    `Current: ${before}`,
    `Suggested: ${after}`
  ].join('\n');

  return sendBusinessSummary(text, {
    ...options,
    replyMarkup
  });
}

export async function sendFinalConfirmation(batchId, summary, options = {}) {
  const safeBatchId = sanitizeCallbackId(batchId);
  const replyMarkup = {
    inline_keyboard: [[
      { text: 'Apply Approved', callback_data: `opt:final:apply:${safeBatchId}` },
      { text: 'Cancel Batch', callback_data: `opt:final:cancel:${safeBatchId}` }
    ]]
  };

  const text = [
    'Final Confirmation Required',
    '',
    `Batch: ${batchId}`,
    `Approved: ${summary.approved}`,
    `Kept current: ${summary.kept}`,
    `Rejected: ${summary.rejected}`,
    '',
    'Apply only approved items now?'
  ].join('\n');

  return sendBusinessSummary(text, {
    ...options,
    replyMarkup
  });
}

/**
 * Sends approval request for a diff and changeset metadata.
 * @param {string} diff
 * @param {Object} changes
 * @param {Object} options
 * @returns {Promise<Object>} tool response
 */
export async function sendApprovalWithDiff(diff, changes = {}, options = {}) {
  const callbackData = options.callbackData || {
    jobId: options.jobId || createHash('sha256').update(`${diff || ''}:${JSON.stringify(changes || {})}`).digest('hex').slice(0, 16)
  };

  return sendApprovalRequest(diff, changes, callbackData, options);
}

export default {
  formatForTelegram,
  sendReport,
  sendApprovalRequest,
  sendBusinessSummary,
  sendPerItemApproval,
  sendFinalConfirmation,
  handleCallback,
  sendWeeklyReport,
  sendApprovalWithDiff
};
