let lastCheckedHeight = 0;
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

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
      address: 'NB2TFCNBOXNG6FU2JZ7IA3SLYOYZ24BBZAUPAOA',
      pageSize: '10',
      order: 'desc'
    });

    const txRes = await fetch(`${NODE}/transactions/confirmed?${params}`, { signal: controller.signal });
    if (!txRes.ok) throw new Error('Tx fetch failed');
    const { data: txs } = await txRes.json();

    // --- トランザクション処理 ---
    const promises = txs
      .filter(tx => tx.meta.height > lastCheckedHeight && tx.transaction.message)
      .map(async (tx) => {
        const fullHash = tx.meta.hash;
        const shortHash = fullHash.substring(0, 5);
        const message = hexToUtf8(tx.transaction.message);
        const senderPubkey = tx.transaction.signerPublicKey;

        // === 🔹 通知済みスキップ ===
        if (await isAlreadyNotified(fullHash)) return;

        if (!message.trim()) return;

        try {
          // === 🟢 新スレッド ===
          if (!message.includes('#')) {
            await supabase.from('threads').upsert({
              hash: shortHash,
              full_hash: fullHash,
              owner_pubkey: senderPubkey,
              title: message.trim()
            }, { onConflict: 'hash' });

            await notifyAllUsersNewThread(message.trim(), fullHash);
            await markAsNotified(fullHash, 'thread');
          }
          // === 💬 コメント ===
          else if (message.startsWith('#') && message.length > 7) {
            const tag = message.split(' ')[0];
            const expectedShortHash = tag.substring(1, 6);
            if (expectedShortHash === shortHash) {
              const comment = message.slice(tag.length + 1).trim();
              const { data: thread } = await supabase
                .from('threads')
                .select('owner_pubkey, full_hash')
                .eq('hash', shortHash)
                .single();

              if (thread) {
                await supabase.from('thread_comments').upsert({
                  thread_hash: shortHash,
                  sender_pubkey: senderPubkey
                }, { onConflict: 'thread_hash,sender_pubkey' });

                await notifyThreadParticipants(thread.owner_pubkey, thread.full_hash, comment, senderPubkey);
                await markAsNotified(fullHash, 'comment');
              }
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
async function notifyAllUsersNewThread(title, fullHash) {
  const { data: users } = await supabase.from('user_notifications').select('line_user_id');
  const link = `https://xym-thread.com/thread.html?id=${fullHash}`;
  await Promise.all(
    (users || []).map(u => u.line_user_id && sendLine(u.line_user_id, `🆕 新スレッド！\n${title}`, link))
  );
}

async function notifyThreadParticipants(ownerPubkey, fullHash, comment, senderPubkey) {
  const shortHash = fullHash.substring(0, 5);
  const { data: commenters } = await supabase
    .from('thread_comments')
    .select('sender_pubkey')
    .eq('thread_hash', shortHash);

  const pubkeys = [ownerPubkey, senderPubkey, ...(commenters?.map(c => c.sender_pubkey) || [])];
  const uniquePubkeys = [...new Set(pubkeys)];

  const link = `https://xym-thread.com/thread.html?id=${fullHash}`;
  await Promise.all(
    uniquePubkeys.map(async (pubkey) => {
      const { data: user } = await supabase
        .from('user_notifications')
        .select('line_user_id')
        .eq('pubkey', pubkey)
        .single();
      if (user?.line_user_id) {
        await sendLine(user.line_user_id, `💬 新着コメント！\n${comment}`, link);
      }
    })
  );
}

async function sendLine(to, text, link) {
  try {
    await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to,
        messages: [{ type: 'text', text: `${text}\n${link}` }]
      })
    });
  } catch (err) {
    console.error('LINE send error:', err);
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
  await supabase.from('notified_txs').upsert({ tx_hash: fullHash, type });
}

// === 🛰️ ノード選択 ===
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
      console.log("🟢 Using node:", selectedNode);
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
