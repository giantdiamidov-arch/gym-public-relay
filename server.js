// ═══════════════════════════════════════════════════════
// 体操採点システム - 公開中継サーバー（クラウド側）
//
// 役割:
//   1. 会場の Node.js サーバー（server.js）から確定得点データを
//      HTTP POST (/push) で受け取り、メモリ上に保持する。
//   2. 観覧者（インターネット経由のスマホ・PC）が public/ 配下の
//      display.html・scoreboard.html を開くと、ここの WebSocket に
//      接続し、リアルタイムに最新データを受け取る。
//
// 安全設計:
//   観覧者側のWebSocket接続からは「書き込み系」のメッセージを一切
//   受け付けない（PING以外は完全に無視する）。得点の確定・編集・削除は
//   会場の server.js だけが /push 経由で行える。
// ═══════════════════════════════════════════════════════

const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
// 会場のserver.jsと共有する合言葉。admin.html側の「中継サーバー設定」に
// 同じ文字列を入力してもらう。未設定の場合は認証なし（テスト用途のみ推奨）。
const RELAY_KEY = process.env.RELAY_KEY || '';

if (!RELAY_KEY) {
  console.warn('⚠️ 警告: RELAY_KEY が未設定です。誰でも /push を呼べる状態になっています。');
  console.warn('   本番運用前に環境変数 RELAY_KEY を設定してください。');
}

// 観覧者に配信する「公開用の状態」。会場サーバーの内部データ（審判の入力途中スコアや
// 選手名簿の全件など）は含めず、確定済みデータだけを保持する。
let publicState = {
  confirmed: [],
  vtFinals: {},
  settings: { eJudgeCount: 4 },
  roster: [],
};

const server = http.createServer((req, res) => {
  // ── 会場サーバーからのデータ受信 ──
  if (req.method === 'POST' && req.url === '/push') {
    if (RELAY_KEY) {
      const provided = req.headers['x-relay-key'] || '';
      if (provided !== RELAY_KEY) {
        res.writeHead(401, { 'Content-Type': 'text/plain' });
        res.end('unauthorized');
        return;
      }
    }
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const msg = JSON.parse(body || '{}');
        if (msg.type === 'STATE') {
          publicState = {
            confirmed: msg.confirmed || [],
            vtFinals: msg.vtFinals || {},
            settings: msg.settings || { eJudgeCount: 4 },
            roster: msg.roster || [],
          };
          // skipDisplayAuto=true の場合は観覧者側の場内表示も自動更新しない
          // （記録本部が得点を編集した場合など。「場内表示に反映しますか？」を経由した
          //   FORCE_SHOW のみが表示を更新する）
          broadcast({ type: 'STATE_UPDATE', state: publicState, skipDisplayAuto: msg.skipDisplayAuto || false });
        } else if (msg.type === 'FORCE_SHOW') {
          broadcast({ type: 'DISPLAY_FORCE_SHOW', apparatus: msg.apparatus, result: msg.result });
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('bad request');
      }
    });
    return;
  }

  // 簡易ヘルスチェック（Render等のスリープ防止・動作確認用）
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', confirmedCount: publicState.confirmed.length }));
    return;
  }

  // ── 静的ファイル配信（観覧用ページ） ──
  const urlPath = req.url.split('?')[0];
  const filePath = path.join(__dirname, 'public', urlPath === '/' ? 'index.html' : urlPath);
  const ext = path.extname(filePath) || '.html';
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
  };
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': mimeTypes[ext] || 'text/plain',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });
const clients = new Set();

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

wss.on('connection', (ws) => {
  clients.add(ws);
  // 接続直後に現在の公開状態を送る（display.html / scoreboard.html がそのまま使える形式）
  ws.send(JSON.stringify({ type: 'INIT', state: publicState }));

  // 【重要・閲覧専用ガード】
  // 観覧者側からのメッセージは一切信用しない。PING（接続維持）にのみ応答し、
  // それ以外（REQUEST_STATEなど）は読み取り専用の安全な範囲のみ許可する。
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'PING') {
      ws.send(JSON.stringify({ type: 'PONG' }));
      return;
    }
    if (msg.type === 'REQUEST_STATE') {
      ws.send(JSON.stringify({ type: 'INIT', state: publicState }));
      return;
    }
    // それ以外の全てのメッセージタイプ（CONFIRM_SCORE等）は意図的に無視する
  });

  ws.on('close', () => clients.delete(ws));
});

server.listen(PORT, () => {
  console.log('\n🌐 公開中継サーバー起動中');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`ポート: ${PORT}`);
  console.log(`観覧用URL: /display.html ・ /scoreboard.html`);
  console.log(`受信用エンドポイント: POST /push (x-relay-key ヘッダー必須)`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});
