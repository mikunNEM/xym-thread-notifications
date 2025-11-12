// api/monitor-poll.js
import { createClient } from '@supabase/supabase-js';
import { SymbolFacade, Address } from 'symbol-sdk/symbol';

let lastCheckedHeight = 0;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// 🧩 スレッド投稿専用アドレス
const THREAD_POST_ADDRESS = 'NB2TFCNBOXNG6FU2JZ7IA3SLYOYZ24BBZAUPAOA';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  const NODE = await getAvailableNode();
  if (!NODE) {
    clearTimeout(timeoutId);
    return res.status(200).json({ status: 'node unavailable', checked: lastCheckedHeight });
  }

  try {
    // --- チェーン高さ ---
    const infoRes = await fetch(`${NODE}/chain/info`, { signal: controller.signal });
    if (!infoRes.ok) throw new Error('Chain info failed');
    const { height: currentHeight } = await infoRes.json();
    clearTimeout(timeoutId);

    if (currentHeight <= lastCheckedHeight) {
      return res.status(200).json({ status: 'no new blocks', checked: currentHeight });
    }

    const params = new URLSearchParams({ pageSize: '50', order: 'desc' });
    const txUrl = `${NODE}/transactions/confirmed?${params}`;
    console.log('🔍 Fetching:', txUrl);

    const txRes = await fetch(txUrl, { signal: controller.signal });
    if (!txRes.ok) throw new Error(`Tx fetch failed: ${await txRes.text()}`);
    const { data: txs } = await txRes.json();
    if (!txs?.length) return res.status(200).json({ status: 'no txs found', checked: currentHeight });

    const results = [];
    const tasks = txs.map(async (tx) => {
      const fullHash = tx.meta.hash;
      const senderPubkey = tx.transaction.signerPublicKey;
      const recipientRaw = tx.transaction.recipientAddress;
      const recipientBase32 = Address.createFromEncoded(recipientRaw).plain();

      const msgObj = tx.transaction.message;
      if (!msgObj) return;
      if (msgObj.type !== 0) return; // 暗号化メッセージはスキップ

      const message = hexToUtf8(msgObj.payload).trim();
      if (!message || await isAlreadyNotified(fullHash)) return;

      try {
        // === 🆕 新スレッド ===
        if (recipientBase32 === THREAD_POST_ADDRESS && !message.startsWith('#')) {
          const shortHash = fullHash.substring(0, 5);
          await supabase.from('threads').upsert({
            hash: shortHash,
            full_hash: fullHash,
            owner_pubkey: senderPubkey,
            title: message,
          }, { onConflict: 'hash' });

          const ok = await notifyAllUsersNewThread(message, fullHash);
          await markAsNotified(fullHash, ok ? 'thread' : 'thread_error');
          results.push({ type: 'thread', ok, title: message });
        }
        // === 💬 コメント ===
        else if (message.startsWith('#') && message.length > 7) {
          const tag = message.split(' ')[0];
          const shortTarget = tag.substring(1, 6);
          const comment = message.slice(tag.length + 1).trim();

          const { data: thread } = await supabase
            .from('threads')
            .select('owner_pubkey, full_hash, title')
            .eq('hash', shortTarget)
            .single();

          if (thread) {
            await supabase.from('thread_comments').upsert({
              thread_hash: shortTarget,
              sender_pubkey: senderPubkey
            }, { onConflict: 'thread_hash,sender_pubkey' });

            const ok = await notifyThreadParticipants(
              thread.owner_pubkey,
              thread.full_hash,
              thread.title,
              comment,
              senderPubkey
            );
            await markAsNotified(fullHash, ok ? 'comment' : 'comment_error');
            results.push({ type: 'comment', ok, comment });
          }
        }
      } catch (err) {
        console.error('Process tx error:', err);
      }
    });

    await Promise.all(tasks);
    lastCheckedHeight = currentHeight;
    res.status(200).json({ status: 'success', checked: currentHeight, results });
  } catch (error) {
    clearTimeout(timeoutId);
    console.error('Monitor error:', error);
    res.status(200).json({ status: 'error', error: error.message, checked: lastCheckedHeight });
  }
}

