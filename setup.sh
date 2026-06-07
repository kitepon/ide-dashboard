#!/usr/bin/env bash
# ide-dashboard セットアップ
#   1. 依存アプリ導入 (tmux / ranger / node) ... macOS=Homebrew, Linux=apt
#   2. npm グローバル導入 (throughline / claude-code)
#   3. 見張り窓スクリプトを ~/.claude/bin/ へ配置
#   4. シェル rc に `ide` 関数を登録 (冪等)
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
OS="$(uname -s)"
say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }

# --- 1. アプリ導入 (コマンドが無ければ入れる) ---
brew_install() { brew list "$1" >/dev/null 2>&1 || brew install "$1"; }
apt_install()  { dpkg -s "$1" >/dev/null 2>&1 || sudo apt-get install -y "$1"; }
ensure_app() {  # $1=コマンド名 $2=brew名 $3=apt名
  command -v "$1" >/dev/null 2>&1 && return
  case "$OS" in
    Darwin) brew_install "$2" ;;
    Linux)  apt_install  "$3" ;;
    *) echo "未対応OS: $OS" >&2; exit 1 ;;
  esac
}

if [ "$OS" = "Darwin" ] && ! command -v brew >/dev/null 2>&1; then
  say "Homebrew を導入します"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  eval "$([ -x /opt/homebrew/bin/brew ] && /opt/homebrew/bin/brew shellenv || /usr/local/bin/brew shellenv)"
fi
[ "$OS" = "Linux" ] && command -v apt-get >/dev/null 2>&1 && sudo apt-get update -y || true

say "アプリ確認/導入: tmux ranger node"
ensure_app tmux   tmux   tmux
ensure_app ranger ranger ranger
ensure_app node   node   nodejs

# --- 2. npm グローバル: throughline / claude ---
say "npm グローバル: throughline / claude-code"
command -v throughline >/dev/null 2>&1 || npm i -g throughline
command -v claude      >/dev/null 2>&1 || npm i -g @anthropic-ai/claude-code

# --- 3. 見張り窓スクリプトを配置 ---
say "見張り窓を ~/.claude/bin/ へ配置"
mkdir -p "$HOME/.claude/bin"
cp "$REPO_DIR/bin/ide-monitor.js" "$HOME/.claude/bin/ide-monitor.js"
chmod +x "$HOME/.claude/bin/ide-monitor.js"

# --- 4. シェル rc に ide 関数を登録 (冪等) ---
case "$(basename "${SHELL:-bash}")" in
  zsh)  RC="$HOME/.zshrc" ;;
  bash) RC="$HOME/.bashrc" ;;
  *)    RC="$HOME/.profile" ;;
esac
LINE="[ -f \"$REPO_DIR/shell/ide.sh\" ] && . \"$REPO_DIR/shell/ide.sh\"  # ide-dashboard"
if grep -qF "# ide-dashboard" "$RC" 2>/dev/null; then
  say "$RC は登録済み (スキップ)"
else
  say "$RC に ide 関数を登録"
  printf '\n%s\n' "$LINE" >> "$RC"
fi

say "完了。新しいシェルを開く (または 'source $RC') → 作業フォルダで 'ide'"
