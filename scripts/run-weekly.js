#!/usr/bin/env node

/**
 * Model Optimizer - Weekly Cron Entry Point
 *
 * Usage:
 *   node run-weekly.js --dry-run    # Generate report only
 *   node run-weekly.js --apply      # Apply changes after approval
 */

import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import * as optimizer from '../src/optimizer/index.js';
import * as discovery from '../src/discovery/index.js';
import * as config from '../src/config/index.js';
import * as reporting from '../src/reporting/index.js';
import * as store from '../src/approval/store.js';
import { fetchAllPricing } from '../src/pricing/index.js';

const args = parseArgs({
  options: {
    'dry-run': { type: 'boolean', short: 'd' },
    'apply': { type: 'boolean', short: 'a' },
    'help': { type: 'boolean', short: 'h' }
  },
  allowPositionals: true
});

if (args.values.help) {
  console.log(`
Model Optimizer - Weekly Cost-Quality Optimization

Usage:
  node run-weekly.js [options]

Options:
  -d, --dry-run    Generate report only (default)
  -a, --apply      Apply changes (requires approval)
  -h, --help       Show this help

Description:
  This script runs the weekly model optimization pipeline:
  1. Collect current pricing from providers
  2. Discover task types from SOUL.md
  3. Calculate optimal routing per task type
  4. Generate report with recommendations
  5. If --apply and approved, update SOUL.md
  `);
  process.exit(0);
}

if (args.values.apply && args.values['dry-run']) {
  console.error('Invalid options: use either --dry-run or --apply, not both.');
  process.exit(1);
}

const mode = args.values.apply ? 'apply' : 'dry-run';
const soulPath = resolve(process.env.SOUL_PATH || join(process.cwd(), 'test/fixtures/SOUL.md'));

function logStep(step, message) {
  console.log(`[Git Flow][${step}] ${message}`);
}

function getGitBranch() {
  try {
    const gitHeadPath = resolve(process.cwd(), '.git/HEAD');
    if (!existsSync(gitHeadPath)) {
      return 'unknown';
    }

    const head = readFileSync(gitHeadPath, 'utf8').trim();
    if (head.startsWith('ref:')) {
      const ref = head.slice(5).trim();
      if (ref.startsWith('refs/heads/')) {
        return ref.slice('refs/heads/'.length);
      }
      return ref;
    }

    return head.slice(0, 7);
  } catch {
    return 'unknown';
  }
}

function isGitFlowBranch(branch) {
  return branch === 'main'
    || branch === 'develop'
    || branch.startsWith('feature/')
    || branch.startsWith('release/')
    || branch.startsWith('hotfix/');
}

function summarizePricing(pricingByProvider) {
  const providers = Object.keys(pricingByProvider);
  const providerSummary = providers.map(provider => {
    const models = Array.isArray(pricingByProvider[provider]) ? pricingByProvider[provider].length : 0;
    return `${provider}:${models}`;
  });
  const totalModels = Object.values(pricingByProvider)
    .flatMap(models => (Array.isArray(models) ? models : []))
    .length;

  return { totalModels, providerSummary };
}

function buildReportPath() {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:]/g, '-').replace(/\.\d{3}Z$/, 'Z');
  const reportsDir = resolve(process.cwd(), 'reports');
  mkdirSync(reportsDir, { recursive: true });
  return join(reportsDir, `weekly-${stamp}.md`);
}

function buildSingleItemChangeSet(changes, modifiedLine) {
  const originalLines = String(changes.originalContent || '').split('\n');
  const proposedLines = [...originalLines];
  proposedLines[modifiedLine.lineNumber - 1] = modifiedLine.after;

  return {
    path: changes.path,
    resolvedPath: changes.resolvedPath,
    originalContent: changes.originalContent,
    proposedContent: proposedLines.join('\n'),
    modifiedLines: [modifiedLine]
  };
}

function buildBusinessSummary({ mode, reportPath, modelsAnalyzed, actionableCount, scoredCount, sentItems }) {
  const lines = [
    'Model Optimizer Weekly Summary',
    '',
    `Mode: ${mode}`,
    `Models analyzed: ${modelsAnalyzed}`,
    `Actionable changes (need approval): ${actionableCount}`,
    `Scored suggestions (reference only): ${scoredCount}`,
    `Approval items sent: ${sentItems}`,
    '',
    `Report file: ${reportPath}`
  ];
  return lines.join('\n');
}

function stageReportAttachment(reportPath) {
  const home = process.env.HOME || '';
  const mediaDir = resolve(join(home, '.openclaw', 'media', 'outbound'));
  mkdirSync(mediaDir, { recursive: true });
  const filename = reportPath.split('/').pop();
  const stagedPath = join(mediaDir, filename);
  copyFileSync(reportPath, stagedPath);
  return stagedPath;
}