/* === 通知処理など共通関数群 === */
async function notifyAllUsersNewThread(title, fullHash) {
  try {
    const { data: users } = await supabase.from('user_notifications').select('line_user_id');
    if (!users?.length) return false;
    const link = `https://xym-thread.com/thread.html?id=${fullHash}`;
    const msg = `🆕 新しいスレッドが投稿されました！\n「${title}」\n👉 ${link}`;
    const results = await Promise.all(users.map(u => sendLine(u.line_user_id, msg)));
    return results.filter(Boolean).length > 0;
  } catch (e) {
    console.error('notifyAllUsersNewThread error:', e);
    return false;
  }
}

async function notifyThreadParticipants(ownerPubkey, fullHash, title, comment, senderPubkey) {
  try {
    const shortHash = fullHash.substring(0, 5);
    const { data: commenters } = await supabase
      .from('thread_comments')
      .select('sender_pubkey')
      .eq('thread_hash', shortHash);

    const pubkeys = [ownerPubkey, senderPubkey, ...(commenters?.map(c => c.sender_pubkey) || [])];
    const unique = [...new Set(pubkeys)];

    const link = `https://xym-thread.com/thread.html?id=${fullHash}`;
    const msg = `💬 「${title}」に新しいコメントが届きました！\n「${comment}」\n👉 ${link}`;

    const results = await Promise.all(unique.map(async pk => {
      const { data: user } = await supabase
        .from('user_notifications')
        .select('line_user_id')
        .eq('pubkey', pk)
        .single();
      if (user?.line_user_id) return await sendLine(user.line_user_id, msg);
      return false;
    }));

    return results.filter(Boolean).length > 0;
  } catch (e) {
    console.error('notifyThreadParticipants error:', e);
    return false;
  }
}

async function sendLine(to, text) {
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ to, messages: [{ type: 'text', text }] })
    });
    return res.ok;
  } catch {
    return false;
  }
}

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

async function getAvailableNode() {
    const fixedNode = 'https://symbol-mikun.net:3001'; // 固定ノード
    const NodesUrl = 'https://mainnet.dusanjp.com:3004/nodes?filter=suggested&limit=1000&ssl=true';

    // 🔹 まずノードリストから探す
    try {
        const response = await fetch(NodesUrl);
        const data = await response.json();

        if (data && data.length > 0) {
            // 🔹 `hostDetail.country === "Japan"` のノードをフィルタリング 🇯🇵
            let availableNodes = data.filter(node => node.hostDetail?.country === "Japan");

            if (availableNodes.length === 0) {
                console.warn("⚠️ 日本のノードが見つからなかったため、全ノードから選択します");
                availableNodes = data; // 日本のノードがなければ全ノードを使用
            }

            // 🔹 ブロック高が高い順にソート（`chainHeight` が一番大きいノードを優先）
            availableNodes.sort((a, b) => b.apiStatus.chainHeight - a.apiStatus.chainHeight);

            // 🔹 最もブロック高が高いノードを選択
            const selectedNode = availableNodes[0].apiStatus.restGatewayUrl;
            console.log("🟢 最新ブロック高のノードを使用:", selectedNode, "（ブロック高:", availableNodes[0].apiStatus.chainHeight, "）");
            return selectedNode;
        } else {
            console.warn("⚠️ バックアップノードが見つからなかった。固定ノードを試します。");
        }
    } catch (error) {
        console.error("❌ ノードリストの取得に失敗:", error);
    }

    // 🔹 最後の手段として固定ノードを試す
    try {
        const response = await fetch(`${fixedNode}/node/health`);
        const healthData = await response.json();
        console.log("healthData========", healthData);

        if (healthData && healthData.status.db && healthData.status.apiNode === 'up') {
            console.log("✅ 固定ノードを使用:", fixedNode);
            return fixedNode;
        }
    } catch (error) {
        console.error("❌ 固定ノードもダウンしているため、利用可能なノードが見つかりません。");
    }

    return null; // どのノードも使えなかった場合
}

function hexToUtf8(hex) {
  try {
    const bytes = new Uint8Array(hex.match(/.{1,2}/g).map(h => parseInt(h, 16)));
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}
