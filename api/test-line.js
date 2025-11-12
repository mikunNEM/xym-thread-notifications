// api/test-line.js（修正版）
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const { data: users } = await supabase.from('user_notifications').select('line_user_id');
    if (!users || users.length === 0) {
      return res.status(200).json({ error: 'No users registered' });
    }

    const testText = 'XYM Thread テスト通知！\nhttps://xym-thread.com';
    let sent = 0;
    const errors = [];

    for (const user of users) {
      if (user.line_user_id) {
        try {
          console.log('Sending to LINE User ID:', user.line_user_id); // ログ追加

          const response = await fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              to: user.line_user_id,
              messages: [{ type: 'text', text: testText }]
            })
          });

          if (response.ok) {
            sent++;
            console.log('LINE sent successfully');
          } else {
            const errText = await response.text();
            console.error('LINE API Error:', response.status, errText);
            errors.push({ user: user.line_user_id, status: response.status, error: errText });
          }
        } catch (err) {
          console.error('LINE fetch error:', err.message);
          errors.push({ user: user.line_user_id, error: err.message });
        }
      }
    }

    res.status(200).json({ sent, total: users.length, errors });
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: err.message });
  }
};