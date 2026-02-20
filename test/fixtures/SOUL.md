# SOUL.md - TEST FIXTURE

## Model Routing (Test Section)
**Daily Conversation Track:**
- Casual chat, greetings, jokes: DeepSeek Chat
- Simple Q&A (one-line answers): DeepSeek Chat

**Action Task Track:**
- Browser operations → Gemini 3 Flash
- Exec commands → Claude Haiku
- File operations → Gemini 2.5 Flash
- Web search/fetch → Gemini 3 Flash
- Process management → Claude Haiku
- GitHub CLI → Claude Haiku
- Multi-step planning → DeepSeek Reasoner
- Requirements engineering → DeepSeek Reasoner
- Calendar/email checking → Claude Haiku
- Research and synthesis → Gemini 3 Flash
- Complex problem-solving → DeepSeek Reasoner
- Analysis and breakdowns → DeepSeek Reasoner

**Further escalation:**
- Code changes: Claude Haiku first
- Escalate to Claude Sonnet only if ANY of:
  - >3 files touched
  - >150 LOC changed
  - schema/migration/auth/security boundaries touched
  - first Haiku fix attempt failed
- Strategic/novel problems: Claude Opus (only after Sonnet fails)
- Debugging: Claude Haiku
- Formatting: Claude Haiku
- Summaries: Gemini 3 Flash
- File edits: cheap/simple edits use Gemini 2.5 Flash, higher risk edits use Haiku

## Pricing Reference (Test Data)
| Model | Input/M | Output/M |
|-------|---------|----------|
| DeepSeek Chat | $0.07 | $1.10 |
| DeepSeek Reasoner | $0.07 | $1.10 |
| Gemini 3 Flash | $0.50 | $3.00 |
| Gemini 2.5 Flash | $0.50 | $3.00 |
| Claude Haiku | $0.80 | $4.00 |
| Claude Sonnet | $3.00 | $15.00 |
| Claude Opus | $15.00 | $75.00 |