/**
 * BizForm 丈量預約單專用 — 建立新文件後自動同步客戶資料進 CRM
 *
 * Render 環境變數：
 *   BIZFORM_JWT       您的個人 JWT（含或不含開頭的 "Bearer " 都可以）
 *   BIZFORM_DEPOT_ID  丈量預約單所在站台的 depotId
 *   BIZFORM_FORM_ID   （選填）丈量預約單的表單 id，預設 16
 *
 * BizForm > Webhooks 只需要「一筆」設定：
 *   trigger = DocumentCreated
 *   url     = https://<你的 Render 網址>/bizform-webhook
 *   適用樣板 = 丈量預約單範本
 *
 * 注意：CRM 匯入這支 API 不支援 x-api-key，必須用個人 JWT。
 */

const express = require('express');
const app = express();
app.use(express.json());

const BIZFORM_BASE = 'https://bizform.vitalyun.com/backend/api';

const CRM_JWT = process.env.BIZFORM_JWT;
const DEPOT_ID = process.env.BIZFORM_DEPOT_ID;
const MEASUREMENT_FORM_ID = String(process.env.BIZFORM_FORM_ID || '16'); // 丈量預約單範本

// 從 webhook 內容找出表單 id（不同版本欄位名稱可能不同，都試試看）
function getFormId(body) {
  const id =
    body.formId ??
    body.FormId ??
    body.form?.id ??
    body.form?.Id ??
    body.document?.formId ??
    null;
  return id == null ? null : String(id);
}

function getDocumentId(body) {
  return body.documentId ?? body.DocumentId ?? body.document?.id ?? body.id ?? null;
}

async function syncToCrm(documentId) {
  const url = `${BIZFORM_BASE}/Documents/${documentId}/crmItems?version=0`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: CRM_JWT.startsWith('Bearer') ? CRM_JWT : `Bearer ${CRM_JWT}`,
      depotId: DEPOT_ID,
      accept: 'application/json',
    },
  });
  const text = await res.text();
  if (!res.ok) {
    let hint = '';
    if (res.status === 401) hint = '（JWT 可能已過期，請重新取得並更新 Render 環境變數 BIZFORM_JWT）';
    if (res.status === 400) hint = '（常見原因：表單的 CRM 欄位對應不完整，或 CRM 欄位被改名/刪除）';
    if (res.status === 403) hint = '（帳號沒有此站台或 CRM 的權限，或 depotId 錯誤）';
    throw new Error(`CRM 同步失敗：HTTP ${res.status} ${hint} 回應內容：${text}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// 健康檢查：用瀏覽器打開 Render 網址就能確認服務有沒有活著
app.get('/', (req, res) => {
  res.send('丈量預約單 → CRM webhook 運作中');
});

app.post('/bizform-webhook', async (req, res) => {
  // 把 BizForm 傳來的完整內容印到 Render Logs，方便除錯
  console.log('收到 webhook：', JSON.stringify(req.body));

  try {
    if (!CRM_JWT || !DEPOT_ID) {
      return res.status(500).json({ error: '尚未設定 BIZFORM_JWT 或 BIZFORM_DEPOT_ID' });
    }

    // 只處理丈量預約單；若 webhook 有帶表單 id 且不是丈量預約單，直接略過
    const formId = getFormId(req.body);
    if (formId && formId !== MEASUREMENT_FORM_ID) {
      console.log(`略過：表單 id ${formId} 不是丈量預約單（${MEASUREMENT_FORM_ID}）`);
      return res.status(200).json({ ok: true, skipped: true, formId });
    }

    const documentId = getDocumentId(req.body);
    if (!documentId) {
      console.error('找不到 documentId，請把上面「收到 webhook」那行貼給我檢查欄位名稱');
      return res.status(400).json({ error: 'missing documentId' });
    }

    const crmResult = await syncToCrm(documentId);
    console.log(`同步成功：documentId=${documentId}`, JSON.stringify(crmResult));
    res.status(200).json({ ok: true, documentId, crm: crmResult });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Webhook receiver listening on :${PORT}`));
