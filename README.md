# Commerce Growth OS

AI-assisted commerce growth platform for product discovery, feed quality, search intelligence, advertising analytics, and controlled optimization across Google and Pinterest.

## v0.1 scope
- Canonical product schema
- Product metadata quality scoring
- Search-intent clustering
- Google Merchant feed generation layer
- Pinterest feed generation layer
- Optimization recommendation model
- Human approval gates
- Initial dashboard shell
- Tests, security rules, and CI foundations

## Explicitly out of scope for v0.1
- Automatic campaign publishing
- Automatic budget increases
- Automatic destructive actions
- Fully autonomous bidding changes

## Architecture

```text
Canonical Product Data
        |
        +--> Search Intelligence
        |
        +--> Metadata Optimizer
        |        |
        |        +--> Google Merchant adapter
        |        +--> Pinterest adapter
        |
        +--> Analytics Engine
                 |
                 +--> Recommendations
                          |
                          +--> Human Approval
```

## Engineering team
Claude Code is organized around six specialist roles stored under `.claude/agents/`.

## Local setup
1. Copy `.env.example` to `.env.local`.
2. Add only local development credentials.
3. Never commit `.env.local`.
4. Run tests before opening a pull request.

## First milestone
See `docs/plans/v0.1.md`.
