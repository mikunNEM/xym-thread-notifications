let lastCheckedHeight = 0;
const supabase = require('@supabase/supabase-js').createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

module.exports = async (req, res) => {

  // CORSヘッダー
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  
  const NODE = await getAvailableNode();
  if (!NODE) return res.status(500).json({ error: 'Node unavailable' });

  try {
    const info = await fetch(`${NODE}/chain/info`).then(r => r.json());
    const currentHeight = info.height;

    if (currentHeight <= lastCheckedHeight) {
      return res.status(200).json({ status: 'no new blocks' });
    }

    // 全転送トランザクションを取得（新スレッド + コメント）
    const params = new URLSearchParams({
      address: 'NB2TFCNBOXNG6FU2JZ7IA3SLYOYZ24BBZAUPAOA',
      pageSize: 100,
      order: 'desc'
    });
    const response = await fetch(`${NODE}/transactions/confirmed?${params}`);
    const txs = await response.json();

    for (const tx of txs.data) {
      if (tx.meta.height <= lastCheckedHeight) continue;

      const fullHash = tx.meta.hash;                    // フル64文字
      const shortHash = fullHash.substring(0, 5);        // 先頭5文字
      const message = tx.transaction.message ? hexToUtf8(tx.transaction.message) : '';
      const senderPubkey = tx.transaction.signerPublicKey;
      const mosaics = tx.transaction.mosaics || [];

      // XYM送金あり + メッセージあり = 有効な投稿
      if (mosaics.length === 0 || !message.trim()) continue;

      // === 新スレッド検知（#タグなし）===
      if (!message.includes('#') && message.trim()) {
        const title = message.trim();

        // DB登録（5文字 + フルハッシュ）
        await supabase.from('threads').upsert({
          hash: shortHash,
          full_hash: fullHash,
          owner_pubkey: senderPubkey,
          title
        });

        // 全員に通知
        await notifyAllUsersNewThread(title, fullHash);
      }

      // === コメント検知（#タグ付き）===
      else if (message.startsWith('#') && message.length > 7) {
        const tag = message.split(' ')[0]; // #ABC12
        const expectedShortHash = tag.substring(1, 6);

        if (expectedShortHash === shortHash) {
          const comment = message.slice(tag.length + 1).trim();

          // スレッド存在確認
          const { data: thread } = await supabase
            .from('threads')
            .select('owner_pubkey, full_hash')
            .eq('hash', shortHash)
            .single();

          if (thread) {
            // コメント者登録
            await supabase.from('thread_comments').upsert({
              thread_hash: shortHash,
              sender_pubkey: senderPubkey
            });

            // スレッド参加者全員に通知
            await notifyThreadParticipants(
              thread.owner_pubkey,
              thread.full_hash,
              comment,
              senderPubkey
            );
          }
        }
      }
    }

    lastCheckedHeight = currentHeight;
    res.status(200).json({ status: 'success', checked: currentHeight });
  } catch (error) {
    console.error('Monitor error:', error);
    res.status(500).json({ error: error.message });
  }
};

// 全員に新スレッド通知
async function notifyAllUsersNewThread(title, fullHash) {
  const { data: users } = await supabase.from('user_notifications').select('line_user_id');
  const link = `https://xym-thread.com/thread.html?id=${fullHash}`;

  for (const user of users) {
    if (user.line_user_id) {
      await sendLine(user.line_user_id, `新スレッド投稿！\n${title}`, link);
    }
  }
}

// スレッド参加者にコメント通知
async function notifyThreadParticipants(ownerPubkey, fullHash, comment, senderPubkey) {
  const { data: commenters } = await supabase
    .from('thread_comments')
    .select('sender_pubkey')
    .eq('thread_hash', fullHash.substring(0, 5));

  const pubkeys = [ownerPubkey, ...commenters.map(c => c.sender_pubkey), senderPubkey];
  const uniquePubkeys = [...new Set(pubkeys)];
  const link = `https://xym-thread.com/thread.html?id=${fullHash}`;

  for (const pubkey of uniquePubkeys) {
    const { data: user } = await supabase
      .from('user_notifications')
      .select('line_user_id')
      .eq('pubkey', pubkey)
      .single();

    if (user?.line_user_id) {
      await sendLine(user.line_user_id, `新着コメント！\n${comment}`, link);
    }
  }
}

// LINE送信共通関数
async function sendLine(to, text, link) {
  await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to,
      messages: [{
        type: 'text',
        text: `${text}\n${link}`
      }]
    })
  });
}

// 以下、getAvailableNode と hexToUtf8 はそのまま
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
      return availableNodes[0].apiStatus.restGatewayUrl;
    }
  } catch (e) {}

  try {
    const health = await fetch(`${fixedNode}/node/health`).then(r => r.json());
    if (health.status.db && health.status.apiNode === 'up') return fixedNode;
  } catch (e) {}

  return null;
}

function hexToUtf8(hex) {
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substr(i, 2), 16));
  }
  return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
}