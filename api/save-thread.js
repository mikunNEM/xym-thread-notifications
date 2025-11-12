// api/save-thread.js
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    // 🧩 bodyが文字列のときも対応
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const { hash, owner_pubkey, title } = body;

    if (!hash || !owner_pubkey || !title) {
      console.error('❌ Missing fields:', body);
      return res.status(400).json({ error: 'Missing fields' });
    }

    const shortHash = hash.substring(0, 5);
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
      console.error('Supabase error:', error);
      return res.status(500).json({ error: 'DB error', details: error.message });
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('🚨 JSON parse error:', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
};
