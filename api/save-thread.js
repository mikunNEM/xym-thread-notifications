// api/save-thread.js
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  // CORSヘッダー（必須！）
  res.setHeader('Access-Control-Allow-Origin', 'https://xym-thread.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { hash, owner_pubkey, title } = req.body;
    const shortHash = hash.substring(0, 5);

    if (!hash || !owner_pubkey || !title) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const { error } = await supabase
      .from('threads')
      .upsert({
        hash: shortHash,
        full_hash: hash,
        owner_pubkey,
        title,
        created_at: new Date().toISOString()
      }, { onConflict: 'hash' });

    if (error) {
      console.error('Supabase upsert error:', error);
      return res.status(500).json({ error: 'DB error', details: error.message });
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
}