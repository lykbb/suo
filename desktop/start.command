#!/bin/zsh
set -e
SUO_DESKTOP_DIR="${0:A:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"
if ! command -v node >/dev/null 2>&1 && [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
  source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
fi
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1 || ! command -v cargo >/dev/null 2>&1; then
  print -u2 "源码开发需要 Node 22.19 以上、npm、Rust 和 Xcode Command Line Tools。独立 Suo.app 不需要这些工具。"
  exit 1
fi
export SUO_DESKTOP_NODE="${SUO_DESKTOP_NODE:-$(command -v node)}"
export CARGO_HOME="$SUO_DESKTOP_DIR/.cargo-cache"
cd "$SUO_DESKTOP_DIR"
exec npm run desktop
