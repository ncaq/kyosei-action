{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
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
          pkgs,
          ...
        }:
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
              typos.enable = true;
              zizmor.enable = true;

              statix = {
                enable = true;
                disabled-lints = [ "eta_reduction" ];
              };
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
                      stale=$(grep -nP "$PATTERN" "$file" | grep -vF "$TAG" || true)
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
              zizmor.options = [ "--pedantic" ];
            };
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
            ];
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
