// api/save-thread.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { hash, owner_pubkey, title } = await req.json?.() || req.body;
    if (!hash || !owner_pubkey || !title) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const { error } = await supabase.from('threads').upsert({
      hash: hash.substring(0, 5),
      full_hash: hash,
      owner_pubkey,
      title
    }, { onConflict: 'hash' });

    if (error) throw error;

    res.status(200).json({ status: 'ok', hash });
  } catch (err) {
    console.error('save-thread error:', err);
    res.status(500).json({ error: err.message });
  }
}
