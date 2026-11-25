// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getEnv(key) {
  if (process.env[key]) return process.env[key];
  try {
    const envPath = path.resolve(__dirname, '../.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const match = content.match(new RegExp(`${key}\\s*=\\s*([^\\r\\n]+)`));
      if (match && match[1]) return match[1].trim();
    }
  } catch {}
  return null;
}

const BOT_TOKEN = getEnv('DISCORD_BOT_TOKEN');
const GUILD_ID = getEnv('DISCORD_GUILD_ID') || '1575020120147886111';

const HEADERS = {
  Authorization: `Bot ${BOT_TOKEN}`,
  'Content-Type': 'application/json',
};

async function api(endpoint, method = 'GET', body = null) {
  const opts = { method, headers: HEADERS };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`https://discord.com/api/v10${endpoint}`, opts);
  const text = await res.text();
  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text) };
  } catch {
    return { ok: res.ok, status: res.status, data: text };
  }
}

export async function setupServerStructure() {
  if (!BOT_TOKEN || !GUILD_ID) {
    console.error('Missing DISCORD_BOT_TOKEN or DISCORD_GUILD_ID in .env');
    return false;
  }

  console.log(`🚀 Setting up AniHubStream Discord Server (${GUILD_ID})...`);

  // 1. Try to set server icon if possible
  try {
    const iconPath = path.resolve(__dirname, '../public/art/poster-shadow-hunter.jpg');
    if (fs.existsSync(iconPath)) {
      const iconBase64 = 'data:image/jpeg;base64,' + fs.readFileSync(iconPath).toString('base64');
      const iconRes = await api(`/guilds/${GUILD_ID}`, 'PATCH', { icon: iconBase64 });
      if (iconRes.ok) console.log('✅ Server icon updated successfully!');
      else console.log('ℹ Server icon update:', iconRes.data?.message || iconRes.status);
    }
  } catch (err) {
    console.warn('⚠️ Icon update failed:', err.message);
  }

  // 2. Fetch existing channels
  const currentChannelsRes = await api(`/guilds/${GUILD_ID}/channels`);
  if (!currentChannelsRes.ok) {
    console.error('❌ Failed to fetch channels. Check bot permissions (Administrator needed):', currentChannelsRes.data);
    return false;
  }

  const existing = currentChannelsRes.data || [];
  const existingNames = new Set(existing.map((c) => c.name.toLowerCase()));

  // Server Structure blueprint matching the reference screenshots:
  const categories = [
    {
      name: '⚠️ | Important |',
      channels: [
        { name: 'rules', topic: '📜 AniHubStream community rules & guidelines' },
        { name: 'information', topic: '📑 Official links, apps & website status' },
        { name: 'announcements', topic: '📢 Official AniHubStream announcements & updates' },
      ],
    },
    {
      name: '💖 | Anime Updates |',
      channels: [
        { name: 'latest-episodes', topic: '🚨 Automatic new episode alerts from AniHubStream' },
        { name: 'anime-chat', topic: '💬 Discussions on currently airing seasonal anime' },
        { name: 'recommendations', topic: '🔥 Share your favorite anime recommendations & rankings' },
      ],
    },
    {
      name: '🌸 | Main |',
      channels: [
        { name: 'general', topic: '💬 General anime & community lounge' },
        { name: 'suggestions', topic: '💡 Feature suggestions for AniHubStream.com' },
        { name: 'bug-reports', topic: '📁 Report broken streams, audio sync, or video bugs' },
        { name: 'bot-commands', topic: '🤖 Bot playground and command testing' },
      ],
    },
    {
      name: '🍿 | Voice & Watch Party |',
      type: 4,
      channels: [
        { name: '🔊・General Lounge', type: 2 },
        { name: '🍿・Watch Party 1', type: 2 },
        { name: '🍿・Watch Party 2', type: 2 },
        { name: '🎵・Music & Lofi', type: 2 },
        { name: '💤・AFK', type: 2 },
      ],
    },
  ];

  let latestEpisodesChannelId = null;

  for (const cat of categories) {
    let parentId = null;
    const catExisting = existing.find((c) => c.type === 4 && c.name.toLowerCase() === cat.name.toLowerCase());

    if (catExisting) {
      parentId = catExisting.id;
      console.log(`ℹ Found category: "${cat.name}"`);
    } else {
      const catRes = await api(`/guilds/${GUILD_ID}/channels`, 'POST', {
        name: cat.name,
        type: 4,
      });
      if (catRes.ok) {
        parentId = catRes.data.id;
        console.log(`✅ Created category: "${cat.name}"`);
      } else {
        console.error(`❌ Could not create category "${cat.name}":`, catRes.data);
      }
    }

    for (const ch of cat.channels) {
      const chNameClean = ch.name.toLowerCase();
      const chExisting = existing.find((c) => c.name.toLowerCase().includes(chNameClean));

      if (chExisting) {
        console.log(`  ℹ Channel already exists: #${ch.name}`);
        if (chNameClean === 'latest-episodes' || chNameClean === 'announcements') {
          latestEpisodesChannelId = chExisting.id;
        }
      } else {
        const payload = {
          name: ch.name,
          type: ch.type ?? 0,
          parent_id: parentId,
        };
        if (ch.topic) payload.topic = ch.topic;

        const chRes = await api(`/guilds/${GUILD_ID}/channels`, 'POST', payload);
        if (chRes.ok) {
          console.log(`  ✅ Created channel: #${ch.name}`);
          if (chNameClean === 'latest-episodes') {
            latestEpisodesChannelId = chRes.data.id;
          }
        } else {
          console.error(`  ❌ Failed to create channel #${ch.name}:`, chRes.data);
        }
      }
    }
  }

  // Update DISCORD_CHANNEL_ID in .env to point to latest-episodes if created
  if (latestEpisodesChannelId) {
    try {
      const envPath = path.resolve(__dirname, '../.env');
      if (fs.existsSync(envPath)) {
        let envContent = fs.readFileSync(envPath, 'utf8');
        envContent = envContent.replace(/DISCORD_CHANNEL_ID=[0-9]+/, `DISCORD_CHANNEL_ID=${latestEpisodesChannelId}`);
        fs.writeFileSync(envPath, envContent, 'utf8');
        console.log(`\n📌 Auto-push channel updated to #${latestEpisodesChannelId} (latest-episodes)`);
      }
    } catch {}
  }

  return true;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('setup-discord-server.mjs')) {
  setupServerStructure().catch(console.error);
}
