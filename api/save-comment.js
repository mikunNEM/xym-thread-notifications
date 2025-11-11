const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const { thread_hash, sender_pubkey } = req.body;
  await supabase.from('thread_comments').upsert({
    thread_hash,
    sender_pubkey
  });
  res.status(200).json({ ok: true });
};
