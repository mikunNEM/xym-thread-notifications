const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const { pubkey, email, line_user_id } = req.body;

  const { error } = await supabase
    .from('user_notifications')
    .upsert({ pubkey, email, line_user_id, updated_at: new Date().toISOString() });

  res.status(error ? 500 : 200).json(error || { success: true });
};
