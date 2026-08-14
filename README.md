# ide-dashboard

フォルダごとに tmux で **作業用ダッシュボード**を一発で開く `ide` コマンド。

```
┌── 左カラム ──┐┌─ 右 ─┐
│ ranger   50% ││       │
│              ││       │
├──────────────┤│ claude│
│ 見張り窓 25% ││       │
├──────────────┤│       │
│ Throughline  ││       │
│ monitor  25% ││       │
└──────────────┘└───────┘
```

- **ranger** — ファイラ
- **見張り窓** — Claude Code の手伝い役（サブ作業）の動きを常時表示（`~/.claude/projects` を読む自作モニター）
- **Throughline monitor** — トークン消費量モニター
- **claude** — Claude Code 本体（入力フォーカスはここ）

フォルダ名がそのまま tmux セッション名になり、フォルダごとに別の作業場が永続します。

## セットアップ（macOS / Linux 共通・一発）

```sh
git clone https://github.com/kitepon/ide-dashboard ~/ide-dashboard
cd ~/ide-dashboard && ./setup.sh
```

`setup.sh` がやること:

1. **アプリ導入** — `tmux` / `ranger` / `node`（macOS=Homebrew、Linux=apt。未導入なら Homebrew も入れる）
2. **npm グローバル** — `throughline` / `@anthropic-ai/claude-code`
3. **見張り窓**を `~/.claude/bin/ide-monitor.js` へ配置
4. シェル rc（zsh=`~/.zshrc` / bash=`~/.bashrc`）に `ide` 関数を**冪等**登録

完了後、新しいシェルで:

```sh
cd <作業フォルダ> && ide
```

## 構成

| パス | 役割 |
|---|---|
| `shell/ide.sh` | `ide` 関数本体（bash / zsh 両対応） |
| `bin/ide-monitor.js` | 見張り窓（node 標準モジュールのみ・依存なし） |
| `setup.sh` | 導入スクリプト |

## 必要要件

- macOS または Linux（POSIX シェル）
- インターネット接続（初回の各種導入時）
- `claude` は初回に認証（ブラウザログイン）が必要
