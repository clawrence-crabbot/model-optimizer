#!/usr/bin/env node

/**
 * Process Telegram callback or text-reply for model-optimizer approval workflow.
 *
 * New flow:
 * - Item decision: opt:item:(approve|reject|keep):<batchId>:<itemIndex>
 * - Final action:  opt:final:(apply|cancel):<batchId>
 *
 * Legacy flow is still supported:
 * - opt:(approve|reject):<changeSetId>
 * - approve <changeSetId>
 * - reject <changeSetId>
 */

import { parseArgs } from 'node:util';
import * as reporting from '../src/reporting/index.js';
import * as config from '../src/config/index.js';
import * as store from '../src/approval/store.js';

const args = parseArgs({
  options: {
    help: { type: 'boolean', short: 'h' },
    approve: { type: 'string' },
    reject: { type: 'string' }
  },
  allowPositionals: true,
  strict: false
});

const positional = args.positionals;
const { help, approve, reject } = args.values;

if (help) {
  console.log(`
Model Optimizer Callback Processor

Usage:
  node scripts/process-callback.js <callback-data>
  node scripts/process-callback.js --approve <changeSetId>
  node scripts/process-callback.js --reject <changeSetId>

Examples:
  node scripts/process-callback.js "opt:item:approve:weekly-...:1"
  node scripts/process-callback.js "opt:final:apply:weekly-..."
  node scripts/process-callback.js "opt:approve:abc123"
  node scripts/process-callback.js --reject abc123
`);
  process.exit(0);
}

function normalizeDecision(actionName) {
  if (actionName === 'approve') return 'approved';
  if (actionName === 'reject') return 'rejected';
  if (actionName === 'keep') return 'kept';
  return null;
}

async function handleBatchCallback(parsed) {
  if (parsed.kind === 'item') {
    const decision = normalizeDecision(parsed.action);
    if (!decision) {
      throw new Error(`Unsupported item action: ${parsed.action}`);
    }

    const batch = store.setBatchItemDecision(parsed.batchId, parsed.itemIndex, decision);
    if (!batch) {
      throw new Error(`Batch not found: ${parsed.batchId}`);
    }

    const summary = store.summarizeBatch(batch);
    console.log(
      `Item recorded: batch=${parsed.batchId} item=${parsed.itemIndex} decision=${decision} ` +
      `(approved=${summary.approved}, kept=${summary.kept}, rejected=${summary.rejected}, pending=${summary.pending})`
    );

    if (store.batchReadyForFinalConfirmation(batch) && !batch.finalRequestSent) {
      await reporting.sendFinalConfirmation(batch.batchId, summary);
      batch.finalRequestSent = true;
      store.saveApprovalBatch(batch);
      console.log('Final confirmation request sent.');
    }
    return;
  }

  if (parsed.kind === 'final') {
    const batch = store.getApprovalBatch(parsed.batchId);
    if (!batch) {
      throw new Error(`Batch not found: ${parsed.batchId}`);
    }

    if (parsed.action === 'cancel') {
      batch.status = 'cancelled';
      batch.cancelledAt = new Date().toISOString();
      store.saveApprovalBatch(batch);
      console.log(`Batch cancelled: ${parsed.batchId}`);
      return;
    }

    if (!store.batchReadyForFinalConfirmation(batch)) {
      throw new Error('Batch is not ready for final apply; pending items remain.');
    }

    const applyChanges = store.buildApplyChangesFromBatch(batch);
    if (!Array.isArray(applyChanges.modifiedLines) || applyChanges.modifiedLines.length === 0) {
      batch.status = 'completed-noop';
      batch.completedAt = new Date().toISOString();
      store.saveApprovalBatch(batch);
      console.log(`Batch completed as no-op: ${parsed.batchId}`);
      return;
    }

    const result = config.applyChanges(batch.soulPath, applyChanges, false);
    batch.status = 'applied';
    batch.appliedAt = new Date().toISOString();
    batch.applyResult = {
      modifiedLines: applyChanges.modifiedLines.length,
      backupPath: result.backupPath || null
    };
    store.saveApprovalBatch(batch);
    console.log(`Applied ${applyChanges.modifiedLines.length} approved item(s). Backup: ${result.backupPath || 'none'}`);
  }
}

async function handleLegacyApproval(action, changeSetId) {
  const pending = store.retrievePendingChanges(changeSetId);
  if (!pending) {
    throw new Error(`No pending changes found for changeSetId ${changeSetId}.`);
  }

  console.log(`Legacy changeset found: ${changeSetId} (${pending.changes.modifiedLines?.length || 0} line(s))`);

  if (action === 'reject') {
    store.removePendingChanges(changeSetId);
    console.log('Legacy changeset rejected and removed.');
    return;
  }

  const result = config.applyChanges(pending.changes.path, pending.changes, false);
  store.removePendingChanges(changeSetId);
  console.log(`Legacy changeset applied. Backup: ${result.backupPath || 'none'}`);
}

try {
  if (approve || reject) {
    const action = approve ? 'approve' : 'reject';
    const changeSetId = approve || reject;
    await handleLegacyApproval(action, changeSetId);
    process.exit(0);
  }

  if (!positional.length) {
    throw new Error('No input provided. Use --help for usage.');
  }

  const raw = positional[0];
  const stripped = raw.startsWith('callback_data: ') ? raw.slice('callback_data: '.length) : raw;
  const parsed = reporting.handleCallback(stripped);

  if (parsed?.kind === 'item' || parsed?.kind === 'final') {
    await handleBatchCallback(parsed);
    process.exit(0);
  }

  if (parsed?.kind === 'legacy' && parsed.action && parsed.changeSetId) {
    await handleLegacyApproval(parsed.action, parsed.changeSetId);
    process.exit(0);
  }

  throw new Error(`Unrecognized callback input: ${stripped}`);
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}
