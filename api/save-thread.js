// api/save-thread.js
import { createClient } from '@supabase/supabase-js';

// Supabaseクライアント初期化
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  // --- CORS設定 ---
  res.setHeader('Access-Control-Allow-Origin', 'https://xym-thread.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { title, owner_pubkey, full_hash } = await req.json?.() || req.body;

    // --- 必須項目チェック ---
    if (!title || !owner_pubkey || !full_hash) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // --- 短縮ハッシュ生成（UI用）---
    const short_hash = full_hash.substring(0, 5);

    // --- データ挿入（毎回新規レコード追加）---
    const { data, error } = await supabase
      .from('threads')
      .insert({
        title,
        owner_pubkey,
        full_hash,
        hash: short_hash,
        created_at: new Date().toISOString(),
      });

    if (error) {
      console.error('save-thread error:', error);
      return res.status(500).json({
        error: 'Database insert failed',
        details: error.message,
      });
    }

    // --- 正常終了 ---
    res.status(200).json({ success: true, data });
  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({
      error: 'Server error',
      details: err.message,
    });
  }
}
