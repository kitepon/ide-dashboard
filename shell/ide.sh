# ide-dashboard: フォルダごとに tmux で
#   左カラム = ranger(上50%) / 見張り窓(25%) / Throughline トークンモニター(25%)
#   右       = claude
# を開く。bash / zsh 両対応。フォルダ名 = セッション名 (フォルダ毎に別の作業場)。

ide() {
  local name cols lines rg cl mo tm
  name=$(basename "$PWD" | tr '.: ' '___')
  [ -z "$name" ] && name=home
  # そのフォルダ用セッションが無ければ作る
  if ! tmux has-session -t "$name" 2>/dev/null; then
    cols=$(tput cols); lines=$(tput lines)
    # 左カラム3段 (上から ranger / 見張り窓 / Throughline) + 右 claude
    rg=$(tmux new-session -d -s "$name" -c "$PWD" -x "$cols" -y "$lines" -P -F '#{pane_id}')
    cl=$(tmux split-window -h -t "$rg" -c "$PWD" -P -F '#{pane_id}')
    mo=$(tmux split-window -v -t "$rg" -c "$PWD" -P -F '#{pane_id}')
    tm=$(tmux split-window -v -t "$mo" -c "$PWD" -P -F '#{pane_id}')
    # 役割マーク (リサイズ時に配置を貼り直す際の目印)
    tmux set -p -t "$rg" @ide ranger
    tmux set -p -t "$mo" @ide monitor
    tmux set -p -t "$tm" @ide throughline
    tmux set -p -t "$cl" @ide claude
    # サイズ: 左右ほぼ半々、左カラムは ranger 50% / 見張り窓 25% / Throughline 25%
    tmux resize-pane -t "$rg" -x $(( cols / 2 ))
    tmux resize-pane -t "$rg" -y $(( lines / 2 ))
    tmux resize-pane -t "$mo" -y $(( lines / 4 ))
    # 各ペインを起動
    tmux send-keys -t "$rg" 'ranger' C-m
    tmux send-keys -t "$mo" "node $HOME/.claude/bin/ide-monitor.js \"$PWD\"" C-m
    tmux send-keys -t "$tm" 'throughline monitor' C-m
    tmux send-keys -t "$cl" 'claude' C-m
    tmux select-pane -t "$cl"   # 入力は claude にフォーカス
  fi
  # tmux の中から打ったら切り替え、外からなら接続
  if [ -n "${TMUX:-}" ]; then
    tmux switch-client -t "$name"
  else
    tmux attach -t "$name"
  fi
}
