// api/save-comment.js (ESM対応)
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { thread_hash, sender_pubkey } = await req.json?.() || req.body;
    if (!thread_hash || !sender_pubkey) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    // コメント登録
    const { error } = await supabase.from('thread_comments').upsert({
      thread_hash,
      sender_pubkey
    }, { onConflict: 'thread_hash,sender_pubkey' });

    if (error) throw error;

    res.status(200).json({ status: 'ok', thread_hash });
  } catch (err) {
    console.error('save-comment error:', err);
    res.status(500).json({ error: err.message });
  }
}
