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

// E平均計算（設定対応）。
// gender（'MAG'/'WAG'）を渡すと settings.eJudgeCountMAG / eJudgeCountWAG を参照する。
// gender省略時、または該当性別の設定が無い場合は旧settings.eJudgeCount（全体共通の値）→4の順にフォールバックする。
function calcEAvgWithSettings(eScores, settings, gender) {
  const perGender = gender === 'WAG' ? settings?.eJudgeCountWAG : (gender === 'MAG' ? settings?.eJudgeCountMAG : undefined);
  const eCount = Number(perGender) || Number(settings?.eJudgeCount) || 4;
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

// category（文字列 or 複数カテゴリー配列）を、キー生成用に正規化する。
// 配列の場合は並び順に依存しないようソートしてから連結する。
function categoryKey(category) {
  if (Array.isArray(category)) return category.slice().sort().join(',');
  return category ? String(category) : '';
}

// VT（跳馬）採用得点（vtFinals）のキーを生成する。
// 同じ性別内でBIB番号がカテゴリーをまたいで重複するケース（例: U12とU15で同じBIBを
// 使い回す大会）があるため、apparatus + bib だけでなく category も含めて選手を一意に
// 識別する。category は各呼び出し側が保持している athlete.category をそのまま渡すこと。
function vtKey(apparatus, bib, category) {
  return apparatus + '|' + bib + '|' + categoryKey(category);
}

// 選手名簿から性別+BIBで該当選手を検索し、カテゴリー（文字列 or 複数カテゴリー配列）を返す
function findRosterCategory(roster, gender, bib) {
  const r = (roster || []).find(a => a.gender === gender && String(a.bib) === String(bib));
  return r ? r.category : undefined;
}

// 性別×カテゴリー別のVT（跳馬）設定を解決する。
// settings.vtOverrides は "性別|カテゴリー" をキーとした上書き設定（{ vtVaults, vtScoring }）のマップ。
// category は文字列、または複数カテゴリー所属者用の配列（例: ["U15","中総"]）のどちらでも良く、
// 上書きが登録されている最初のカテゴリーを採用する。該当する上書きがなければ、
// 全体のデフォルト設定（settings.vtVaults / settings.vtScoring）にフォールバックする。
function resolveVtSettings(settings, gender, category) {
  const overrides = settings?.vtOverrides || {};
  const categories = Array.isArray(category) ? category : (category ? [category] : []);
  for (const cat of categories) {
    const ov = overrides[`${gender}|${cat}`];
    if (ov) {
      return {
        vtVaults: Number(ov.vtVaults) || Number(settings?.vtVaults) || 1,
        vtScoring: ov.vtScoring || settings?.vtScoring || 'best',
      };
    }
  }
  return {
    vtVaults: Number(settings?.vtVaults) || 1,
    vtScoring: settings?.vtScoring || 'best',
  };
}

// 場内表示（display.html等）向け：ある種目の「今表示すべき最新の確定得点」を選ぶ。
// VT（跳馬）2本跳躍で採用得点（vtFinals）が既に計算済みの選手については、
// 1本目・2本目それぞれの生の確定エントリを候補から除外し、必ず統合済みの
// 採用得点（平均/高い方）だけを候補にする。confirmedAtのミリ秒差に依存すると
// 生スコアの方が新しく見えて選ばれてしまうことがあるため、この関数で確実に統合結果を優先する。
function pickLatestDisplayCandidate(confirmed, vtFinals, apparatus) {
  const vtFinalsForApp = Object.values(vtFinals || {}).filter(v => v.apparatus === apparatus);
  // 同じ性別内でBIBがカテゴリーをまたいで重複することがあるため、BIB単独ではなく
  // BIB+カテゴリーの組み合わせで「採用得点が計算済みの選手」を識別する
  // （BIBのみで識別すると、別カテゴリーの同BIB選手の生スコアまで誤って除外・混同してしまう）。
  const vtFinalKeys = new Set(vtFinalsForApp.map(v => v.athlete?.bib + '|' + categoryKey(v.athlete?.category)));
  const rawConfirmed = (confirmed || []).filter(r =>
    r.apparatus === apparatus && !(r.athlete?.vtVault && vtFinalKeys.has(r.athlete?.bib + '|' + categoryKey(r.athlete?.category)))
  );
  const candidates = [...rawConfirmed, ...vtFinalsForApp];
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => new Date(b.confirmedAt) > new Date(a.confirmedAt) ? b : a);
}

