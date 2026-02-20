# Model Optimizer Skill

A Git Flow managed skill for optimizing AI model routing based on cost-quality trade-offs.

## Git Flow Workflow
- **main**: Production releases
- **develop**: Integration branch
- **feature/***: New features
- **release/***: Release preparation
- **hotfix/***: Emergency fixes

## Development
```bash
# Create feature branch
git checkout develop
git checkout -b feature/price-scraper

# Merge to develop
git checkout develop
git merge --no-ff feature/price-scraper

# Create release
git checkout develop
git checkout -b release/1.0.0

# Hotfix from main
git checkout main
git checkout -b hotfix/urgent-fix
```

## Project Structure
```
src/
├── pricing/      # Price scrapers
├── discovery/    # New model discovery
├── optimizer/    # Cost-quality calculations
├── config/       # SOUL.md updates
└── reporting/    # Reports & notifications

scripts/
└── run-weekly.js # Cron entry point

data/            # Cache files
tests/           # Unit tests
test/fixtures/   # Test data
```

## Installation
```bash
# Clone and install dependencies
git clone <repo>
cd model-optimizer
npm install
```

## License
MIT