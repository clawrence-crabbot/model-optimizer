# Model Optimizer Skill

## Description
Automated cost-quality optimizer for AI model routing. Monitors provider pricing, discovers new models, calculates optimal routing, and updates SOUL.md with permission-based approval.

## Usage
```bash
# Weekly cron job (dry-run first)
node scripts/run-weekly.js --dry-run

# Apply changes after approval
node scripts/run-weekly.js --apply
```

## Features
- **Price Monitoring**: Weekly pricing collection from Anthropic, Google, DeepSeek, Moonshot, OpenAI, Alibaba, Meta, and Microsoft
- **Model Discovery**: Scans AI hubs for new cost-effective models
- **Optimization**: Calculates best model per task type (coding, reasoning, chat, etc.)
- **Safe Updates**: Requires user approval before modifying SOUL.md
- **Reporting**: Telegram summary + detailed markdown reports
- **Git Flow Compliance**: Full feature/release/hotfix branching

## Safety
- Never modifies files without explicit user approval
- Quality guardrails (models must be within 10% of baseline)
- Fallback to cached data if scraping fails
- Git Flow workflow for all changes
- Backup of SOUL.md before any modifications

## Integration
Designed for OpenClaw with Telegram approval workflow. Updates SOUL.md routing tables only.

### OpenClaw Cron Setup
Add to your OpenClaw config (`~/.openclaw/openclaw.json`):

```json
{
  "cron": {
    "jobs": [
      {
        "name": "model-optimizer-weekly",
        "schedule": {
          "kind": "cron",
          "expr": "0 2 * * 0",
          "tz": "America/Chicago"
        },
        "payload": {
          "kind": "agentTurn",
          "message": "Run weekly model optimization with --apply",
          "model": "google/gemini-3-flash-preview"
        },
        "sessionTarget": "isolated",
        "enabled": true,
        "notify": true
      }
    ]
  }
}
```

### Telegram Setup
Ensure your Telegram bot has `inlineQueries` enabled via BotFather:
```
/setinline
/setinlinefeedback
/setprivacy disabled
```

### Approval Workflow
1. Weekly run sends a **business summary** message and attaches the full markdown report file
2. For each suggested routing change, a separate Telegram item is sent with `Approve` / `Reject` / `Keep Current`
3. Item decisions only mark state; nothing is applied immediately
4. After all items are decided, a final Telegram confirmation appears: `Apply Approved` / `Cancel Batch`
5. Only after final confirmation are approved items applied to SOUL.md
6. Starting a new run auto-expires older pending approval batches

### Callback Processing
When a button is pressed, OpenClaw receives a `callback_data:` message. To process it automatically, add a cron job that runs the callback handler:

```json
{
  "cron": {
    "jobs": [
      {
        "name": "model-optimizer-callback",
        "schedule": { "kind": "every", "everyMs": 30000 },
        "payload": {
          "kind": "agentTurn",
          "message": "Check for callback messages and run process‑callback if any",
          "model": "google/gemini-3-flash-preview"
        },
        "sessionTarget": "isolated",
        "enabled": true,
        "notify": false
      }
    ]
  }
}
```

Alternatively, process callbacks manually:

```bash
node scripts/process-callback.js "callback_data: opt:item:approve:<batchId>:<itemIndex>"
node scripts/process-callback.js "callback_data: opt:item:keep:<batchId>:<itemIndex>"
node scripts/process-callback.js "callback_data: opt:final:apply:<batchId>"
```

Pending changes are stored in `data/pending/` and removed after approval/rejection.

### Environment Variables
- `GEMINI_API_KEY`: Required for task classification (Gemini 2.5 Flash)
- `SOUL_PATH`: Optional path to SOUL.md (default: workspace root)

### Installation
```bash
clawhub install model-optimizer
cd ~/.openclaw/workspace/skills/model-optimizer
npm install
```
