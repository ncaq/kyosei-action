{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
    flake-parts.url = "github:hercules-ci/flake-parts";
    treefmt-nix = {
      url = "github:numtide/treefmt-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    inputs@{
      flake-parts,
      treefmt-nix,
      ...
    }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      imports = [
        treefmt-nix.flakeModule
      ];

      systems = [
        "aarch64-linux"
        "x86_64-linux"
      ];

      perSystem =
        {
          lib,
          pkgs,
          ...
        }:
        let
          inherit (pkgs) nodejs;

          npmFileset = lib.fileset.unions [
            ./package.json
            ./package-lock.json
          ];

          npmRoot = lib.fileset.toSource {
            root = ./.;
            fileset = npmFileset;
          };

          nodeModules = pkgs.importNpmLock.buildNodeModules {
            inherit
              nodejs
              npmRoot
              ;
          };

          tsRoot = lib.fileset.toSource {
            root = ./.;
            fileset = lib.fileset.unions [
              npmFileset

              ./script
              ./test

              ./.editorconfig
              ./.gitignore
              ./tsconfig.json
            ];
          };

          # npm run経由でスクリプト実行を簡単にするためのヘルパー。
          mkNpmCheck =
            name: script:
            pkgs.runCommand name
              {
                nativeBuildInputs = [ nodejs ];
              }
              ''
                cp -r ${tsRoot}/. .
                ln -s ${nodeModules}/node_modules node_modules
                npm run ${script}
                touch $out
              '';
        in
        {
          treefmt.config = {
            projectRootFile = "flake.nix";
            programs = {
              actionlint.enable = true;
              deadnix.enable = true;
              nixfmt.enable = true;
              prettier.enable = true;
              shellcheck.enable = true;
              shfmt.enable = true;
              statix.enable = true;
              typos.enable = true;
              zizmor.enable = true;
            };
            settings.formatter = {
              action-validator = {
                command = pkgs.action-validator;
                includes = [
                  ".github/actions/*/action.yml"
                  ".github/workflows/*.yml"
                  "action.yml"
                ];
              };
              editorconfig-checker = {
                command = pkgs.editorconfig-checker;
                includes = [ "*" ];
              };
              self-version = {
                command = pkgs.writeShellApplication {
                  name = "self-version";
                  runtimeInputs = with pkgs; [
                    coreutils
                    gnugrep
                  ];
                  # treefmtの引数は無視しますが数が少ないのでこちらの方がシンプル。
                  # 一応必要なキャッシュは働くので単にcheckにするよりは効率的。
                  text = ''
                    VERSION=$(tr -d '[:space:]' < ${./VERSION})
                    TAG="v$VERSION"
                    PATTERN='(?:kyosei-action(?:@|/[^@]*@)|rev-parse\s+)v\d+\.\d+\.\d+'
                    errors=0
                    for file in ${./README.md} ${./.github/workflows/review.yml}; do
                      stale=$(grep -nP "$PATTERN" "$file" | grep -vP "v$VERSION(?!\\.|-)" || true)
                      if [ -n "$stale" ]; then
                        echo "self-version: $file contains outdated version (expected $TAG):" >&2
                        echo "$stale" >&2
                        errors=$((errors + 1))
                      fi
                    done
                    if [ "$errors" -gt 0 ]; then
                      exit 1
                    fi
                  '';
                };
                includes = [
                  ".github/workflows/review.yml"
                  "README.md"
                  "VERSION" # 編集はしないけどトリガーのために含める。
                ];
              };
              # `review.yml`は`action.yml`の入力を再宣言してそのまま渡すため、
              # 乖離すると再利用ワークフロー経由の利用者にだけ古い設定が配られてしまう。
              # 目視だけが担保だと実際に`Agent`や`mcp__plugin_*`の追加を取りこぼしたので、
              # `self-version`と同じくtreefmtのフォーマッタとして検査する。
              # 書き換えはせず検査だけを行う。
              action-workflow-sync = {
                command = pkgs.writeShellApplication {
                  name = "action-workflow-sync";
                  runtimeInputs = with pkgs; [
                    diffutils
                    yq-go
                  ];
                  text = ''
                    action=${./action.yml}
                    workflow=${./.github/workflows/review.yml}
                    errors=0

                    # 差分を読みやすく表示します。
                    # `diff`は差異があると非0で終了するので`set -e`から守ります。
                    report() {
                      echo "action-workflow-sync: $1" >&2
                      diff --unified --label review.yml --label action.yml \
                        <(echo "$2") <(echo "$3") >&2 || true
                      errors=$((errors + 1))
                    }

                    # `allowed_tools`のデフォルトの一覧。
                    action_tools=$(yq '.inputs.allowed_tools.default' "$action")
                    workflow_tools=$(yq '.on.workflow_call.inputs.allowed_tools.default' "$workflow")
                    if [ "$action_tools" != "$workflow_tools" ]; then
                      report "allowed_tools default differs." "$workflow_tools" "$action_tools"
                    fi

                    # 入力名の集合。
                    # 認証情報はワークフロー側ではsecretsで受け取り、
                    # `runs-on`などはワークフロー固有なので比較から除きます。
                    workflow_only='["runs-on", "timeout-minutes", "fetch-depth"]'
                    secrets='["claude_code_oauth_token", "anthropic_api_key", "custom_github_token"]'
                    action_inputs=$(yq ".inputs | keys - $secrets | .[]" "$action")
                    workflow_inputs=$(yq \
                      ".on.workflow_call.inputs | keys - $workflow_only | .[]" "$workflow")
                    if [ "$action_inputs" != "$workflow_inputs" ]; then
                      report "input names differ." "$workflow_inputs" "$action_inputs"
                    fi

                    if [ "$errors" -gt 0 ]; then
                      exit 1
                    fi
                  '';
                };
                includes = [
                  ".github/workflows/review.yml"
                  "action.yml"
                ];
              };
              zizmor.options = [ "--pedantic" ];
            };
          };
          checks = {
            lint-tsc = mkNpmCheck "lint-tsc" "lint:tsc";
            test = mkNpmCheck "test" "test";
          };
          packages = {
            # flake.lockの管理バージョンをre-exportすることで安定した利用を促進。
            inherit (pkgs)
              nix-fast-build
              ;
          };
          devShells.default = pkgs.mkShell {
            buildInputs = with pkgs; [
              # treefmtで指定したプログラムの単体版。
              action-validator
              actionlint
              deadnix
              editorconfig-checker
              nixfmt
              prettier
              shellcheck
              shfmt
              statix
              typos
              zizmor

              # nixの関連ツール。
              nix-fast-build

              # Node.js
              nodejs
            ];
            packages = [ pkgs.importNpmLock.hooks.linkNodeModulesHook ];
            npmDeps = nodeModules;
          };
        };
    };

  nixConfig = {
    extra-substituters = [
      "https://cache.nixos.org/"
      "https://niks3-public.ncaq.net/"
      "https://ncaq.cachix.org/"
      "https://nix-community.cachix.org/"
    ];
    extra-trusted-public-keys = [
      "cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY="
      "niks3-public.ncaq.net-1:e/B9GomqDchMBmx3IW/TMQDF8sjUCQzEofKhpehXl04="
      "ncaq.cachix.org-1:XF346GXI2n77SB5Yzqwhdfo7r0nFcZBaHsiiMOEljiE="
      "nix-community.cachix.org-1:mB9FSh9qf2dCimDSUo8Zy7bkq5CX+/rkCWyvRCYg3Fs="
    ];
  };
}
