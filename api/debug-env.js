// api/debug-env.js
export default function handler(req, res) {
  res.status(200).json({
    SUPABASE_URL: process.env.SUPABASE_URL || "MISSING",
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ? "[SET]" : "MISSING",
    LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN ? "[SET]" : "MISSING",
    hasSupabase: !!process.env.SUPABASE_URL && !!process.env.SUPABASE_ANON_KEY
  });
}