// 場内表示の「最低表示保持時間」を管理する小さなヘルパー。
// 1本目確定→1本目表示→2本目確定→2本目表示→（保持時間経過）→統合得点(平均/高い方)表示、のように
// 届いた順番のまま、それぞれ最低holdMs秒は表示され続けるようFIFOキューで管理する
// （「最新の値で上書き」方式だと、2本目確定直後に統合結果が計算されて2本目の表示が
// 一度も表示されないまま平均に差し替わってしまうことがあったため、キュー方式にしている）。
// 記録本部・セクレタリーからの手動「場内表示に反映」操作（forceShow）は、キューを破棄して常に即時反映する。
// settings.displayHoldSeconds（admin画面で設定・既定8秒）を都度参照するため、
// 呼び出し側は最新のsettingsを毎回引数で渡すこと。
function createDisplayHold(applyFn) {
  let lastAppliedAt = 0;
  let queue = [];
  let timer = null;
  let latestSettings = null;
  let lastKey; // 直近に「表示済み or キュー投入済み」の内容（JSON文字列）。重複投入を防ぐ

  function getHoldMs(settings) {
    const sec = Number(settings?.displayHoldSeconds);
    return (Number.isFinite(sec) && sec >= 0 ? sec : 8) * 1000;
  }

  function applyCandidate(candidate) {
    lastAppliedAt = Date.now();
    applyFn(candidate);
  }

  // キューに残りがあれば、保持時間の残り時間経過後に先頭を1件取り出して表示するタイマーを張る
  function armTimer() {
    if (timer || queue.length === 0) return;
    const holdMs = getHoldMs(latestSettings);
    const wait = Math.max(0, holdMs - (Date.now() - lastAppliedAt));
    timer = setTimeout(() => {
      timer = null;
      const next = queue.shift();
      if (next !== undefined) {
        applyCandidate(next);
        armTimer(); // まだキューに残っていれば続けて予約
      }
    }, wait);
  }

  // 自動更新を予約する。保持時間が経過済み・キューが空なら即時反映し、
  // そうでなければキューの末尾に追加して自分の順番を待つ。
  // STATE_UPDATE等から同じ内容で繰り返し呼ばれても、直前に受理した内容と同じなら無視する。
  function scheduleAuto(candidate, settings) {
    latestSettings = settings;
    const key = JSON.stringify(candidate);
    if (key === lastKey) return;
    lastKey = key;
    const holdMs = getHoldMs(settings);
    if (queue.length === 0 && (Date.now() - lastAppliedAt) >= holdMs) {
      applyCandidate(candidate);
    } else {
      queue.push(candidate);
      armTimer();
    }
  }

  // 手動の強制表示・接続直後のキャッチアップ表示用。キュー・保持時間を無視して即座に反映し、
  // 以降の保持時間もこの時点から起算し直す。
  // renderFn を渡すと、通常のapplyFnの代わりにそちらを使う（点滅演出など専用の描画をしたい場合）。
  function forceShow(candidate, renderFn) {
    queue = [];
    if (timer) { clearTimeout(timer); timer = null; }
    lastKey = JSON.stringify(candidate);
    lastAppliedAt = Date.now();
    (renderFn || applyFn)(candidate);
  }

  return { scheduleAuto, forceShow };
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
