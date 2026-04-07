# 出力設定

## 言語

AIは人間に話すときは日本語を使ってください。

しかし既存のコードのコメントなどが日本語ではない場合は、
コメント等は既存の言語に合わせてください。

## 記号

ASCIIに対応する全角形(Fullwidth Forms)は使用禁止。

具体的には以下のような文字:

- 全角括弧 `（）` → 半角 `()`
- 全角コロン `：` → 半角 `:`
- 全角カンマ `，` → 半角 `,`
- 全角数字 `０-９` → 半角 `0-9`

# 重要コマンド

## フォーマット

基本的にファイルはツールで自動フォーマットしています。

### nix fmt

[treefmt-nix](https://github.com/numtide/treefmt-nix)が対応しているファイルは以下のコマンドでフォーマット出来ます。

```console
nix fmt
```

Stopフックで`nix fmt`が自動実行されます。
ファイルの差分が出ることがあります。

## 統合チェック

以下のコマンドでプロジェクト全体のチェックが行えます。
フォーマットやリントやテストなどがまとめて実行されます。

```console
nix-fast-build --option eval-cache false --no-link --skip-cached --no-nom
```

`nix-fast-build`は`nix-eval-jobs`を使って`checks`を並列評価・ビルドします。
`nix flake check`と比べて、
評価が並列化されるため高速です。

`--no-nom`オプションはnix-output-monitorを無効にしてシンプルなビルドログを出力します。
LLMエージェントやCI環境などターミナル制御が貧弱な環境で使用してください。

# リポジトリ構成

Codex向けの`AGENTS.md`とClaude Code向けの`CLAUDE.md`は以下のように`.github/copilot-instructions.md`のシンボリックリンクになっています。

```console
AGENTS.md -> .github/copilot-instructions.md
CLAUDE.md -> .github/copilot-instructions.md
```

これにより各種LLM向けのドキュメントを一元管理しています。
