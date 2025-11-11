let lastCheckedHeight = 0;
const supabase = require('@supabase/supabase-js').createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

module.exports = async (req, res) => {
  const NODE = await getAvailableNode();
  if (!NODE) return res.status(500).json({ error: 'Node unavailable' });

  try {
    const info = await fetch(`${NODE}/chain/info`).then(r => r.json());
    const currentHeight = info.height;

    if (currentHeight <= lastCheckedHeight) {
      return res.status(200).json({ status: 'no new blocks' });
    }

    const params = new URLSearchParams({
      address: 'NB2TFCNBOXNG6FU2JZ7IA3SLYOYZ24BBZAUPAOA',
      pageSize: 20,
      order: 'desc'
    });
    const response = await fetch(`${NODE}/transactions/confirmed?${params}`);
    const txs = await response.json();

    for (const tx of txs.data) {
      if (tx.meta.height <= lastCheckedHeight) continue;

      if (tx.transaction.message) {
        const msg = hexToUtf8(tx.transaction.message);
        if (msg.startsWith('#')) {
          const shortTag = msg.substring(0, 6);
          const threadHash = shortTag.substring(1);
          const { data: thread } = await supabase
            .from('threads')
            .select('owner_pubkey')
            .eq('hash', threadHash)
            .single();

          if (thread?.owner_pubkey) {
            await fetch(`${process.env.VERCEL_URL}/api/send-notification`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                txHash: tx.meta.hash,
                message: msg,
                senderPubkey: tx.transaction.signerPublicKey,
                threadOwnerPubkey: thread.owner_pubkey,
              }),
            });
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
