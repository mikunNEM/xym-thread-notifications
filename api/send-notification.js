// api/send-notification.js
const { createClient } = require('@supabase/supabase-js');

// タイポ修正 + require
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY  // ← processabase → process.env
);

// Vercel Serverless 対応
module.exports = async (req, res) => {
  // CORSヘッダー
  res.setHeader('Access-Control-Allow-Origin', 'https://xym-thread.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // OPTIONS対応
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // POST以外拒否
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  try {
    const { txHash, message, senderPubkey, threadOwnerPubkey } = req.body;

    // 必須チェック
    if (!txHash || !message || !senderPubkey || !threadOwnerPubkey) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // オーナーのLINE ID取得
    const { data: user, error } = await supabase
      .from('user_notifications')
      .select('line_user_id')
      .eq('pubkey', threadOwnerPubkey)
      .single();

    if (error || !user?.line_user_id) {
      console.log('No LINE ID for owner:', threadOwnerPubkey);
      return res.status(200).json({ ok: true }); // 通知なしでも成功
    }

    const title = '新着コメント！';
    const body = `Threadにコメント: ${message}\n送信者: ${senderPubkey.slice(0, 8)}...`;
    const link = `https://xym-thread.com/thread.html?id=${txHash}`;

    // LINE送信
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: user.line_user_id,
        messages: [{
          type: 'text',
          text: `${title}\n${body}\n${link}`
        }]
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('LINE API error:', err);
      return res.status(500).json({ error: 'LINE send failed' });
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Notification error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};