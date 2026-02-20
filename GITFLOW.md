# Git Flow Workflow

## Branches
- **main**: Production releases (tagged versions)
- **develop**: Integration branch for features
- **feature/***: New functionality (branched from develop)
- **release/***: Release preparation (branched from develop)
- **hotfix/***: Emergency fixes (branched from main)

## Workflow

### Starting a new feature
```bash
git checkout develop
git pull origin develop
git checkout -b feature/feature-name
# Develop feature...
git commit -m "Add feature-name"
git push origin feature/feature-name
```

### Completing a feature
```bash
git checkout develop
git pull origin develop
git merge --no-ff feature/feature-name
git branch -d feature/feature-name
git push origin develop
```

### Starting a release
```bash
git checkout develop
git checkout -b release/1.2.0
# Update version, changelog, etc.
git commit -m "Bump version to 1.2.0"
```

### Finishing a release
```bash
git checkout main
git merge --no-ff release/1.2.0
git tag -a v1.2.0 -m "Release 1.2.0"
git checkout develop
git merge --no-ff release/1.2.0
git branch -d release/1.2.0
git push origin main --tags
git push origin develop
```

### Hotfix
```bash
git checkout main
git checkout -b hotfix/urgent-fix
# Fix the issue...
git commit -m "Fix urgent issue"
git checkout main
git merge --no-ff hotfix/urgent-fix
git tag -a v1.2.1 -m "Hotfix 1.2.1"
git checkout develop
git merge --no-ff hotfix/urgent-fix
git branch -d hotfix/urgent-fix
git push origin main --tags
git push origin develop
```

## Commit Message Convention
- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation
- `style:` Formatting, missing semi-colons, etc.
- `refactor:` Code restructuring
- `test:` Adding tests
- `chore:` Maintenance tasks

## Code Review
All merges to develop/main require:
1. Passing tests
2. No linting errors
3. Approval from maintainer