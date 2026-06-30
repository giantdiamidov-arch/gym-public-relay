// 種目定義（全画面共通）
const APPARATUS = {
  // MAG
  MAG_FX: { code:'MAG_FX', label:'FX', full:'Floor Exercise', gender:'MAG', icon:'🟦' },
  MAG_PH: { code:'MAG_PH', label:'PH', full:'Pommel Horse',   gender:'MAG', icon:'🐴' },
  MAG_SR: { code:'MAG_SR', label:'SR', full:'Still Rings',    gender:'MAG', icon:'⭕' },
  MAG_VT: { code:'MAG_VT', label:'VT', full:'Vault',          gender:'MAG', icon:'🏃' },
  MAG_PB: { code:'MAG_PB', label:'PB', full:'Parallel Bars',  gender:'MAG', icon:'⚡' },
  MAG_HB: { code:'MAG_HB', label:'HB', full:'High Bar',       gender:'MAG', icon:'🔝' },
  // WAG
  WAG_VT: { code:'WAG_VT', label:'VT', full:'Vault',          gender:'WAG', icon:'🏃' },
  WAG_UB: { code:'WAG_UB', label:'UB', full:'Uneven Bars',    gender:'WAG', icon:'〰️' },
  WAG_BB: { code:'WAG_BB', label:'BB', full:'Balance Beam',   gender:'WAG', icon:'🤸' },
  WAG_FX: { code:'WAG_FX', label:'FX', full:'Floor Exercise', gender:'WAG', icon:'🟦' },
};

const MAG_ORDER = ['MAG_FX','MAG_PH','MAG_SR','MAG_VT','MAG_PB','MAG_HB'];
const WAG_ORDER = ['WAG_VT','WAG_UB','WAG_BB','WAG_FX'];
const ALL_APPARATUS_ORDER = [...MAG_ORDER, ...WAG_ORDER];

function apparatusName(code) {
  const a = APPARATUS[code];
  if (!a) return code;
  return `${a.icon} ${a.gender} ${a.label}`;
}
function apparatusShort(code) {
  const a = APPARATUS[code];
  if (!a) return code;
  return `${a.icon} ${a.label}`;
}

// 0.001単位の切り捨て（FIG基準）。浮動小数点誤差で12.65が12.649になる等のずれを
// 微小なイプシロンを加えて補正してから切り捨てる。
function floorTo3(x) { return Math.floor(x * 1000 + 1e-9) / 1000; }

// E平均計算（設定対応）
function calcEAvgWithSettings(eScores, settings) {
  const eCount = Number(settings?.eJudgeCount) || 4;
  const eKeysAllowed = ['E1','E2','E3','E4','E5','E6'].slice(0, eCount);
  const vals = eKeysAllowed.map(k => eScores[k]).map(Number).filter(v => !isNaN(v));
  if (vals.length === 0) return { avg: null, used: [], all: [] };
  if (vals.length < 3) {
    const avg = floorTo3(vals.reduce((a,v)=>a+v,0)/vals.length);
    return { avg, used: vals, all: vals };
  }
  const trim3 = settings?.eAvg3judges === 'trim';
  if (vals.length === 3 && !trim3) {
    return { avg: floorTo3(vals.reduce((a,v)=>a+v,0)/vals.length), used: vals, all: vals };
  }
  const sorted = [...vals].sort((a,b)=>a-b);
  const used = sorted.slice(1,-1);
  return { avg: floorTo3(used.reduce((a,v)=>a+v,0)/used.length), used, all: vals };
}

// VT種目かどうか
function isVT(apparatus) {
  return apparatus === 'MAG_VT' || apparatus === 'WAG_VT';
}

// ── 公開オン/オフ制御 ──
// 会場側admin.htmlの設定（settings.publicEnabled）がfalseの場合、
// 試験運用中などで観覧者に見せたくない状態であることを示す。
// 全ページ共通で「次の大会までお待ちください」のオーバーレイを表示する。
function showPublicDisabledOverlay() {
  if (document.getElementById('public-disabled-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'public-disabled-overlay';
  overlay.style.cssText = `
    position:fixed; inset:0; z-index:99999;
    background:#0f1923; color:#fff;
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    font-family:'Helvetica Neue',Arial,sans-serif; text-align:center; padding:24px;
  `;
  overlay.innerHTML = `
    <div style="font-size:48px;margin-bottom:16px">🤸</div>
    <div style="font-size:20px;font-weight:700;margin-bottom:8px">次の大会までお待ちください</div>
    <div style="font-size:13px;color:#7a8a99;max-width:320px;line-height:1.6">
      現在このページは公開されていません。<br>大会開催時に改めてご確認ください。
    </div>
  `;
  document.body.appendChild(overlay);
}
function hidePublicDisabledOverlay() {
  const el = document.getElementById('public-disabled-overlay');
  if (el) el.remove();
}
// settingsオブジェクトを受け取り、publicEnabled===falseならオーバーレイ表示、
// それ以外（true・未設定どちらも公開扱い＝既存動作との後方互換）なら隠す。
function applyPublicEnabledState(settings) {
  if (settings && settings.publicEnabled === false) {
    showPublicDisabledOverlay();
  } else {
    hidePublicDisabledOverlay();
  }
}
