// api/line-register.js
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const LIFF_ID = process.env.LIFF_ID;
  if (!LIFF_ID) {
    return res.status(500).send('LIFF_ID not set');
  }

  const html = `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LINE通知登録 - XYM Thread</title>
  <script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; text-align: center; padding: 40px 20px; background: #f7f7f7; color: #333; }
    .container { max-width: 400px; margin: 0 auto; background: white; padding: 30px; border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
    h2 { color: #00B900; margin-bottom: 20px; }
    #qrcode { margin: 30px auto; padding: 15px; background: #fff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    #status { margin-top: 25px; font-weight: bold; min-height: 24px; }
    .loading { color: #666; }
    .success { color: #00B900; }
    .error { color: #d32f2f; }
    .pubkey-input { margin-top: 20px; display: none; }
    .pubkey-input input { width: 100%; padding: 10px; font-size: 16px; border: 1px solid #ddd; border-radius: 8px; text-align: center; }
    canvas { display: block; margin: 0 auto; }
  </style>
</head>
<body>
  <div class="container">
    <h2>LINE通知登録</h2>
    <p>以下のQRコードを<br><strong>LINEアプリでスキャン</strong>してください</p>
    <canvas id="qrcode" width="200" height="200"></canvas>
    <p id="status" class="loading">読み込み中...</p>
    <div class="pubkey-input" id="pubkeyInput">
      <input type="text" placeholder="Symbol公開鍵（64文字）を入力" id="pubkeyField" maxlength="64">
    </div>
  </div>

  <script>
    // QRコード生成（canvas 直接）
    const liffUrl = 'https://liff.line.me/${LIFF_ID}';
    QRCode.toCanvas(document.getElementById('qrcode'), liffUrl, {
      width: 200,
      margin: 2,
      color: { dark: '#00B900', light: '#ffffff' }
    }).catch(err => {
      console.error('QRCode error:', err);
      document.getElementById('status').innerHTML = '<span class="error">QRコード生成エラー</span>';
    });

    // LIFF初期化
    liff.init({ liffId: '${LIFF_ID}' })
      .then(async () => {
        const statusEl = document.getElementById('status');
        const pubkeyInput = document.getElementById('pubkeyInput');
        const pubkeyField = document.getElementById('pubkeyField');

        // URLから公開鍵取得
        const urlParams = new URLSearchParams(window.location.search);
        const urlPubkey = urlParams.get('pubkey');

        if (!liff.isLoggedIn()) {
          statusEl.innerHTML = 'LINEログインが必要です...<br><small>ログイン後、再度お試しください</small>';
          liff.login();
          return;
        }

        // User ID取得
        const context = liff.getContext();
        if (!context || !context.userId) {
          statusEl.innerHTML = '<span class="error">User ID取得失敗</span>';
          return;
        }

        const userId = context.userId;
        statusEl.innerHTML = 'User ID取得完了！<br>公開鍵を入力してください';

        // 公開鍵入力 or URLから取得
        let pubkey = urlPubkey;
        if (!pubkey || pubkey.length !== 64 || !/^[0-9A-Fa-f]{64}$/.test(pubkey)) {
          pubkeyInput.style.display = 'block';
          pubkeyField.focus();
          statusEl.innerHTML = '公開鍵を入力してください（64文字の16進数）';

          // Enterキー対応
          pubkeyField.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') register(pubkeyField.value.trim());
          });
          return;
        }

        // 自動登録
        await register(pubkey);
      })
      .catch(err => {
        console.error('LIFF init error:', err);
        document.getElementById('status').innerHTML = 
          '<span class="error">LIFFエラー: ' + (err.message || err.code || err) + '</span>';
      });

    // 登録処理
    async function register(pubkey) {
      const statusEl = document.getElementById('status');
      if (!pubkey || pubkey.length !== 64 || !/^[0-9A-Fa-f]{64}$/.test(pubkey)) {
        statusEl.innerHTML = '<span class="error">無効な公開鍵です（64文字の16進数）</span>';
        return;
      }

      statusEl.innerHTML = '登録中...';
      try {
        const response = await fetch('https://xym-thread-notifications.vercel.app/api/save-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pubkey, line_user_id: liff.getContext().userId })
        });
        const data = await response.json();

        if (data.success) {
          statusEl.innerHTML = '<span class="success">登録完了！<br>LINE通知が届きます</span>';
          // 5秒後に閉じる
          setTimeout(() => window.close(), 5000);
        } else {
          statusEl.innerHTML = '<span class="error">登録失敗: ' + (data.error || '不明なエラー') + '</span>';
        }
      } catch (err) {
        console.error('Register error:', err);
        statusEl.innerHTML = '<span class="error">通信エラー</span>';
      }
    }
  </script>
</body>
</html>
  `;

  res.status(200).send(html);
};