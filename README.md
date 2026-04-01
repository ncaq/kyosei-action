# kyosei-action

GitHub Action for
[kyosei](https://github.com/ncaq/konoka/tree/master/plugins/kyosei)
code review from
[konoka](https://github.com/ncaq/konoka)
marketplace.

Kyosei is a multi-perspective AI code review plugin that analyzes pull requests
for code quality, performance, security, test coverage, and documentation accuracy.

This repository provides a Composite Action and a Reusable Workflow.
The Composite Action is a low-level building block
that requires the caller to handle checkout and permissions.
For simpler setup, use the Reusable Workflow.

## Authentication

At least one of the following is required.
Typically you only need one; if multiple are provided they are passed through to claude-code-action as-is.

- `claude_code_oauth_token` - Claude Code OAuth token
- `anthropic_api_key` - Anthropic API key
- A cloud provider (`use_bedrock`, `use_vertex`, or `use_foundry`)

### Token Setup (OAuth token)

#### Obtain a Claude Code OAuth token:

```console
claude --bare setup-token
```

Copy the output token.

#### Set the token as a repository secret for GitHub Actions:

```console
gh secret set CLAUDE_CODE_OAUTH_TOKEN
```

Paste the token when prompted.

#### If Dependabot also triggers reviews, set the token as a Dependabot secret:

```console
gh secret set CLAUDE_CODE_OAUTH_TOKEN --app dependabot
```

Paste the token when prompted.

## Reusable Workflow

Handles checkout and timeout internally.
Permissions must be declared by the caller
since the reusable workflow is constrained by the caller's permissions.

```yaml
name: Kyosei

on:
  pull_request:
    types: [opened, synchronize]

# Reusable workflows are constrained by the caller's permissions,
# so they must be explicitly declared here.
permissions:
  checks: read # Reference CI results
  contents: read # Read repository contents for review
  discussions: read # Reference discussions
  id-token: write # Required for Claude Code Action
  issues: read # Reference issues
  pages: read # Reference existing documentation
  pull-requests: write # Post review comments on PRs
  repository-projects: read # Reference project schedules
  security-events: read # Reference vulnerability reports

jobs:
  kyosei:
    uses: ncaq/kyosei-action/.github/workflows/review.yml@<commit-hash> # v1.0.0
    secrets:
      claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

Most Composite Action inputs can be passed via `with:`.
The Reusable Workflow additionally accepts `fetch-depth` and `timeout-minutes`,
but does not expose `github_token` (it manages checkout and tokens internally).
See the Composite Action section below for the full input list.

## Composite Action

### Usage

Pinning by commit hash is recommended for security.

```yaml
name: Kyosei

on:
  pull_request:
    types: [opened, synchronize]

permissions:
  checks: read # Reference CI results
  contents: read # Read repository contents for review
  discussions: read # Reference discussions
  id-token: write # Required for Claude Code Action
  issues: read # Reference issues
  pages: read # Reference existing documentation
  pull-requests: write # Post review comments on PRs
  repository-projects: read # Reference project schedules
  security-events: read # Reference vulnerability reports

jobs:
  review:
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          persist-credentials: false
          fetch-depth: 50
      - uses: ncaq/kyosei-action@<commit-hash> # v1.0.0
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

### Inputs

| Name                       | Description                                             | Required | Default                              |
| -------------------------- | ------------------------------------------------------- | -------- | ------------------------------------ |
| `claude_code_oauth_token`  | Claude Code OAuth token                                 | No       |                                      |
| `anthropic_api_key`        | Anthropic API key (alternative to OAuth token)          | No       |                                      |
| `model`                    | Claude model to use                                     | No       | `opus[1m]`                           |
| `github_token`             | GitHub token (omit to use Claude GitHub App)            | No       | `""`                                 |
| `allowed_bots`             | Allowed bot usernames or `*` for all                    | No       | `*`                                  |
| `allowed_tools`            | Allowed tools (newline-separated, replaces default set) | No       | See below                            |
| `additional_allowed_tools` | Additional tools to append (newline-separated)          | No       | `""`                                 |
| `claude_args`              | Additional CLI arguments                                | No       | `""`                                 |
| `use_bedrock`              | Use Amazon Bedrock with OIDC                            | No       | `false`                              |
| `use_vertex`               | Use Google Vertex AI with OIDC                          | No       | `false`                              |
| `use_foundry`              | Use Microsoft Foundry with OIDC                         | No       | `false`                              |
| `konoka_marketplace_url`   | Git URL of the Konoka marketplace                       | No       | `https://github.com/ncaq/konoka.git` |
| `plugin_name`              | Plugin identifier within the marketplace                | No       | `kyosei@konoka`                      |

#### Default allowed tools

```yaml
allowed_tools: |
  Bash(gh api *issues/*/comments*)
  Bash(gh api *pulls/*/comments*)
  Bash(gh api *pulls/*/reviews*)
  Bash(gh issue:*)
  Bash(gh pr:*)
  Bash(gh search:*)
  Glob
  Grep
  Read
  WebFetch
  WebSearch
  mcp__github
  mcp__github_inline_comment__create_inline_comment
```

To add tools without replacing the defaults, use `additional_allowed_tools`:

```yaml
- uses: ncaq/kyosei-action@<commit-hash> # v1.0.0
  with:
    claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
    additional_allowed_tools: |
      Bash(npm test)
      Edit
```

### Outputs

| Name             | Description                                      |
| ---------------- | ------------------------------------------------ |
| `execution_file` | Path to the Claude Code execution output file    |
| `session_id`     | Claude Code session ID for resuming conversation |

## Permissions

The following permissions are required:

```yaml
permissions:
  checks: read # Reference CI results
  contents: read # Read repository contents for review
  discussions: read # Reference discussions
  id-token: write # Required for Claude Code Action
  issues: read # Reference issues
  pages: read # Reference existing documentation
  pull-requests: write # Post review comments on PRs
  repository-projects: read # Reference project schedules
  security-events: read # Reference vulnerability reports
```

The minimum permissions required to run are:

```yaml
permissions:
  contents: read
  id-token: write
  pull-requests: write
```

The other permissions allow the review agent to reference
additional context (CI results, issues, discussions, etc.)
for better review quality.

If the token lacks `pull-requests: write`
(e.g. due to workflow file changes in the PR or fork PRs),
the action will skip gracefully with a warning instead of failing.

## Development

### Setup

```console
direnv allow
```

### Format

```console
nix fmt
```

### Check

```console
nix-fast-build --option eval-cache false --no-link --skip-cached
```

## License

[Apache License 2.0](LICENSE)
