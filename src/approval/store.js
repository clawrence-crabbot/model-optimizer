/**
 * Pending changes storage for approval workflow.
 * Uses file‑based storage under data/pending/.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PENDING_DIR = resolve(__dirname, '../../data/pending');
const BATCH_PREFIX = 'batch-';

function ensurePendingDir() {
  if (!existsSync(PENDING_DIR)) {
    mkdirSync(PENDING_DIR, { recursive: true });
  }
}

function pendingPath(changeSetId) {
  ensurePendingDir();
  const safeId = String(changeSetId).replace(/[^a-zA-Z0-9._-]/g, '_');
  return join(PENDING_DIR, `${safeId}.json`);
}

/**
 * Stores a changeset for later approval.
 * @param {string} changeSetId
 * @param {Object} changes
 * @param {Object} metadata
 * @returns {string} stored file path
 */
export function storePendingChanges(changeSetId, changes, metadata = {}) {
  const path = pendingPath(changeSetId);
  const payload = {
    changeSetId,
    storedAt: new Date().toISOString(),
    changes,
    metadata
  };

  writeFileSync(path, JSON.stringify(payload, null, 2), 'utf8');
  return path;
}

/**
 * Retrieves a pending changeset.
 * @param {string} changeSetId
 * @returns {Object|null} payload or null if not found
 */
export function retrievePendingChanges(changeSetId) {
  const path = pendingPath(changeSetId);
  if (!existsSync(path)) {
    return null;
  }

  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw);
}

/**
 * Removes a pending changeset after approval/rejection.
 * @param {string} changeSetId
 * @returns {boolean} true if removed, false if not found
 */
export function removePendingChanges(changeSetId) {
  const path = pendingPath(changeSetId);
  if (!existsSync(path)) {
    return false;
  }

  unlinkSync(path);
  return true;
}

/**
 * Lists all pending changeSetIds.
 * @returns {string[]}
 */
export function listPendingChanges() {
  ensurePendingDir();
  const files = readdirSync(PENDING_DIR)
    .filter(file => file.endsWith('.json'))
    .filter(file => !file.startsWith(BATCH_PREFIX))
    .map(file => file.slice(0, -5));
  return files;
}

function batchPath(batchId) {
  ensurePendingDir();
  const safeId = String(batchId).replace(/[^a-zA-Z0-9._-]/g, '_');
  return join(PENDING_DIR, `${BATCH_PREFIX}${safeId}.json`);
}

export function createApprovalBatch(batchId, soulPath, reportPath, items = [], metadata = {}) {
  const payload = {
    batchId,
    soulPath,
    reportPath,
    createdAt: new Date().toISOString(),
    status: 'pending',
    finalRequestSent: false,
    items,
    metadata
  };
  writeFileSync(batchPath(batchId), JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

export function getApprovalBatch(batchId) {
  const path = batchPath(batchId);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function saveApprovalBatch(batch) {
  if (!batch?.batchId) {
    throw new Error('batchId is required');
  }
  writeFileSync(batchPath(batch.batchId), JSON.stringify(batch, null, 2), 'utf8');
  return batch;
}

export function listApprovalBatches() {
  ensurePendingDir();
  return readdirSync(PENDING_DIR)
    .filter(file => file.endsWith('.json'))
    .filter(file => file.startsWith(BATCH_PREFIX))
    .map(file => file.slice(BATCH_PREFIX.length, -5));
}

export function expireAllApprovalBatches(reason = 'superseded') {
  const batchIds = listApprovalBatches();
  for (const batchId of batchIds) {
    const batch = getApprovalBatch(batchId);
    if (!batch) continue;
    batch.status = 'expired';
    batch.expiredAt = new Date().toISOString();
    batch.expireReason = reason;
    for (const item of batch.items || []) {
      if (item.status === 'pending') item.status = 'expired';
    }
    saveApprovalBatch(batch);
  }
  return batchIds.length;
}

export function setBatchItemDecision(batchId, itemIndex, decision) {
  const batch = getApprovalBatch(batchId);
  if (!batch) return null;
  const idx = Number(itemIndex);
  if (!Number.isInteger(idx) || idx < 1 || idx > batch.items.length) {
    throw new Error(`Invalid item index: ${itemIndex}`);
  }
  const item = batch.items[idx - 1];
  item.status = decision;
  item.decidedAt = new Date().toISOString();
  saveApprovalBatch(batch);
  return batch;
}

export function summarizeBatch(batch) {
  const summary = { total: 0, pending: 0, approved: 0, rejected: 0, kept: 0, expired: 0 };
  for (const item of batch?.items || []) {
    summary.total += 1;
    const status = item.status || 'pending';
    if (summary[status] === undefined) summary[status] = 0;
    summary[status] += 1;
  }
  return summary;
}

export function batchReadyForFinalConfirmation(batch) {
  if (!batch || batch.status !== 'pending') return false;
  const summary = summarizeBatch(batch);
  return summary.total > 0 && summary.pending === 0;
}

export function buildApplyChangesFromBatch(batch) {
  const base = batch?.items?.[0]?.changes;
  if (!base) {
    throw new Error('Batch has no changes');
  }

  const originalLines = String(base.originalContent || '').split('\n');
  const proposedLines = [...originalLines];
  const approvedLines = [];

  for (const item of batch.items || []) {
    if (item.status !== 'approved') continue;
    const line = item?.changes?.modifiedLines?.[0];
    if (!line) continue;
    proposedLines[line.lineNumber - 1] = line.after;
    approvedLines.push(line);
  }

  return {
    path: base.path,
    resolvedPath: base.resolvedPath,
    originalContent: base.originalContent,
    proposedContent: proposedLines.join('\n'),
    modifiedLines: approvedLines
  };
}

export default {
  storePendingChanges,
  retrievePendingChanges,
  removePendingChanges,
  listPendingChanges,
  createApprovalBatch,
  getApprovalBatch,
  saveApprovalBatch,
  listApprovalBatches,
  expireAllApprovalBatches,
  setBatchItemDecision,
  summarizeBatch,
  batchReadyForFinalConfirmation,
  buildApplyChangesFromBatch
};
