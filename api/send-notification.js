const sgMail = require('@sendgrid/mail');
const { createClient } = require('@supabase/supabase-js');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const { txHash, message, senderPubkey, threadOwnerPubkey } = req.body;

  const { data: user } = await supabase
    .from('user_notifications')
    .select('email, line_user_id')
    .eq('pubkey', threadOwnerPubkey)
    .single();

  if (!user) return res.status(200).json({ ok: true });

  const title = '新着コメント！';
  const body = `Threadにコメント: ${message} (送信者: ${senderPubkey.slice(0,8)}...)`;
  const link = `https://xym-thread.com/thread.html?id=${txHash}`;

  if (user.email) {
    await sgMail.send({
      to: user.email,
      from: 'noreply@xym-thread.com',
      subject: title,
      html: `<p>${body}</p><a href="${link}">詳細を見る</a>`,
    });
  }

  if (user.line_user_id) {
    await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: user.line_user_id,
        messages: [{ type: 'text', text: `${title}\n${body}\n${link}` }]
      }),
    });
  }

  res.status(200).json({ ok: true });
};
