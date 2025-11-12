// api/monitor-poll.js
let lastCheckedHeight = 0;
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// 🧩 新スレッド投稿専用アドレス
const THREAD_POST_ADDRESS = 'NB2TFCNBOXNG6FU2JZ7IA3SLYOYZ24BBZAUPAOA';

module.exports = async (req, res) => {
  // --- CORS ---
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // --- タイムアウト設定（15秒）---
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  const NODE = await getAvailableNode();
  if (!NODE) {
    clearTimeout(timeoutId);
    return res.status(200).json({ status: 'node unavailable', checked: lastCheckedHeight });
  }

  try {
    // --- チェーン高さ取得 ---
    const infoRes = await fetch(`${NODE}/chain/info`, { signal: controller.signal });
    if (!infoRes.ok) throw new Error('Chain info failed');
    const { height: currentHeight } = await infoRes.json();
    clearTimeout(timeoutId);

    if (currentHeight <= lastCheckedHeight) {
      return res.status(200).json({ status: 'no new blocks', checked: currentHeight });
    }

    // --- 最新10件取得 ---
    const params = new URLSearchParams({
      pageSize: '10',
      order: 'desc'
    });
    const txUrl = `${NODE}/transactions/confirmed?${params}`;
    console.log('🔍 Fetching:', txUrl);

    const txRes = await fetch(txUrl, { signal: controller.signal });
    if (!txRes.ok) throw new Error(`Tx fetch failed: ${await txRes.text()}`);
    const { data: txs } = await txRes.json();

    if (!txs || txs.length === 0) {
      return res.status(200).json({ status: 'no txs found', checked: currentHeight });
    }

    const promises = txs
      .filter(tx => tx.meta.height > lastCheckedHeight && tx.transaction.message)
      .map(async (tx) => {
        const fullHash = tx.meta.hash;
        const shortHash = fullHash.substring(0, 5);
        const message = hexToUtf8(tx.transaction.message).trim();
        const senderPubkey = tx.transaction.signerPublicKey;
        const recipient = tx.transaction.recipientAddress;

        if (!message) return;
        if (await isAlreadyNotified(fullHash)) return; // 重複通知防止

        try {
          // === 🆕 新スレッド ===
          if (recipient === THREAD_POST_ADDRESS && !message.startsWith('#')) {
            console.log('🆕 新スレッド:', message);
            await supabase.from('threads').upsert({
              hash: shortHash,
              full_hash: fullHash,
              owner_pubkey: senderPubkey,
              title: message,
            }, { onConflict: 'hash' });

            await notifyAllUsersNewThread(message, fullHash);
            await markAsNotified(fullHash, 'thread');
          }

          // === 💬 コメント ===
          else if (message.startsWith('#') && message.length > 7) {
            const tag = message.split(' ')[0]; // 例: "#A1234"
            const shortTargetHash = tag.substring(1, 6); // A1234
            const comment = message.slice(tag.length + 1).trim();

            // 対応するスレッドを探す
            const { data: thread } = await supabase
              .from('threads')
              .select('owner_pubkey, full_hash, title')
              .eq('hash', shortTargetHash)
              .single();

            if (thread) {
              console.log(`💬 コメント検出: ${comment}`);
              await supabase.from('thread_comments').upsert({
                thread_hash: shortTargetHash,
                sender_pubkey: senderPubkey
              }, { onConflict: 'thread_hash,sender_pubkey' });

              await notifyThreadParticipants(thread.owner_pubkey, thread.full_hash, thread.title, comment, senderPubkey);
              await markAsNotified(fullHash, 'comment');
            }
          }
        } catch (err) {
          console.error('Process tx error:', err);
        }
      });

    await Promise.all(promises);
    lastCheckedHeight = currentHeight;

    res.status(200).json({ status: 'success', checked: currentHeight });
  } catch (error) {
    clearTimeout(timeoutId);
    console.error('Monitor error:', error);
    res.status(200).json({ status: 'error', error: error.message, checked: lastCheckedHeight });
  }
};

// === 🔔 通知関数 ===

// 🆕 新スレッド通知（タイトル＋リンク付き）
async function notifyAllUsersNewThread(title, fullHash) {
  const { data: users } = await supabase.from('user_notifications').select('line_user_id');
  const link = `https://xym-thread.com/thread.html?id=${fullHash}`;
  const message = `🆕 新しいスレッドが投稿されました！\n「${title}」\n👉 ${link}`;
  await Promise.all(
    (users || []).map(u => u.line_user_id && sendLine(u.line_user_id, message))
  );
}

// 💬 コメント通知（スレッドタイトル＋コメント＋リンク付き）
async function notifyThreadParticipants(ownerPubkey, fullHash, title, comment, senderPubkey) {
  const shortHash = fullHash.substring(0, 5);
  const { data: commenters } = await supabase
    .from('thread_comments')
    .select('sender_pubkey')
    .eq('thread_hash', shortHash);

  const pubkeys = [ownerPubkey, senderPubkey, ...(commenters?.map(c => c.sender_pubkey) || [])];
  const uniquePubkeys = [...new Set(pubkeys)];

  const link = `https://xym-thread.com/thread.html?id=${fullHash}`;
  const message = `💬 「${title}」に新しいコメントが届きました！\n「${comment}」\n👉 ${link}`;

  await Promise.all(
    uniquePubkeys.map(async (pubkey) => {
      const { data: user } = await supabase
        .from('user_notifications')
        .select('line_user_id')
        .eq('pubkey', pubkey)
        .single();
      if (user?.line_user_id) {
        await sendLine(user.line_user_id, message);
      }
    })
  );
}

// === LINE通知送信 ===
async function sendLine(to, text) {
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to,
        messages: [{ type: 'text', text }]
      })
    });
    if (!res.ok) console.error('LINE送信失敗:', await res.text());
  } catch (err) {
    console.error('LINE送信エラー:', err);
  }
}

// === 🧠 通知履歴管理 ===
async function isAlreadyNotified(fullHash) {
  const { data } = await supabase
    .from('notified_txs')
    .select('tx_hash')
    .eq('tx_hash', fullHash)
    .maybeSingle();
  return !!data;
}

async function markAsNotified(fullHash, type) {
  await supabase.from('notified_txs').upsert({
    tx_hash: fullHash,
    type,
    notified_at: new Date().toISOString()
  });
}

// === 🌐 ノード選択 ===
async function getAvailableNode() {
  const fixedNode = 'https://symbol-mikun.net:3001';
  const NodesUrl = 'https://mainnet.dusanjp.com:3004/nodes?filter=suggested&limit=1000&ssl=true';

  try {
    const response = await fetch(NodesUrl);
    const data = await response.json();

    if (data && data.length > 0) {
      let availableNodes = data.filter(node => node.hostDetail?.country === "Japan");
      if (availableNodes.length === 0) availableNodes = data;

      availableNodes.sort((a, b) => b.apiStatus.chainHeight - a.apiStatus.chainHeight);
      const selectedNode = availableNodes[0].apiStatus.restGatewayUrl;
      console.log("🟢 使用ノード:", selectedNode);
      return selectedNode;
    }
  } catch (error) {
    console.error("ノードリスト取得失敗:", error);
  }

  try {
    const response = await fetch(`${fixedNode}/node/health`);
    const healthData = await response.json();
    if (healthData?.status?.apiNode === 'up') return fixedNode;
  } catch {
    console.error("固定ノードも利用不可");
  }

  return null;
}

// === HEX→UTF8 ===
function hexToUtf8(hex) {
  try {
    const bytes = new Uint8Array(hex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return '';
  }
}
