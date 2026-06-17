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
