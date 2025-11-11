// api/save-user.js
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

module.exports = async (req, res) => {
  // CORSヘッダー追加
  res.setHeader('Access-Control-Allow-Origin', 'https://xym-thread.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // OPTIONS リクエスト（プリフライト）対応
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') return res.status(405).end();

  const { pubkey, line_user_id } = req.body;

  const { error } = await supabase
    .from('user_notifications')
    .upsert({ pubkey, line_user_id, updated_at: new Date().toISOString() });

  res.status(error ? 500 : 200).json(error || { success: true });
};