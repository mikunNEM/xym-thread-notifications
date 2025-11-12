// api/line-register.js
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const LIFF_ID = process.env.LIFF_ID; // LINE Login チャネルのLIFF ID

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LINE通知登録</title>
  <script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
  <style>
    body { font-family: sans-serif; text-align: center; padding: 50px; }
    #qrcode { margin: 30px 0; }
    #status { margin-top: 20px; font-weight: bold; }
  </style>
</head>
<body>
  <h2>LINE通知登録</h2>
  <p>QRコードをLINEでスキャンして登録してください</p>
  <div id="qrcode"></div>
  <p id="status">読み込み中...</p>

  <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.0/build/qrcode.min.js"></script>
  <script>
    const liffUrl = 'https://liff.line.me/${LIFF_ID}';
    QRCode.toCanvas(document.getElementById('qrcode'), liffUrl, { width: 200 });

    liff.init({ liffId: '${LIFF_ID}' })
      .then(() => {
        if (!liff.isLoggedIn()) {
          document.getElementById('status').innerText = 'LINEログインが必要です';
          liff.login();
        } else {
          const profile = liff.getProfile();
          const userId = liff.getContext().userId;
          const pubkey = new URLSearchParams(window.location.search).get('pubkey') || prompt('公開鍵 (64文字):');

          if (!pubkey || pubkey.length !== 64) {
            document.getElementById('status').innerText = '公開鍵を入力してください';
            return;
          }

          fetch('https://xym-thread-notifications.vercel.app/api/save-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pubkey, line_user_id: userId })
          })
          .then(r => r.json())
          .then(data => {
            document.getElementById('status').innerHTML = 
              data.success ? '登録完了！LINE通知が届きます' : 'エラー: ' + data.error;
          });
        }
      })
      .catch(err => {
        document.getElementById('status').innerText = 'エラー: ' + err;
      });
  </script>
</body>
</html>
  `;

  res.status(200).send(html);
};