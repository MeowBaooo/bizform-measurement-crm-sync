/**
 * BizForm 多張表單通用版 — 建立新文件後自動同步客戶資料進 CRM
 * 適用表單：丈量預約單範本、追加工程單範本、進度回報單範本、
 *          驗收單範本、驗收缺失單範本、丈量結果單範本
 * （這幾張表單都屬於同一個站台，共用同一組 depotId）
 *
 * 使用方式：
 *   1. 環境變數 BIZFORM_JWT 放您的個人 JWT（含或不含開頭的 "Bearer " 都可以）
 *   2. 環境變數 BIZFORM_DEPOT_ID 放這些表單共用的站台 depotId
 *   3. BizForm > Webhooks，為「這6張表單各自」都新增一筆設定：
 *      trigger=DocumentCreated，url 都指向同一個 /bizform-webhook，
 *      適用樣板每一筆各選一張對應的表單（總共要建立6筆 Webhook 設定，
 *      但都指向同一個網址）
 *
 * 注意：CRM 匯入這支 API 不支援 x-api-key，必須用個人 JWT（見 account/token 取得方式）
 * 因為每一筆 Webhook 已經用「適用樣板」限定只會對正確的表單觸發，
 * 所以這支程式不需要再另外檢查 form.id，收到就直接同步。
 */

const express = require('express');
const app = express();
app.use(express.json());

const BIZFORM_BASE = 'https://bizform.vitalyun.com/backend/api';

const CRM_JWT = process.env.BIZFORM_JWT; // 例如 "Bearer eyJhbGci..."
const DEPOT_ID = process.env.BIZFORM_DEPOT_ID; // 這6張表單共用的 depotId

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
    throw new Error(`CRM sync failed: ${res.status} ${text}`);
  }
  return JSON.parse(text);
}

app.post('/bizform-webhook', async (req, res) => {
  try {
    if (!CRM_JWT || !DEPOT_ID) {
      return res.status(500).json({ error: '尚未設定 BIZFORM_JWT 或 BIZFORM_DEPOT_ID' });
    }

    const documentId = req.body.documentId || req.body.id;
    if (!documentId) return res.status(400).json({ error: 'missing documentId' });

    const crmResult = await syncToCrm(documentId);

    res.status(200).json({ ok: true, documentId, crm: crmResult });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Webhook receiver listening on :${PORT}`));
