#!/usr/bin/env node
'use strict';
// 見張り窓: いま動いている手伝い役(エージェント)をツリー風に常時表示する。
//   使い方: node ide-monitor.js [見張るフォルダ]   (省略時は今いるフォルダ)
//           --once を付けると 1 回だけ描いて終わる(テスト用)
// 仕組み: claude が書き残す記録ファイル(*.jsonl)を 1 秒ごとに読み直し、
//   手伝い役ごとに「説明 → やった作業 → 状態」を組み立てて描き直す。

const fs = require('fs');
const path = require('path');
const os = require('os');

const argv = process.argv.slice(2);
const ONCE = argv.includes('--once');
const TARGET = path.resolve(argv.find(a => !a.startsWith('--')) || process.cwd());
const PROJECTS = path.join(os.homedir(), '.claude', 'projects');
const projDir = path.join(PROJECTS, TARGET.replace(/[/.]/g, '-'));

const RUNNING_MS = 12000; // 直近12秒に更新があれば「実行中」
const TICK_MS = 600;      // 再描画間隔(回転マークが動いて見える程度)
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']; // 実行中アニメ
let frame = 0;

// ── 色 ──
const c = {
  dim:  s => `\x1b[2m${s}\x1b[22m`,
  cyan: s => `\x1b[36m${s}\x1b[39m`,
  green:s => `\x1b[32m${s}\x1b[39m`,
  yel:  s => `\x1b[33m${s}\x1b[39m`,
  bold: s => `\x1b[1m${s}\x1b[22m`,
};

// ── 文字幅(全角=2)を考えて切り詰める ──
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;
function clip(str, max) {
  const s = oneLine(String(str == null ? '' : str));
  let w = 0, out = '';
  for (const ch of s) {
    const cw = WIDE.test(ch) ? 2 : 1;
    if (w + cw > max) return out + '…';
    w += cw; out += ch;
  }
  return out;
}
function oneLine(s) { return String(s).replace(/\s+/g, ' ').trim(); }
function dw(s) { let w = 0; for (const ch of String(s)) w += WIDE.test(ch) ? 2 : 1; return w; }
function firstLine(s) {
  const ln = String(s).split('\n').map(x => x.trim()).find(x => x.length > 0) || '';
  return oneLine(ln.replace(/^#+\s*/, ''));
}
function tok(n) { return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n); }
function safeStat(fp) { try { return fs.statSync(fp); } catch { return null; } }
function baseName(p) { return p ? path.basename(p) : ''; }
function firstStr(o) { for (const k in o) { if (typeof o[k] === 'string') return o[k]; } return ''; }

// 1作業(道具呼び出し)を短い日本語に
function describe(b) {
  const i = b.input || {};
  const map = {
    Bash: ['実行', i.command],
    Read: ['読む', baseName(i.file_path)],
    Edit: ['書く', baseName(i.file_path)],
    Write: ['書く', baseName(i.file_path)],
    NotebookEdit: ['書く', baseName(i.notebook_path || i.file_path)],
    Grep: ['検索', i.pattern],
    Glob: ['探す', i.pattern],
    WebSearch: ['調べる', i.query],
    WebFetch: ['取得', i.url],
    Agent: ['手伝い役', i.description],
    Task: ['手伝い役', i.description],
    TodoWrite: ['整理', 'やること'],
    Skill: ['技', i.skill || i.command],
    Workflow: ['段取り', i.name || 'ワークフロー'],
    ToolSearch: ['道具探し', i.query],
  }[b.name];
  if (map) return `${map[0]}  ${oneLine(map[1] || '')}`;
  // それ以外(外部連携など): 名前 + 最初の文字列引数
  const name = String(b.name || '').replace(/^mcp__/, '').replace(/__/g, ':');
  return `${name}  ${oneLine(firstStr(i))}`;
}

// ── 記録ファイルの解析(変更が無ければキャッシュを使う) ──
const cache = new Map(); // path -> {mtimeMs, steps, title, started}
function parseAgent(fp) {
  let text = '';
  try { text = fs.readFileSync(fp, 'utf8'); } catch { return { steps: [], title: null, started: null, out: 0 }; }
  const steps = []; let title = null, started = null, out = 0;
  for (const line of text.split('\n')) {
    if (!line) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (!started && o.timestamp) started = o.timestamp;
    const msg = o.message; if (!msg) continue;
    if (msg.usage) out += (msg.usage.output_tokens || 0);
    const content = msg.content;
    if (o.type === 'user' && !title) {
      let txt = null;
      if (typeof content === 'string') txt = content;
      else if (Array.isArray(content)) {
        const t = content.find(b => b.type === 'text');
        if (t) txt = t.text;
      }
      if (txt) title = firstLine(txt);
    }
    if (Array.isArray(content)) {
      for (const b of content) if (b.type === 'tool_use') steps.push(describe(b));
    }
  }
  return { steps, title, started, out };
}
function readAgent(fp) {
  const st = safeStat(fp); if (!st) return null;
  const hit = cache.get(fp);
  if (hit && hit.mtimeMs === st.mtimeMs) return hit;
  const rec = { mtimeMs: st.mtimeMs, ...parseAgent(fp) };
  cache.set(fp, rec);
  return rec;
}
function metaFor(fp) {
  try { return JSON.parse(fs.readFileSync(fp.replace(/\.jsonl$/, '.meta.json'), 'utf8')); }
  catch { return null; }
}

// 今動いているセッション = projDir 直下で一番新しい *.jsonl
function newestSession() {
  let ents; try { ents = fs.readdirSync(projDir); } catch { return null; }
  let best = null, bm = 0;
  for (const f of ents) {
    if (!f.endsWith('.jsonl')) continue;
    const fp = path.join(projDir, f);
    const st = safeStat(fp); if (!st) continue;
    if (st.mtimeMs > bm) { bm = st.mtimeMs; best = fp; }
  }
  return best ? best.slice(0, -'.jsonl'.length) : null; // = セッション uuid のフォルダ
}

// セッション配下の手伝い役を全部集める(通常 + ワークフロー)
function collect(sessionBase) {
  const root = sessionBase + '/subagents';
  const files = [];
  (function walk(d) {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) walk(fp);
      else if (/^agent-.*\.jsonl$/.test(e.name)) files.push(fp);
    }
  })(root);
  const now = Date.now();
  const agents = [];
  for (const fp of files) {
    const st = safeStat(fp); if (!st) continue;
    const rec = readAgent(fp); if (!rec) continue;
    const meta = metaFor(fp);
    const id = path.basename(fp).replace(/^agent-/, '').replace(/\.jsonl$/, '');
    const isWf = fp.includes('/workflows/');
    agents.push({
      title: (meta && meta.description) || rec.title || id,
      isWf,
      steps: rec.steps,
      out: rec.out || 0,
      running: (now - st.mtimeMs) < RUNNING_MS,
      started: rec.started || new Date(st.mtimeMs).toISOString(),
    });
  }
  agents.sort((a, b) => (a.started < b.started ? -1 : a.started > b.started ? 1 : 0));
  return agents;
}

