/**
 * 婚禮相簿自動備份 — Google Apps Script
 *
 * 跑在 Google 的伺服器上，用「你自己的帳號」身分執行，所以：
 *   • 不需要 MacBook 開機
 *   • 有你的儲存空間配額（服務帳號沒有，這是本機腳本必須存在的原因）
 *
 * 安裝方式見同資料夾的 README.md
 */

// ── 設定 ────────────────────────────────────────────────────────
var SOURCE = {
  photos: '1ggOmccx-b5_JSDdfjRDcVHTRTkPQHo_w',
  videos: '1TU-h59Ivg6GAIuv58zfhXz1ykupI-f6X',
};
var BACKUP_FOLDER_ID = '1IJsox9j7uMzKqWiZFRuJ2R24FfjqXerT';   // 個人雲端硬碟「備份相本」
var SITE = 'https://wedding-album-mu.vercel.app';

// Apps Script 單次執行上限 6 分鐘；留餘裕收尾，未完成的部分下次接續。
var TIME_BUDGET_MS = 4.5 * 60 * 1000;

// ── 主流程 ──────────────────────────────────────────────────────
function backupAll() {
  var started = Date.now();
  var copied = backupMedia(started);
  backupMessages();
  Logger.log('本次複製 ' + copied + ' 個檔案');
}

// ── 媒體：共用雲端硬碟 → 個人雲端硬碟（增量） ────────────────────
function backupMedia(started) {
  var root = DriveApp.getFolderById(BACKUP_FOLDER_ID);
  var copied = 0;

  Object.keys(SOURCE).forEach(function (kind) {
    if (Date.now() - started > TIME_BUDGET_MS) return;

    var dest = getOrCreateFolder(root, kind);

    // 已備份的檔案：以「檔名 + 大小」判斷，重複執行不會重複複製
    var have = {};
    var existing = dest.getFiles();
    while (existing.hasNext()) {
      var e = existing.next();
      have[e.getName()] = e.getSize();
    }

    var src = DriveApp.getFolderById(SOURCE[kind]).getFiles();
    while (src.hasNext()) {
      // 超時就停手，下一次排程會接著做沒完成的部分
      if (Date.now() - started > TIME_BUDGET_MS) {
        Logger.log('接近執行時間上限，剩下的下次繼續');
        return;
      }
      var f = src.next();
      if (have[f.getName()] === f.getSize()) continue;
      try {
        f.makeCopy(f.getName(), dest);
        copied++;
      } catch (err) {
        Logger.log('複製失敗 ' + f.getName() + '：' + err);
      }
    }
  });

  return copied;
}

// ── 祝福文字 ────────────────────────────────────────────────────
function backupMessages() {
  var res = UrlFetchApp.fetch(SITE + '/api/messages', {
    // 管理端採網址保密制，這個 cookie 就是它的憑證
    headers: { Cookie: 'admin_session=1' },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    Logger.log('取得祝福失敗：HTTP ' + res.getResponseCode());
    return;
  }
  var data = JSON.parse(res.getContentText());
  if (!data.success) {
    Logger.log('取得祝福失敗：' + data.error);
    return;
  }

  var list = data.data.slice().sort(function (a, b) {
    return a.createdAt < b.createdAt ? -1 : 1;
  });

  var lines = [
    '════════════════════════════════════',
    '        婚禮祝福文字備份',
    '        匯出時間：' + fmt(new Date().toISOString()),
    '        共 ' + list.length + ' 則祝福',
    '════════════════════════════════════',
    '',
  ];
  list.forEach(function (m) {
    var note = m.status !== 'active'
      ? '（已' + (m.status === 'hidden' ? '隱藏' : '刪除') + '）'
      : '';
    lines.push('【' + fmt(m.createdAt) + '】' + m.guestName + note);
    lines.push('  ' + m.message);
    lines.push('');
  });

  // 覆蓋同名檔案，不要每次備份都多留一份舊的
  var root = DriveApp.getFolderById(BACKUP_FOLDER_ID);
  var name = '祝福文字備份.txt';
  var old = root.getFilesByName(name);
  while (old.hasNext()) old.next().setTrashed(true);
  root.createFile(name, lines.join('\n'), MimeType.PLAIN_TEXT);

  Logger.log('祝福已備份：' + list.length + ' 則');
}

// ── 小工具 ──────────────────────────────────────────────────────
function getOrCreateFolder(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function fmt(iso) {
  return Utilities.formatDate(new Date(iso), 'Asia/Taipei', 'yyyy/MM/dd HH:mm');
}

// ── 一次性：建立每小時排程 ──────────────────────────────────────
function setupHourlyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'backupAll') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('backupAll').timeBased().everyHours(1).create();
  Logger.log('已建立每小時自動備份');
}
