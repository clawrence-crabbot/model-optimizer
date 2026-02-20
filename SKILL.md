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
- **Price Monitoring**: Weekly scraping of Anthropic, Google, DeepSeek pricing
- **Model Discovery**: Scans AI hubs for new cost-effective models
- **Optimization**: Calculates best model per task type (coding, reasoning, chat, etc.)
- **Safe Updates**: Requires user approval before modifying SOUL.md
- **Reporting**: Telegram summary + detailed markdown reports

## Safety
- Never modifies files without explicit user approval
- Quality guardrails (models must be within 10% of baseline)
- Fallback to cached data if scraping fails
- Git Flow workflow for all changes

## Integration
Designed for OpenClaw with Telegram approval workflow. Updates SOUL.md routing tables only.