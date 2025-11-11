// api/send-notification.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, processabase.SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { txHash, message, senderPubkey, threadOwnerPubkey } = req.body;

  const { data: user } = await supabase
    .from('user_notifications')
    .select('line_user_id')
    .eq('pubkey', threadOwnerPubkey)
    .single();

  if (!user?.line_user_id) return res.status(200).json({ ok: true });

  const title = '新着コメント！';
  const body = `Threadにコメント: ${message} (送信者: ${senderPubkey.slice(0,8)}...)`;
  const link = `https://xym-thread.com/thread.html?id=${txHash}`;

  // LINE Messaging API のみ
  await fetch('https://api.line.me/v2/bot/message/push', {
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

  res.status(200).json({ ok: true });
}