function render() {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const clock = new Date().toTimeString().slice(0, 8);
  const folder = path.basename(TARGET) || TARGET;
  const out = [];
  out.push(c.bold(c.cyan('● 見張り窓')) + c.dim(`  ${clip(folder, 20)}  更新 ${clock}`));

  const base = newestSession();
  if (!base) {
    out.push('', c.dim('  まだ記録がありません。'),
                 c.dim('  右で claude が手伝い役を呼ぶと、ここに出ます。'));
    return paint(out, rows, cols);
  }
  const agents = collect(base);
  if (agents.length === 0) {
    out.push('', c.dim('  今、手伝い役は動いていません。'),
                 c.dim('  (本体が直接やっている作業はここには出ません)'));
    return paint(out, rows, cols);
  }
  const running = agents.filter(a => a.running);
  const done = agents.filter(a => !a.running);
  const totalTools = agents.reduce((s, a) => s + a.steps.length, 0);
  const totalOut = agents.reduce((s, a) => s + (a.out || 0), 0);
  out.push(c.dim(`  手伝い役 ${agents.length} · 実行中 ${running.length} · 完了 ${done.length}`));
  out.push(c.dim(`  合計 tools:${totalTools} tokens:${tok(totalOut)}`), '');

  const spin = SPIN[frame++ % SPIN.length];
  // 1 手伝い役 = 1 行。実行中は回転マーク+今の作業。完了は ✓ +集計(tools/tokens)。記号は半角。
  const fmt = (a) => {
    const wf = a.isWf ? '·' : ''; // ワークフローの手伝い役印(半角)
    if (a.running) {
      const action = a.steps.length ? oneLine(a.steps[a.steps.length - 1]) : '準備中';
      const fixed = 2 + dw(wf) + 3; // "⠙ " + wf + 区切り2空白 + 余白
      const titleMax = Math.max(6, Math.floor((cols - fixed) * 0.5));
      const t = clip(a.title, titleMax);
      const act = clip(action, Math.max(4, cols - fixed - dw(t)));
      return c.green(spin + ' ') + c.dim(wf) + c.bold(t) + c.dim('  ' + act);
    }
    const stat = `tools:${a.steps.length} tokens:${tok(a.out)}`;
    const tmax = Math.max(6, cols - 2 - dw(wf) - 3 - dw(stat));
    return c.dim('✓ ' + wf + clip(a.title, tmax) + '  ' + stat);
  };

  const lines = [...running.map(fmt), ...done.map(fmt)];
  const room = Math.max(3, rows - out.length);
  let visible = lines;
  if (lines.length > room) {
    visible = lines.slice(0, room - 1);
    visible.push(c.dim(`  … 他 ${lines.length - visible.length} 件`));
  }
  out.push(...visible);
  return paint(out, rows, cols);
}

function paint(lines, rows, cols) {
  let body = lines;
  if (lines.length > rows) {
    const head = lines.slice(0, 2);
    const tail = lines.slice(lines.length - (rows - 3));
    body = [...head, c.dim('  …(古い分は省略)'), ...tail];
  }
  // ちらつき防止: 全消去せず、各行末を消し(\x1b[K)ながら上書き、最後に残りを消す(\x1b[J)
  const text = body.map(l => l + '\x1b[K').join('\n');
  process.stdout.write('\x1b[H' + text + '\x1b[J');
}

// ── 起動 ──
if (ONCE) {
  render();
} else {
  process.stdout.write('\x1b[?25l'); // カーソル隠す
  const stop = () => { process.stdout.write('\x1b[?25h\n'); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.stdout.on('resize', render);
  render();
  setInterval(render, TICK_MS);
}
