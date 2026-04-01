# kyosei-action

GitHub Action for [kyosei](https://github.com/ncaq/konoka/tree/master/plugins/kyosei) code review from [konoka](https://github.com/ncaq/konoka) marketplace.

Kyosei is a multi-perspective AI code review plugin that analyzes pull requests
for code quality, performance, security, test coverage, and documentation accuracy.

This repository provides a Composite Action and a Reusable Workflow.
Composite Actionはローレイヤーな部品で、
呼び出し側でcheckoutやpermissionsの設定が必要です。
より簡単に使いたい場合はReusable Workflowの利用を推奨します。

## Composite Action

### Usage

```yaml
name: Kyosei

on:
  pull_request:
    types: [opened, synchronize]

permissions:
  contents: read
  id-token: write
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: false
          fetch-depth: 50
      - uses: ncaq/kyosei-action@v1
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

### Inputs

| Name                       | Description                                             | Required | Default                              |
| -------------------------- | ------------------------------------------------------- | -------- | ------------------------------------ |
| `claude_code_oauth_token`  | Claude Code OAuth token                                 | No       |                                      |
| `anthropic_api_key`        | Anthropic API key (alternative to OAuth token)          | No       |                                      |
| `model`                    | Claude model to use                                     | No       | `opus[1m]`                           |
| `github_token`             | GitHub token (optional if using GitHub App)             | No       |                                      |
| `allowed_bots`             | Allowed bot usernames or `*` for all                    | No       | `*`                                  |
| `allowed_tools`            | Allowed tools (newline-separated, replaces default set) | No       | See below                            |
| `additional_allowed_tools` | Additional tools to append (newline-separated)          | No       |                                      |
| `claude_args`              | Additional CLI arguments                                | No       |                                      |
| `use_bedrock`              | Use Amazon Bedrock with OIDC                            | No       | `false`                              |
| `use_vertex`               | Use Google Vertex AI with OIDC                          | No       | `false`                              |
| `use_foundry`              | Use Microsoft Foundry with OIDC                         | No       | `false`                              |
| `konoka_marketplace_url`   | Git URL of the Konoka marketplace                       | No       | `https://github.com/ncaq/konoka.git` |
| `plugin_name`              | Plugin identifier within the marketplace                | No       | `kyosei@konoka`                      |

#### Authentication

One of the following is required:

- `claude_code_oauth_token` - Claude Code OAuth token
- `anthropic_api_key` - Anthropic API key
- A cloud provider (`use_bedrock`, `use_vertex`, or `use_foundry`)

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
- uses: ncaq/kyosei-action@v1
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

### Permissions

The following permissions are required:

```yaml
permissions:
  contents: read # Read repository contents for review
  id-token: write # Required for Claude Code Action
  pull-requests: write # Post review comments on PRs
```

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
nix-fast-build --option eval-cache false --no-link --skip-cached --no-nom
```

## License

[Apache License 2.0](LICENSE)
