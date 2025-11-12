// api/save-user.js
const { createClient } = require('@supabase/supabase-js');

// Vercel Serverless Functions 用：module.exports に変更！
module.exports = async (req, res) => {
  // CORSヘッダー
  res.setHeader('Access-Control-Allow-Origin', 'https://xym-thread.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // OPTIONS（プリフライトリクエスト）対応
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // POST以外は拒否
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { pubkey, line_user_id } = req.body;

    // 必須項目チェック
    if (!pubkey || !line_user_id) {
      return res.status(400).json({ error: 'pubkey and line_user_id required' });
    }

    // Supabaseクライアント作成
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    // 接続テスト（任意だが安全）
    const { error: testError } = await supabase
      .from('user_notifications')
      .select('pubkey')
      .limit(1);

    if (testError) {
      console.error('Supabase connection error:', testError);
      return res.status(500).json({ 
        error: 'Supabase connection failed', 
        details: testError.message 
      });
    }

    // 登録（pubkey で上書き）
    const { error } = await supabase
      .from('user_notifications')
      .upsert(
        { pubkey, line_user_id, updated_at: new Date().toISOString() },
        { onConflict: 'pubkey' }
      );

    if (error) {
      console.error('Upsert error:', error);
      return res.status(500).json({ 
        error: 'DB insert failed', 
        details: error.message 
      });
    }

    // 成功！
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ 
      error: 'Server error', 
      details: err.message 
    });
  }
};