async function main() {
  console.log(`Starting Model Optimizer (${mode} mode)`);
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`SOUL path: ${soulPath}`);
  console.log('---');

  logStep('1/8', 'Validate Git Flow context');
  const branch = getGitBranch();
  console.log(`Current branch: ${branch}`);
  if (!isGitFlowBranch(branch)) {
    console.warn(`Branch "${branch}" is outside standard Git Flow naming.`);
  }

  logStep('2/8', 'Collect pricing data (fetchAllPricing)');
  const pricingData = await fetchAllPricing();
  const pricingSummary = summarizePricing(pricingData);
  if (pricingSummary.totalModels === 0) {
    throw new Error('Pricing collection returned zero models across all providers.');
  }
  console.log(`Pricing collected: ${pricingSummary.totalModels} model(s) [${pricingSummary.providerSummary.join(', ')}]`);

  logStep('3/8', 'Discover task types from SOUL.md (discoverTaskTypes)');
  const soulContent = readFileSync(soulPath, 'utf8');
  const discoveryResults = await discovery.discoverTaskTypes(soulContent);
  console.log(
    `Discovery complete: total=${discoveryResults.totalTasks}, known=${discoveryResults.knownTasks.length}, ` +
    `unknown=${discoveryResults.unknownTasks.length}, new=${discoveryResults.newlyDiscovered.length}`
  );

  logStep('4/8', 'Run optimization (optimizeRouting)');
  const optimizationResults = await optimizer.optimizeRouting(soulPath);
  const recommendationCount = Array.isArray(optimizationResults.recommendations)
    ? optimizationResults.recommendations.length
    : 0;
  console.log(`Optimization complete: ${recommendationCount} recommendation(s)`);

  logStep('5/8', 'Generate report (generateReport)');
  const reportMarkdown = optimizer.generateReport(optimizationResults);
  const reportPath = buildReportPath();
  writeFileSync(reportPath, reportMarkdown, 'utf8');
  const stagedReportPath = stageReportAttachment(reportPath);
  console.log(`Report written: ${reportPath}`);

  const previewUpdate = config.updateSoulConfig(optimizationResults.recommendations, soulPath, true);
  console.log(`Preview diff prepared: ${previewUpdate.modifiedCount} modified line(s)`);

  if (mode === 'dry-run') {
    logStep('6/8', 'Send business summary + report attachment');
    try {
      const summary = buildBusinessSummary({
        mode,
        reportPath,
        modelsAnalyzed: pricingSummary.totalModels,
        actionableCount: previewUpdate.modifiedCount,
        scoredCount: recommendationCount,
        sentItems: 0
      });
      await reporting.sendBusinessSummary(summary, { reportPath: stagedReportPath });
      console.log('Weekly summary sent to Telegram with report attachment.');
    } catch (error) {
      console.warn(`Failed to send weekly summary: ${error.message}`);
      console.warn('Dry run continues without remote notification.');
    }

    logStep('7/8', 'Dry run safety gate');
    console.log('Dry run complete. No SOUL.md changes were applied.');
    logStep('8/8', 'Pipeline finished');
    return;
  }

  logStep('6/8', 'Send business summary + per-item approvals');
  const expired = store.expireAllApprovalBatches('superseded-by-new-run');
  if (expired > 0) {
    console.log(`Expired ${expired} previous approval batch(es).`);
  }

  const batchId = `weekly-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const items = (previewUpdate.changes.modifiedLines || []).map((modifiedLine, idx) => {
    const itemChanges = buildSingleItemChangeSet(previewUpdate.changes, modifiedLine);
    return {
      itemIndex: idx + 1,
      lineNumber: modifiedLine.lineNumber,
      before: modifiedLine.before.trim(),
      after: modifiedLine.after.trim(),
      status: 'pending',
      changes: itemChanges
    };
  });

  store.createApprovalBatch(batchId, soulPath, reportPath, items, {
    recommendationCount,
    modifiedCount: previewUpdate.modifiedCount
  });

  const summary = buildBusinessSummary({
    mode,
    reportPath,
    modelsAnalyzed: pricingSummary.totalModels,
    actionableCount: previewUpdate.modifiedCount,
    scoredCount: recommendationCount,
    sentItems: items.length
  });
  try {
    await reporting.sendBusinessSummary(summary, { reportPath: stagedReportPath });
    console.log('Business summary sent to Telegram with report attachment.');
  } catch (error) {
    console.warn(`Failed to send business summary: ${error.message}`);
  }

  if (previewUpdate.modifiedCount === 0) {
    console.log('No routing changes proposed. Nothing to approve or apply.');
    logStep('8/8', 'Pipeline finished');
    return;
  }
  let sentCount = 0;

  for (const item of items) {
    try {
      await reporting.sendPerItemApproval({
        ...item,
        batchId,
        totalItems: items.length
      });
      sentCount += 1;
      console.log(`Approval item sent (${item.itemIndex}/${items.length}) line ${item.lineNumber}.`);
    } catch (error) {
      console.warn(`Failed to send approval item ${item.itemIndex}: ${error.message}`);
    }
  }

  logStep('7/8', 'Approval gate');
  console.log('No changes were applied by this run.');
  console.log('Approval is required for every routing change.');
  console.log(`Batch ID: ${batchId}`);
  console.log(`Approval items sent: ${sentCount}/${items.length}`);
  console.log('Approve/reject/keep each item via Telegram buttons, then finalize with Apply Approved.');
  logStep('8/8', 'Pipeline finished (pending external approval)');
}

try {
  await main();
} catch (error) {
  console.error(`Pipeline failed: ${error.message}`);
  process.exit(1);
}
