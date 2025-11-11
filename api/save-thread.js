// api/save-thread.js
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

module.exports = async (req, res) => {
  // CORSヘッダー
  res.setHeader('Access-Control-Allow-Origin', 'https://xym-thread.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') return res.status(405).end();

  const { hash, owner_pubkey, title } = req.body;
  const shortHash = hash.substring(0, 5);

  const { error } = await supabase.from('threads').upsert({
    hash: shortHash,
    full_hash: hash,
    owner_pubkey,
    title
  });

  res.status(error ? 500 : 200).json(error || { success: true });
};