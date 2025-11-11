const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const { hash, owner_pubkey } = req.body;

  const { error } = await supabase
    .from('threads')
    .upsert({ hash, owner_pubkey, created_at: new Date().toISOString() });

  res.status(error ? 500 : 200).json(error || { success: true });
};
