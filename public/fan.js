// ═══════════════════════════════════════════════════════════════════════
// fan.js — 観覧用ページ（保護者・観客向け）の便利機能（2609県ジュニア版・2026-10-08追加）
//
//  1. ⭐ 選手フォロー … 選んだ選手の得点・順位をページ上部にまとめて表示。
//                      新しい得点が確定したら通知（トースト）を出す。選んだ選手はブラウザに記憶。
//  2. 🔍 絞り込み    … 所属（クラブ）の選択と、名前・所属・BIBの検索欄（各ページ側で使う部品）
//  3. ❓ 得点の見かた … D・E・ND・加点などの説明（大会設定に合わせて文面を作る）
//  4. ⚡ 速報        … 直近に確定した得点の一覧
//
// ・閲覧専用。サーバーへは何も送らない（WebSocketの受信は各ページが行い、Fan.update(state)で渡す）。
// ・common.js（APPARATUS・MAG_ORDER・resolveVtSettings・categoryKey・vtKey）に依存する。
// ・この機能でエラーが起きても元のページ表示を止めないよう、外から呼ばれる入口はtry/catchで包む。
// ═══════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const LS_FOLLOWS = 'fan.follows';
  const LS_CLUB = 'fan.club';
  const LS_TICKER_OPEN = 'fan.tickerOpen';
  const MAX_FOLLOWS = 10;
  const GENDER_JP = { MAG: '男子', WAG: '女子' };
  const APP_JP = {
    MAG_FX: 'ゆか', MAG_PH: 'あん馬', MAG_SR: 'つり輪', MAG_VT: '跳馬', MAG_PB: '平行棒', MAG_HB: '鉄棒',
    WAG_VT: '跳馬', WAG_UB: '段違い平行棒', WAG_BB: '平均台', WAG_FX: 'ゆか',
  };

  // ── 小物 ──
  function lsGet(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
  }
  function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function catsOf(category) { return Array.isArray(category) ? category : (category ? [category] : []); }
  function catText(category) { return catsOf(category).join('・'); }
  function round3(x) { return Math.round((x + Number.EPSILON) * 1000) / 1000; }
  function fmt3(x) { return Number(x).toFixed(3); }
  function appJp(code) { return APP_JP[code] || code; }
  function genderOf(r) { return (typeof APPARATUS !== 'undefined' && APPARATUS[r.apparatus]?.gender) || r.athlete?.gender || ''; }
  // 選手を一意に識別するキー（同じBIBが別カテゴリーで使われることがあるため、性別＋BIB＋カテゴリー）
  function athleteId(gender, bib, category) { return `${gender}|${bib}|${categoryKey(category)}`; }
  // 検索用の文字列正規化：全角半角・大文字小文字・空白・カタカナ/ひらがなの違いを吸収
  function norm(s) {
    return String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '')
      .replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  }
  function timeHM(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  }
  function agoText(iso) {
    const t = new Date(iso).getTime();
    if (!t) return '';
    const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (sec < 60) return 'たった今';
    if (sec < 3600) return `${Math.floor(sec / 60)}分前`;
    return timeHM(iso);
  }

  // ── 跳馬2本の1本目・2本目を1行にまとめた行データ（scoreboard.html・results.htmlと同じ考え方） ──
  function buildMergedRows(state) {
    const confirmed = state.confirmed || [];
    const vtFinals = state.vtFinals || {};
    const settings = state.settings || {};
    const vtMode = (r) => isVT(r.apparatus) && resolveVtSettings(settings, r.apparatus.split('_')[0], r.athlete?.category).vtVaults >= 2;
    const consumed = new Set();
    const rows = [];
    confirmed.forEach((r, idx) => {
      if (consumed.has(idx)) return;
      if (!vtMode(r) || !r.athlete?.vtVault) { rows.push(r); return; }
      const bib = r.athlete.bib;
      let v1 = null, v2 = null;
      if (r.athlete.vtVault === 1) v1 = r; else v2 = r;
      const pairIdx = confirmed.findIndex((o, j) => j !== idx && !consumed.has(j) &&
        o.apparatus === r.apparatus && o.athlete?.bib === bib && o.athlete?.vtVault && o.athlete.vtVault !== r.athlete.vtVault &&
        categoryKey(o.athlete?.category) === categoryKey(r.athlete?.category));
      if (pairIdx !== -1) {
        const o = confirmed[pairIdx];
        if (o.athlete.vtVault === 1) v1 = o; else v2 = o;
        consumed.add(pairIdx);
      }
      consumed.add(idx);
      const vf = vtFinals[vtKey(r.apparatus, bib, r.athlete?.category)] || null;
      const athlete = v1 ? v1.athlete : { ...r.athlete, name: String(r.athlete.name || '').replace(/（2本目）$/, '') };
      rows.push({
        apparatus: r.apparatus, athlete, isDNF: false,
        finalScore: vf ? vf.finalScore : (v1 ? v1.finalScore : (v2 ? v2.finalScore : 0)),
        confirmedAt: vf ? vf.confirmedAt : (v2 ? v2.confirmedAt : (v1 ? v1.confirmedAt : '')),
        hanaMaru: !!(v1?.hanaMaru || v2?.hanaMaru),
        __vt: { vault1: v1, vault2: v2, final: vf },
      });
    });
    return rows;
  }
  function inCat(row, cat) { return catsOf(row.athlete?.category).includes(cat); }

  // 種目別順位（results.htmlと同じ：同点は同順位、棄権は順位なし）
  function apparatusRank(rows, code, gender, cat, bib) {
    const list = rows.filter(r => r.apparatus === code && genderOf(r) === gender && inCat(r, cat) && !r.isDNF)
      .sort((a, b) => b.finalScore - a.finalScore);
    let rank = 0, prev = null, found = null;
    list.forEach((r, i) => {
      if (prev === null || r.finalScore !== prev) rank = i + 1;
      prev = r.finalScore;
      if (String(r.athlete?.bib) === String(bib) && found === null) found = rank;
    });
    return { rank: found, count: list.length };
  }

  // 個人総合の暫定順位（results.htmlと同じ：そのカテゴリーで得点のある選手の合計で並べる、同点は同順位）
  function totalStanding(rows, gender, cat, bib) {
    const order = gender === 'WAG' ? WAG_ORDER : MAG_ORDER;
    const ath = {};
    rows.filter(r => genderOf(r) === gender && order.includes(r.apparatus) && inCat(r, cat)).forEach(r => {
      const b = String(r.athlete?.bib || '');
      if (!ath[b]) ath[b] = { bib: b, total: 0, completed: 0 };
      ath[b].total = round3(ath[b].total + (Number(r.finalScore) || 0));
      ath[b].completed += 1;
    });
    const arr = Object.values(ath).sort((a, b) => b.total - a.total);
    let rank = 0, prev = null, me = null;
    arr.forEach((a, i) => {
      if (prev === null || a.total !== prev) rank = i + 1;
      prev = a.total;
      if (a.bib === String(bib)) me = { ...a, rank };
    });
    return { me, count: arr.length };
  }

  // ═════════════ 状態 ═════════════
  let state = null;
  let rows = [];
  let follows = lsGet(LS_FOLLOWS, []);
  if (!Array.isArray(follows)) follows = [];
  let prevSig = null;           // フォロー選手の「種目→得点」の前回値（新着検知用）
  let prevTickerKeys = null;    // 速報欄の前回表示分（新着の点滅用）
  let flashIds = new Set();     // 点滅させるフォロー選手のチップ
  let detailOpen = null;        // 内訳ポップアップを開いている選手・種目 { fid, code }（閉じたらnull）
  let mountEl = null;
  let tickerOpen = lsGet(LS_TICKER_OPEN, false) === true; // 初期は3件だけ（スマホで表が下に押しやられないように）
  let options = { follow: true, ticker: true };

  function isFollowed(id) { return follows.some(f => f.id === id); }

  function allAthletes() {
    const map = new Map();
    (state?.roster || []).forEach(a => {
      const id = athleteId(a.gender, a.bib, a.category);
      if (!map.has(id)) map.set(id, { id, gender: a.gender, bib: String(a.bib), category: a.category, name: a.name || '', club: a.club || '' });
    });
    // 名簿にいない選手（名簿の読み直し前など）も確定記録から拾う
    rows.forEach(r => {
      const g = genderOf(r);
      const id = athleteId(g, r.athlete?.bib, r.athlete?.category);
      if (!map.has(id)) map.set(id, { id, gender: g, bib: String(r.athlete?.bib || ''), category: r.athlete?.category, name: r.athlete?.name || '', club: r.athlete?.club || '' });
    });
    return [...map.values()];
  }

  // ═════════════ ⭐ フォロー ═════════════
  function followSummary(f) {
    const order = f.gender === 'WAG' ? WAG_ORDER : MAG_ORDER;
    const mine = rows.filter(r => genderOf(r) === f.gender && String(r.athlete?.bib) === String(f.bib) &&
      categoryKey(r.athlete?.category) === categoryKey(f.category));
    const byCode = {};
    mine.forEach(r => { byCode[r.apparatus] = r; });
    return { order, byCode, cats: catsOf(f.category) };
  }

  function chipHtml(f, code, r) {
    const flash = flashIds.has(`${f.id}|${code}`) ? ' fan-flash' : '';
    let val, sub = '';
    if (!r) { val = '<span class="fan-dim">—</span>'; }
    else if (r.isDNF) { val = '<span class="fan-dnf">棄権</span>'; }
    else if (r.__vt && !r.__vt.final) {
      const v = r.__vt.vault1 || r.__vt.vault2;
      val = `<span class="fan-pending">${v ? fmt3(v.finalScore) : '—'}</span>`;
      sub = `<div class="fan-chip-sub">${r.__vt.vault1 ? '1本目' : '2本目'}・集計中</div>`;
    } else {
      val = fmt3(r.finalScore) + (r.hanaMaru ? '<span class="fan-hm">🌸</span>' : '');
      const cats = catsOf(r.athlete?.category);
      if (cats.length === 1) {
        const ar = apparatusRank(rows, code, f.gender, cats[0], f.bib);
        if (ar.rank) sub = `<div class="fan-chip-sub">${ar.rank}位 / ${ar.count}人</div>`;
      }
      if (r.__vt?.final) {
        const vf = r.__vt.final;
        sub += `<div class="fan-chip-sub">${vf.method === 'avg' ? '2本平均' : '高い方'}</div>`;
      }
    }
    // 得点がある種目はタップで内訳のポップアップを開く
    const tappable = r && !r.isDNF;
    const tap = tappable ? ` fan-tap" role="button" onclick="Fan.openDetail('${encodeURIComponent(f.id)}','${code}')` : '';
    return `<div class="fan-chip${r ? ' done' : ''}${flash}${tap}">
      <div class="fan-chip-app">${APPARATUS[code]?.icon || ''} ${appJp(code)}</div>
      <div class="fan-chip-val">${val}</div>${sub}</div>`;
  }

  // ═════════════ 種目の内訳ポップアップ ═════════════
  // フォロー選手の種目チップをタップすると全面に開く。上部の種目タブで切り替え、外側・✕・Escで閉じる。
  // 新しい得点を受信したら中身も描き直す。
  function noDScore(gender, category) {
    const list = state?.settings?.noDScoreCategories || [];
    return catsOf(category).some(c => list.includes(`${gender}|${c}`));
  }
  // ※ページ側の<table>用スタイルの影響を受けないよう、tableは使わずdivで組む
  function detailRowHtml(label, v, noD) {
    const head = label ? `<div class="fan-d-label">${label}</div>` : '';
    if (!v) return `<div class="fan-d-block">${head}<div class="fan-dim">まだ確定していません</div></div>`;
    if (v.isDNF) return `<div class="fan-d-block">${head}<span class="fan-dnf">棄権</span></div>`;
    const nd = Number(v.nd || 0), b = Number(v.stickBonus || 0);
    // ※審判ひとりずつのEの点数は、観覧用ページには出さない（平均のみ表示）
    const cell = (k, val, cls = '') => `<div class="fan-d-cell ${cls}"><span class="fan-k">${k}</span><span class="fan-v">${val}</span></div>`;
    return `<div class="fan-d-block">${head}<div class="fan-d-row">
      ${cell('D', noD ? '<span class="fan-dim">なし</span>' : Number(v.dScore).toFixed(1))}
      ${cell('E', Number(v.eAvg).toFixed(3), 'fan-d-e')}
      ${cell('ND', nd ? '−' + nd.toFixed(1) : '<span class="fan-dim">0.0</span>')}
      ${cell('加点', b ? '＋' + b.toFixed(1) : '<span class="fan-dim">0.0</span>')}
      ${cell('得点', fmt3(v.finalScore), 'fan-d-score')}
    </div></div>`;
  }
  function detailBodyHtml(f, code, r) {
    if (!r) return `<div class="fan-dm-empty fan-dim">この種目はまだ得点がありません</div>`;
    if (r.isDNF) return `<div class="fan-dm-empty"><span class="fan-dnf">棄権</span></div>`;
    const noD = noDScore(f.gender, f.category);
    const cats = catsOf(r.athlete?.category);
    const vf = r.__vt?.final;
    let big, rankTxt = '';
    if (r.__vt && !vf) {
      const v = r.__vt.vault1 || r.__vt.vault2;
      big = `<span class="fan-pending">${v ? fmt3(v.finalScore) : '—'}</span>`;
      rankTxt = `${r.__vt.vault1 ? '1本目' : '2本目'}のみ・集計中`;
    } else {
      big = fmt3(r.finalScore) + (r.hanaMaru ? '<span class="fan-hm">🌸</span>' : '');
      if (cats.length === 1) {
        const ar = apparatusRank(rows, code, f.gender, cats[0], f.bib);
        if (ar.rank) rankTxt = `${esc(cats[0])}クラス ${ar.rank}位 / ${ar.count}人`;
      }
    }
    let body = `<div class="fan-dm-score"><div class="fan-dm-big">${big}</div><div class="fan-dm-rank">${rankTxt}</div></div>`;
    if (r.__vt) {
      body += detailRowHtml('1本目', r.__vt.vault1, noD) + detailRowHtml('2本目', r.__vt.vault2, noD);
      if (vf) {
        const bonus = Number(vf.bonus || 0);
        body += `<div class="fan-d-final">${vf.method === 'avg' ? '2本の平均' : `高い方（${vf.winnerVault}本目）`} ${fmt3(vf.baseFinalScore)}${bonus ? ` ＋ 加点 ${bonus.toFixed(1)}` : ''} ＝ <b>${fmt3(vf.finalScore)}</b></div>`;
      } else {
        body += `<div class="fan-d-final fan-dim">2本そろうと採用得点（${resolveVtSettings(state?.settings || {}, f.gender, f.category).vtScoring === 'avg' ? '2本の平均' : '高い方'}）が決まります</div>`;
      }
    } else {
      body += detailRowHtml('', r, noD);
    }
    const formula = noD ? '得点 ＝ E ＋ 加点 − ND（10点満点のクラス）' : '得点 ＝ D ＋ E − ND ＋ 加点';
    body += `<div class="fan-dm-foot"><div>${formula}</div><div>E は審判の点数の平均です。</div></div>`;
    return body;
  }
  function renderDetail() {
    if (!detailOpen) return;
    const f = follows.find(x => x.id === detailOpen.fid);
    if (!f) { closeModal(); return; }
    const s = followSummary(f);
    const code = detailOpen.code;
    const standing = s.cats.map(cat => {
      const t = totalStanding(rows, f.gender, cat, f.bib);
      return t.me ? `<span>${s.cats.length > 1 ? esc(cat) + 'クラス ' : ''}個人総合（暫定）<b>${t.me.rank}位</b> / ${t.count}人・合計 ${fmt3(t.me.total)}</span>` : '';
    }).join(' ');
    const tabs = s.order.map(c => {
      const r = s.byCode[c];
      return `<button class="fan-dm-tab ${c === code ? 'on' : ''} ${r ? '' : 'none'}" onclick="Fan.detailTab('${c}')">${APPARATUS[c]?.icon || ''} ${appJp(c)}</button>`;
    }).join('');
    let m = document.getElementById('fan-modal');
    if (!m || m.dataset.kind !== 'detail') {
      closeModal(true);
      m = document.createElement('div');
      m.id = 'fan-modal';
      m.dataset.kind = 'detail';
      m.onclick = e => { if (e.target === m) closeModal(); };
      document.body.appendChild(m);
    }
    m.innerHTML = `<div class="fan-modal-box fan-dm ${f.gender === 'WAG' ? 'wag' : 'mag'}">
      <div class="fan-modal-head">
        <div><div class="fan-name">⭐ ${esc(f.name)}</div>
          <div class="fan-meta">${GENDER_JP[f.gender] || ''} ${esc(catText(f.category))}クラス ・ BIB ${esc(f.bib)}${f.club ? ' ・ ' + esc(f.club) : ''}</div>
          <div class="fan-dm-standing">${standing}</div></div>
        <button class="fan-btn" onclick="Fan.closeModal()">✕ 閉じる</button>
      </div>
      <div class="fan-dm-tabs">${tabs}</div>
      <div class="fan-dm-body">${detailBodyHtml(f, code, s.byCode[code])}</div>
    </div>`;
  }

  function followCardHtml(f) {
    const s = followSummary(f);
    const done = Object.keys(s.byCode).length;
    const standings = s.cats.map(cat => {
      const t = totalStanding(rows, f.gender, cat, f.bib);
      if (!t.me) return `<div class="fan-standing"><span class="fan-dim">${esc(cat)}クラス：まだ得点がありません</span></div>`;
      const medal = t.me.rank === 1 ? '🥇' : t.me.rank === 2 ? '🥈' : t.me.rank === 3 ? '🥉' : '';
      return `<div class="fan-standing">
        <span class="fan-st-label">${s.cats.length > 1 ? esc(cat) + 'クラス ' : ''}個人総合（暫定）</span>
        <span class="fan-st-rank">${medal}${t.me.rank}位</span><span class="fan-dim"> / ${t.count}人</span>
        <span class="fan-st-total">合計 ${fmt3(t.me.total)}</span>
      </div>`;
    }).join('');
    return `<div class="fan-card ${f.gender === 'WAG' ? 'wag' : 'mag'}">
      <div class="fan-card-head">
        <div>
          <div class="fan-name">⭐ ${esc(f.name)}</div>
          <div class="fan-meta">${GENDER_JP[f.gender] || ''} ${esc(catText(f.category))}クラス ・ BIB ${esc(f.bib)}${f.club ? ' ・ ' + esc(f.club) : ''}</div>
        </div>
        <div class="fan-done">${done}種目 終了</div>
      </div>
      ${standings}
      <div class="fan-chips">${s.order.map(code => chipHtml(f, code, s.byCode[code])).join('')}</div>
      ${done ? '<div class="fan-dim fan-small fan-tap-hint">種目をタップすると D・E などの内訳が見られます</div>' : ''}
    </div>`;
  }

  function followSectionHtml() {
    if (follows.length === 0) {
      return `<div class="fan-follow-empty">
        <div><b>⭐ 選手をフォロー</b><span class="fan-dim">　お子さまなどを選ぶと、得点と順位をここにまとめて表示し、得点が出たらお知らせします。</span></div>
        <button class="fan-btn fan-btn-gold" onclick="Fan.openPicker()">選手を選ぶ</button>
      </div>`;
    }
    return `<div class="fan-follow">
      <div class="fan-sec-head"><span>⭐ フォロー中の選手</span><button class="fan-btn" onclick="Fan.openPicker()">✏️ 選手を追加・解除</button></div>
      <div class="fan-cards">${follows.map(followCardHtml).join('')}</div>
    </div>`;
  }

  // ═════════════ ⚡ 速報 ═════════════
  function tickerItems(limit) {
    return rows.filter(r => r.confirmedAt)
      .sort((a, b) => String(b.confirmedAt).localeCompare(String(a.confirmedAt)))
      .slice(0, limit);
  }
  function tickerKey(r) { return `${r.apparatus}|${r.athlete?.bib}|${categoryKey(r.athlete?.category)}|${r.confirmedAt}|${r.finalScore}`; }

  function tickerHtml() {
    const items = tickerItems(tickerOpen ? 8 : 3);
    if (items.length === 0) return '';
    const fresh = prevTickerKeys ? items.filter(r => !prevTickerKeys.has(tickerKey(r))).map(tickerKey) : [];
    const lis = items.map(r => {
      const g = genderOf(r);
      const fid = athleteId(g, r.athlete?.bib, r.athlete?.category);
      let score;
      if (r.isDNF) score = '<span class="fan-dnf">棄権</span>';
      else if (r.__vt && !r.__vt.final) {
        const v = r.__vt.vault2 || r.__vt.vault1;
        score = `<span class="fan-pending">${v ? fmt3(v.finalScore) : '—'}</span><span class="fan-dim fan-small"> ${r.__vt.vault2 ? '2本目' : '1本目'}</span>`;
      } else score = fmt3(r.finalScore) + (r.__vt ? '<span class="fan-dim fan-small"> 採用</span>' : '');
      return `<li class="${fresh.includes(tickerKey(r)) ? 'fan-flash' : ''}${isFollowed(fid) ? ' fan-mine' : ''}">
        <span class="fan-t-time" data-iso="${esc(r.confirmedAt)}">${agoText(r.confirmedAt)}</span>
        <span class="fan-t-app ${g === 'WAG' ? 'wag' : 'mag'}">${GENDER_JP[g] || ''} ${appJp(r.apparatus)}</span>
        <span class="fan-t-name">${isFollowed(fid) ? '⭐' : ''}${esc(r.athlete?.name)}<span class="fan-dim fan-small"> ${esc(catText(r.athlete?.category))}・${esc(r.athlete?.club)}</span></span>
        <span class="fan-t-score">${score}</span>
      </li>`;
    }).join('');
    return `<div class="fan-ticker">
      <div class="fan-sec-head"><span>⚡ 速報（新しく確定した得点）</span>
        <button class="fan-btn" onclick="Fan.toggleTicker()">${tickerOpen ? '▴ 少なく' : '▾ もっと見る'}</button></div>
      <ul>${lis}</ul>
    </div>`;
  }

  // ═════════════ 描画・新着検知 ═════════════
  function signature() {
    const sig = {};
    follows.forEach(f => {
      const s = followSummary(f);
      Object.entries(s.byCode).forEach(([code, r]) => {
        sig[`${f.id}|${code}`] = r.isDNF ? 'DNF' : (r.__vt ? `${r.__vt.vault1?.finalScore}|${r.__vt.vault2?.finalScore}|${r.__vt.final?.finalScore}` : String(r.finalScore));
      });
    });
    return sig;
  }

  function notifyChanges() {
    const sig = signature();
    if (prevSig) {
      const changed = Object.keys(sig).filter(k => sig[k] !== prevSig[k]);
      changed.forEach(k => {
        const [g, bib, ck, code] = k.split('|');
        const f = follows.find(x => x.id === `${g}|${bib}|${ck}`);
        const r = f && followSummary(f).byCode[code];
        if (!f || !r) return;
        flashIds.add(k);
        let txt;
        if (r.isDNF) txt = '棄権';
        else if (r.__vt && !r.__vt.final) {
          const isSecond = !!r.__vt.vault2 && sig[k].split('|')[1] !== (prevSig[k] || '').split('|')[1];
          const v = isSecond ? r.__vt.vault2 : (r.__vt.vault1 || r.__vt.vault2);
          txt = `${isSecond ? '2本目' : '1本目'} ${fmt3(v.finalScore)}`;
        } else txt = (r.__vt ? '採用 ' : '') + fmt3(r.finalScore);
        toast(`⭐ ${f.name}さん　${appJp(code)} <b>${txt}</b>`);
      });
      if (changed.length && navigator.vibrate) { try { navigator.vibrate(120); } catch (e) {} }
      if (changed.length) setTimeout(() => { flashIds.clear(); }, 4000);
    }
    prevSig = sig;
  }

  function render() {
    if (!mountEl) return;
    let html = '';
    if (options.follow) html += followSectionHtml();
    if (options.ticker && state) html += tickerHtml();
    mountEl.innerHTML = html;
    // データ受信前（state=null）に空の集合を作ると、最初の受信で全件が「新着」扱いになるため、受信後だけ記録する
    if (state) prevTickerKeys = new Set(tickerItems(8).map(tickerKey));
  }

  // 「○分前」の表示を30秒ごとに更新（再描画はしない）
  setInterval(() => {
    document.querySelectorAll('.fan-t-time[data-iso]').forEach(el => { el.textContent = agoText(el.dataset.iso); });
  }, 30000);

  function toast(html) {
    let box = document.getElementById('fan-toasts');
    if (!box) { box = document.createElement('div'); box.id = 'fan-toasts'; document.body.appendChild(box); }
    const el = document.createElement('div');
    el.className = 'fan-toast';
    el.innerHTML = html;
    el.onclick = () => el.remove();
    box.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 6000);
  }

  // ═════════════ 選手を選ぶ画面 ═════════════
  let pickerQuery = '';
  function openPicker() {
    closeModal();
    const m = document.createElement('div');
    m.id = 'fan-modal';
    m.innerHTML = `<div class="fan-modal-box">
      <div class="fan-modal-head"><b>⭐ フォローする選手を選ぶ</b><button class="fan-btn" onclick="Fan.closeModal()">✕ 閉じる</button></div>
      <input id="fan-picker-q" class="fan-input" type="search" placeholder="名前・所属・BIBで検索" value="${esc(pickerQuery)}" autocomplete="off">
      <div class="fan-dim fan-small" style="margin:6px 2px">☆を押すとフォロー（最大${MAX_FOLLOWS}人）。この端末のブラウザにだけ記憶されます。</div>
      <div id="fan-picker-list" class="fan-picker-list"></div>
    </div>`;
    m.addEventListener('click', e => { if (e.target === m) closeModal(); });
    document.body.appendChild(m);
    const q = document.getElementById('fan-picker-q');
    q.addEventListener('input', () => { pickerQuery = q.value; renderPickerList(); });
    renderPickerList();
  }
  function renderPickerList() {
    const box = document.getElementById('fan-picker-list');
    if (!box) return;
    const q = norm(pickerQuery);
    const list = allAthletes().filter(a => !q || norm(`${a.name} ${a.club} ${a.bib}`).includes(q) || norm(a.name).includes(q))
      .sort((a, b) => (a.gender.localeCompare(b.gender)) || categoryKey(a.category).localeCompare(categoryKey(b.category)) || (parseInt(a.bib) - parseInt(b.bib)));
    if (list.length === 0) {
      box.innerHTML = `<div class="fan-dim" style="padding:20px;text-align:center">${state ? '該当する選手がいません' : '接続中です。少しお待ちください'}</div>`;
      return;
    }
    box.innerHTML = list.map(a => `<div class="fan-pick ${isFollowed(a.id) ? 'on' : ''}" data-id="${esc(a.id)}">
        <span class="fan-star">${isFollowed(a.id) ? '⭐' : '☆'}</span>
        <span class="fan-pick-main"><b>${esc(a.name)}</b><span class="fan-dim fan-small"> ${esc(a.club)}</span></span>
        <span class="fan-pick-tag ${a.gender === 'WAG' ? 'wag' : 'mag'}">${GENDER_JP[a.gender] || ''} ${esc(catText(a.category))}・${esc(a.bib)}</span>
      </div>`).join('');
    box.querySelectorAll('.fan-pick').forEach(el => el.addEventListener('click', () => toggleFollow(el.dataset.id)));
  }
  function toggleFollow(id) {
    if (isFollowed(id)) follows = follows.filter(f => f.id !== id);
    else {
      if (follows.length >= MAX_FOLLOWS) { toast(`フォローできるのは${MAX_FOLLOWS}人までです`); return; }
      const a = allAthletes().find(x => x.id === id);
      if (!a) return;
      follows.push({ id: a.id, gender: a.gender, bib: a.bib, category: a.category, name: a.name, club: a.club });
    }
    lsSet(LS_FOLLOWS, follows);
    prevSig = signature(); // 追加した瞬間に既存の得点を「新着」として通知しない
    renderPickerList();
    render();
  }
  // keepDetail=true は内訳ポップアップを開き直すとき（ほかのポップアップを閉じるだけ）
  function closeModal(keepDetail) { const m = document.getElementById('fan-modal'); if (m) m.remove(); if (keepDetail !== true) detailOpen = null; }

  // ═════════════ ❓ 得点の見かた ═════════════
  function eJudgeText(settings, gender) {
    const perG = gender === 'WAG' ? settings?.eJudgeCountWAG : settings?.eJudgeCountMAG;
    const n = Number(perG) || Number(settings?.eJudgeCount) || 0;
    if (!n) return '';
    if (n <= 2) return `${GENDER_JP[gender]}は審判${n}人の平均`;
    if (n === 3 && settings?.eAvg3judges !== 'trim') return `${GENDER_JP[gender]}は審判3人の平均`;
    return `${GENDER_JP[gender]}は審判${n}人のうち、いちばん高い点と低い点を除いた${n - 2}人の平均`;
  }
  function guideHtml() {
    const s = state?.settings || null;
    const noD = (s?.noDScoreCategories || []).map(k => { const [g, c] = k.split('|'); return `${GENDER_JP[g] || g}${c}`; });
    const vt2 = Object.entries(s?.vtOverrides || {}).filter(([, v]) => Number(v.vtVaults) >= 2)
      .map(([k, v]) => { const [g, c] = k.split('|'); return { name: `${GENDER_JP[g] || g}${c}`, avg: (v.vtScoring || s?.vtScoring) === 'avg' }; });
    if (s && Number(s.vtVaults) >= 2 && vt2.length === 0) vt2.push({ name: '全クラス', avg: s.vtScoring === 'avg' });
    const eTexts = s ? ['MAG', 'WAG'].map(g => eJudgeText(s, g)).filter(Boolean) : [];
    return `
      <div class="fan-guide-formula">得点 ＝ <span class="g-d">D</span> ＋ <span class="g-e">E</span> − <span class="g-nd">ND</span> ＋ <span class="g-b">加点</span></div>
      <div class="fan-guide-item"><div class="g-h"><span class="g-d">D</span>（演技価値点）＝ 技の難しさ</div>
        演技に入れた技の難しさなどを足し合わせた点です。上限はありません。<br>
        <span class="fan-guide-eg">🍳 料理でいうと「メニューの豪華さ」。難しい技をたくさん入れるほど高くなります。</span></div>
      <div class="fan-guide-item"><div class="g-h"><span class="g-e">E</span>（実施点）＝ 出来栄え</div>
        10点満点から、ひざやつま先の乱れ、着地の動きなどを減点した点です。${eTexts.length ? `<br>${eTexts.join('、')}です。` : ''}<br>
        <span class="fan-guide-eg">🍳 料理でいうと「味と盛り付けの仕上がり」。きれいに美しく行うほど10点に近づきます。</span></div>
      ${noD.length ? `<div class="fan-guide-item"><div class="g-h">🔟 10点満点のクラス</div>
        ${esc(noD.join('・'))}クラスはDを使わず、Eの10点満点で採点します（Dの欄は0.0と表示されます）。</div>` : `<div class="fan-guide-item"><div class="g-h">🔟 10点満点のクラス</div>クラスによっては、Dを使わずEの10点満点で採点することがあります（Dの欄は0.0と表示されます）。</div>`}
      <div class="fan-guide-item"><div class="g-h"><span class="g-nd">ND</span>（減点）</div>
        ラインオーバーや時間の超過など、演技全体に対する減点です。</div>
      <div class="fan-guide-item"><div class="g-h"><span class="g-b">加点</span>（BONUS）</div>
        大会の規定にもとづく加点です。</div>
      ${vt2.length ? `<div class="fan-guide-item"><div class="g-h">🏃 跳馬の2本跳躍</div>
        ${esc(vt2.map(v => v.name).join('・'))}クラスは跳馬を2本跳びます。${vt2.every(v => v.avg) ? '2本の平均' : vt2.every(v => !v.avg) ? '2本のうち高い方' : '2本の平均または高い方（クラスによる）'}がその選手の跳馬の得点になります。1本目が出た段階では「集計中」と表示されます。</div>`
        : `<div class="fan-guide-item"><div class="g-h">🏃 跳馬の2本跳躍</div>クラスによっては跳馬を2本跳び、2本の平均（または高い方）が得点になります。</div>`}
      ${s?.hanaMaru ? `<div class="fan-guide-item"><div class="g-h">🌸 花丸</div>審判団から「よくできました」の花丸がついた演技です。</div>` : ''}
      <div class="fan-guide-item"><div class="g-h">🏆 順位について</div>
        個人総合は、各種目の得点の合計で並べます。演技が終わっていない選手がいる間は<b>暫定</b>の順位です。
        このページでは同点は同じ順位で表示しています。<b>正式な順位・表彰は大会本部の発表をご確認ください。</b></div>
      <div class="fan-guide-item fan-dim fan-small">得点は確定後に審判団の判断で訂正されることがあります。その場合このページの表示も自動で更新されます。</div>`;
  }
  function openGuide() {
    closeModal();
    const m = document.createElement('div');
    m.id = 'fan-modal';
    m.innerHTML = `<div class="fan-modal-box">
      <div class="fan-modal-head"><b>❓ 得点の見かた</b><button class="fan-btn" onclick="Fan.closeModal()">✕ 閉じる</button></div>
      <div class="fan-guide">${guideHtml()}</div></div>`;
    m.addEventListener('click', e => { if (e.target === m) closeModal(); });
    document.body.appendChild(m);
  }

  // ═════════════ 🔍 絞り込み欄（所属＋検索） ═════════════
  // 各ページは Fan.mountFinder(要素, 変更時の再描画関数) を呼び、
  // 描画時に Fan.finderMatch(athlete) で行を絞り込む。Fan.finderActive() は絞り込み中かどうか。
  let finder = { club: lsGet(LS_CLUB, 'ALL') || 'ALL', q: '', el: null, onChange: null, clubsKey: '' };
  function mountFinder(el, onChange) {
    finder.el = el; finder.onChange = onChange;
    el.classList.add('fan-finder');
    el.innerHTML = `
      <span class="fan-finder-label">🔍</span>
      <select id="fan-club" class="fan-select" aria-label="所属で絞り込み"><option value="ALL">所属：すべて</option></select>
      <input id="fan-q" class="fan-input fan-q" type="search" placeholder="名前・所属・BIBで検索" autocomplete="off">
      <button id="fan-clear" class="fan-btn" style="display:none">✕ 解除</button>`;
    const sel = el.querySelector('#fan-club'), q = el.querySelector('#fan-q'), clr = el.querySelector('#fan-clear');
    sel.addEventListener('change', () => { finder.club = sel.value; lsSet(LS_CLUB, finder.club); updateClear(); onChange && onChange(); });
    let timer = null;
    q.addEventListener('input', () => { finder.q = q.value; updateClear(); clearTimeout(timer); timer = setTimeout(() => onChange && onChange(), 150); });
    clr.addEventListener('click', () => { finder.q = ''; finder.club = 'ALL'; q.value = ''; sel.value = 'ALL'; lsSet(LS_CLUB, 'ALL'); updateClear(); onChange && onChange(); });
    refreshClubs();
    updateClear();
  }
  function updateClear() {
    const clr = finder.el?.querySelector('#fan-clear');
    if (clr) clr.style.display = finderActive() ? '' : 'none';
  }
  function refreshClubs() {
    const sel = finder.el?.querySelector('#fan-club');
    if (!sel) return;
    const clubs = [...new Set(allAthletes().map(a => a.club).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'));
    // 前回選んだ所属が今回の名簿に無ければ「すべて」に戻す（ただし接続直後の空の状態では戻さない）
    if (finder.club !== 'ALL' && clubs.length && !clubs.includes(finder.club)) { finder.club = 'ALL'; lsSet(LS_CLUB, 'ALL'); }
    const key = clubs.join('\n');
    if (key !== finder.clubsKey) {
      finder.clubsKey = key;
      sel.innerHTML = `<option value="ALL">所属：すべて</option>` + clubs.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    }
    sel.value = clubs.includes(finder.club) ? finder.club : 'ALL';
    updateClear();
  }
  function finderActive() { return finder.club !== 'ALL' || norm(finder.q) !== ''; }
  function finderMatch(athlete) {
    if (!athlete) return false;
    if (finder.club !== 'ALL' && (athlete.club || '') !== finder.club) return false;
    const q = norm(finder.q);
    if (q && !norm(`${athlete.name || ''}${athlete.club || ''}`).includes(q) && norm(athlete.bib) !== q) return false;
    return true;
  }

  // ═════════════ スタイル ═════════════
  const CSS = `
  .fan-area { padding:10px 16px 0; display:flex; flex-direction:column; gap:10px; }
  .fan-area:empty { display:none; }
  .fan-dim { color:#7a8a99; } .fan-small { font-size:11px; }
  .fan-btn { padding:5px 12px; background:#1a2634; border:1px solid #4a5a6a; border-radius:14px; color:#c5d0da; font-size:12px; cursor:pointer; white-space:nowrap; font-family:inherit; }
  .fan-btn:hover { border-color:#dfaf4a; color:#dfaf4a; }
  .fan-btn-gold { background:#3a2e10; border-color:#dfaf4a; color:#ffd36a; font-weight:700; padding:7px 16px; }
  .fan-sec-head { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:13px; font-weight:700; color:#dfaf4a; margin-bottom:8px; }
  .fan-follow-empty { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; background:#16212e; border:1px dashed #4a5a6a; border-radius:12px; padding:10px 14px; font-size:13px; }
  .fan-follow, .fan-ticker { background:#16212e; border:1px solid #2a3a4a; border-radius:12px; padding:10px 12px; }
  .fan-cards { display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:10px; }
  .fan-card { background:#0f1923; border:1px solid #2a3a4a; border-left:5px solid #4a9eff; border-radius:10px; padding:10px 12px; }
  .fan-card.wag { border-left-color:#ff6ac8; }
  .fan-card-head { display:flex; justify-content:space-between; gap:8px; align-items:flex-start; }
  .fan-name { font-size:16px; font-weight:800; }
  .fan-meta { font-size:11px; color:#7a8a99; margin-top:2px; }
  .fan-done { font-size:11px; color:#7a8a99; white-space:nowrap; background:#1a2634; border-radius:10px; padding:2px 8px; }
  .fan-standing { margin-top:8px; font-size:13px; display:flex; align-items:baseline; gap:6px; flex-wrap:wrap; }
  .fan-st-label { font-size:11px; color:#dfaf4a; }
  .fan-st-rank { font-size:20px; font-weight:800; color:#fff; }
  .fan-st-total { margin-left:auto; color:#4adf8f; font-weight:700; font-variant-numeric:tabular-nums; }
  .fan-chips { display:grid; grid-template-columns:repeat(auto-fill, minmax(88px, 1fr)); gap:6px; margin-top:8px; }
  .fan-chip { background:#16212e; border:1px solid #22303f; border-radius:8px; padding:5px 6px; text-align:center; }
  .fan-chip.done { border-color:#2f4a3a; }
  .fan-chip-app { font-size:11px; color:#9aa8b5; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .fan-chip-val { font-size:15px; font-weight:700; color:#4adf8f; font-variant-numeric:tabular-nums; }
  .fan-chip-sub { font-size:10px; color:#dfaf4a; }
  .fan-chip.fan-tap { cursor:pointer; -webkit-tap-highlight-color:transparent; }
  .fan-chip.fan-tap:active { transform:scale(0.97); border-color:#dfaf4a; }
  .fan-tap-hint { margin-top:6px; text-align:center; }
  /* 内訳ポップアップ */
  .fan-dm.mag { border-left:6px solid #4a9eff; }
  .fan-dm.wag { border-left:6px solid #ff6ac8; }
  .fan-dm-standing { font-size:13px; color:#dfaf4a; margin-top:4px; }
  .fan-dm-standing b { font-size:16px; }
  .fan-dm-tabs { display:flex; gap:6px; overflow-x:auto; padding-bottom:6px; margin-bottom:8px; -webkit-overflow-scrolling:touch; }
  .fan-dm-tab { flex:0 0 auto; padding:7px 10px; border-radius:16px; border:1px solid #2a3a4a; background:#1a2634; color:#cfd8e0; font-size:13px; cursor:pointer; }
  .fan-dm-tab.on { border-color:#dfaf4a; background:#2e261a; color:#ffd77a; font-weight:700; }
  .fan-dm-tab.none { opacity:.45; }
  .fan-dm-body { background:#121b26; border:1px solid #22303f; border-radius:10px; padding:12px; }
  .fan-dm-score { text-align:center; margin-bottom:10px; }
  .fan-dm-big { font-size:40px; font-weight:800; color:#4adf8f; font-variant-numeric:tabular-nums; line-height:1.1; }
  .fan-dm-rank { font-size:14px; color:#dfaf4a; margin-top:2px; }
  .fan-dm-empty { text-align:center; padding:24px 0; }
  .fan-d-block { padding:6px 0; }
  .fan-d-block + .fan-d-block { border-top:1px dashed #2a3a4a; }
  .fan-d-label { font-size:12px; color:#9aa8b5; margin-bottom:2px; }
  .fan-d-row { display:grid; grid-template-columns:0.8fr 1.6fr 0.8fr 0.8fr 1.3fr; gap:4px; align-items:start; font-variant-numeric:tabular-nums; }
  .fan-d-cell { text-align:center; min-width:0; }
  .fan-k { display:block; font-size:11px; color:#7a8a99; }
  .fan-v { display:block; font-size:18px; white-space:nowrap; }
  .fan-d-score .fan-v { color:#4adf8f; font-weight:700; }
  .fan-d-final { margin-top:8px; font-size:14px; text-align:right; }
  .fan-d-final b { color:#4adf8f; font-size:18px; }
  .fan-dm-foot { margin-top:10px; font-size:12px; color:#9aa8b5; line-height:1.6; }
  .fan-pending { color:#c5d0da; } .fan-dnf { color:#ff8888; font-size:13px; } .fan-hm { font-size:12px; margin-left:2px; }
  .fan-ticker ul { list-style:none; display:flex; flex-direction:column; gap:4px; }
  .fan-ticker li { display:grid; grid-template-columns:62px 112px 1fr auto; gap:8px; align-items:center; font-size:13px; padding:5px 6px; border-radius:6px; background:#0f1923; }
  .fan-ticker li.fan-mine { background:#2a2410; }
  .fan-t-time { font-size:11px; color:#7a8a99; white-space:nowrap; }
  .fan-t-app { font-size:11px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .fan-t-app.mag { color:#7ab8ff; } .fan-t-app.wag { color:#ff8ad6; }
  .fan-t-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:700; }
  .fan-t-score { color:#4adf8f; font-weight:700; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .fan-flash { animation:fanFlash 2.2s ease 2; }
  @keyframes fanFlash { 0%,100% { box-shadow:0 0 0 0 rgba(223,175,74,0); } 30% { box-shadow:0 0 0 3px rgba(223,175,74,.9); background:#3a2e10; } }
  #fan-toasts { position:fixed; left:50%; bottom:18px; transform:translateX(-50%); z-index:9000; display:flex; flex-direction:column; gap:8px; width:min(92vw, 420px); pointer-events:none; }
  .fan-toast { pointer-events:auto; background:#2a2410; border:1px solid #dfaf4a; color:#fff; border-radius:12px; padding:12px 14px; font-size:14px; box-shadow:0 6px 24px rgba(0,0,0,.5); animation:fanIn .3s ease; transition:opacity .4s, transform .4s; }
  .fan-toast b { color:#4adf8f; font-size:16px; }
  .fan-toast.out { opacity:0; transform:translateY(10px); }
  @keyframes fanIn { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:none; } }
  #fan-modal { position:fixed; inset:0; z-index:9500; background:rgba(5,10,15,.75); display:flex; align-items:flex-start; justify-content:center; padding:24px 12px; overflow-y:auto; }
  .fan-modal-box { background:#16212e; border:1px solid #2a3a4a; border-radius:14px; padding:14px; width:min(100%, 560px); color:#fff; }
  .fan-modal-head { display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:10px; font-size:16px; }
  .fan-input, .fan-select { background:#0f1923; border:1px solid #4a5a6a; border-radius:10px; color:#fff; padding:8px 12px; font-size:16px; font-family:inherit; }
  .fan-modal-box .fan-input { width:100%; }
  .fan-picker-list { display:flex; flex-direction:column; gap:4px; max-height:60vh; overflow-y:auto; }
  .fan-pick { display:flex; align-items:center; gap:10px; padding:9px 10px; background:#0f1923; border:1px solid #22303f; border-radius:10px; cursor:pointer; }
  .fan-pick.on { border-color:#dfaf4a; background:#2a2410; }
  .fan-star { font-size:20px; width:24px; text-align:center; color:#dfaf4a; }
  .fan-pick-main { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .fan-pick-tag { font-size:11px; padding:2px 8px; border-radius:10px; white-space:nowrap; }
  .fan-pick-tag.mag { background:#12233d; color:#7ab8ff; } .fan-pick-tag.wag { background:#331330; color:#ff8ad6; }
  .fan-guide { display:flex; flex-direction:column; gap:10px; font-size:14px; line-height:1.7; }
  .fan-guide-formula { text-align:center; font-size:18px; font-weight:800; background:#0f1923; border-radius:10px; padding:10px; }
  .fan-guide-item { background:#0f1923; border-radius:10px; padding:10px 12px; }
  .fan-guide-item .g-h { font-weight:800; margin-bottom:2px; }
  .fan-guide-eg { display:inline-block; margin-top:4px; font-size:13px; color:#c5d0da; background:#1a2634; border-radius:8px; padding:4px 8px; }
  .g-d { color:#df9f4a; } .g-e { color:#4a9eff; } .g-nd { color:#ff8888; } .g-b { color:#88ff88; }
  .fan-finder { display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding:10px 16px; background:#111d2a; border-bottom:1px solid #2a3a4a; }
  .fan-finder-label { font-size:14px; }
  .fan-finder .fan-select, .fan-finder .fan-input { font-size:14px; padding:6px 10px; }
  .fan-finder .fan-q { flex:1; min-width:160px; max-width:320px; }
  .fan-guide-btn { margin-left:auto; padding:6px 14px; background:#1a2a3e; border:1px solid #4a9eff; border-radius:8px; color:#9cc8ff; font-size:13px; cursor:pointer; font-family:inherit; white-space:nowrap; }
  .fan-guide-btn + .badge { margin-left:0 !important; }
  @media (max-width: 640px) {
    .fan-area { padding:8px 10px 0; }
    .fan-cards { grid-template-columns:1fr; }
    .fan-chips { grid-template-columns:repeat(3, 1fr); }
    .fan-ticker li { grid-template-columns:52px 1fr auto; }
    .fan-ticker li .fan-t-name { grid-column:2 / 4; grid-row:2; }
    .fan-ticker li .fan-t-score { grid-column:3; grid-row:1; }
    .fan-finder { padding:8px 10px; }
    .fan-finder .fan-select { flex:1; min-width:0; }
    .fan-finder .fan-q { max-width:none; flex-basis:100%; }
    .nav .badge { display:none; }
  }
  @media print { .fan-area, .fan-finder, #fan-toasts, #fan-modal, .fan-guide-btn { display:none !important; } }
  `;
  function injectCss() {
    if (document.getElementById('fan-css')) return;
    const st = document.createElement('style');
    st.id = 'fan-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  // ═════════════ 公開API ═════════════
  function safe(fn) { return function () { try { return fn.apply(null, arguments); } catch (e) { console.error('[fan]', e); } }; }
  window.Fan = {
    // mount: フォロー欄・速報欄を描く要素。opts: { follow:true, ticker:true }
    init: safe(function (mount, opts) {
      injectCss();
      mountEl = mount || null;
      if (mountEl) mountEl.classList.add('fan-area');
      options = Object.assign({ follow: true, ticker: true }, opts || {});
      render();
    }),
    // 各ページのWebSocket受信（INIT／STATE_UPDATE）のたびに呼ぶ
    update: safe(function (newState) {
      injectCss();
      state = newState || {};
      rows = buildMergedRows(state);
      // 名簿で名前・所属が直っていれば、フォロー中の表示名も更新する
      let changed = false;
      follows.forEach(f => {
        const a = (state.roster || []).find(x => athleteId(x.gender, x.bib, x.category) === f.id);
        if (a && (a.name !== f.name || (a.club || '') !== f.club)) { f.name = a.name; f.club = a.club || ''; changed = true; }
      });
      if (changed) lsSet(LS_FOLLOWS, follows);
      notifyChanges();
      render();
      refreshClubs();
      if (document.getElementById('fan-picker-list')) renderPickerList();
      if (detailOpen && document.getElementById('fan-modal')?.dataset.kind === 'detail') renderDetail();
    }),
    openPicker: safe(openPicker),
    openGuide: safe(function () { injectCss(); openGuide(); }),
    closeModal: safe(closeModal),
    toggleTicker: safe(function () { tickerOpen = !tickerOpen; lsSet(LS_TICKER_OPEN, tickerOpen); render(); }),
    // フォロー選手の種目チップをタップ → 内訳ポップアップ
    openDetail: safe(function (fidEnc, code) { injectCss(); detailOpen = { fid: decodeURIComponent(fidEnc), code }; renderDetail(); }),
    detailTab: safe(function (code) { if (detailOpen) { detailOpen.code = code; renderDetail(); } }),
    mountFinder: safe(function (el, onChange) { injectCss(); mountFinder(el, onChange); }),
    finderMatch: function (athlete) { try { return finderMatch(athlete); } catch (e) { return true; } },
    finderActive: function () { try { return finderActive(); } catch (e) { return false; } },
  };
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
})();
