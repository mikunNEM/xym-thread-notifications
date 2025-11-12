// api/save-comment.js
import { createClient } from '@supabase/supabase-js';

// Supabaseクライアント初期化
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  // CORS設定
  res.setHeader('Access-Control-Allow-Origin', 'https://xym-thread.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { thread_hash, message, sender_pubkey, tx_hash } = await req.json?.() || req.body;

    // 入力チェック
    if (!thread_hash || !message || !sender_pubkey) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // 挿入処理（毎回新規レコードを追加）
    const { data, error } = await supabase
      .from('thread_comments')
      .insert({
        thread_hash,
        message,
        sender_pubkey,
        tx_hash: tx_hash || null,
        created_at: new Date().toISOString(),
      });

    if (error) {
      console.error('save-comment error:', error);
      return res.status(500).json({ error: 'Database insert failed', details: error.message });
    }

    res.status(200).json({ success: true, data });
  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
}
