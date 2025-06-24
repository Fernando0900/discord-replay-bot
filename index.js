require('dotenv').config(); // Cargar variables desde .env

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');

const adapter = new JSONFile('db.json');
const db = new Low(adapter, { uploads: {} });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

async function startBot() {
  await db.read();
  db.data ||= { uploads: {} };
  await db.write();

  client.once('ready', () => {
    console.log(`✅ Bot conectado como ${client.user.tag}`);
  });

  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const userId = message.author.id;
    const now = new Date();

    // ✅ Comando !replay-status
    if (message.content === '!replay-status' && message.channel.id === process.env.CANAL_ID) {
      const lastUpload = db.data.uploads[userId] ? new Date(db.data.uploads[userId]) : null;

      let replyText;

      if (!lastUpload) {
        replyText = '✅ Aún no has subido ningún replay este mes. ¡Puedes enviar uno ahora!';
      } else {
        const sameMonth = now.getFullYear() === lastUpload.getFullYear() && now.getMonth() === lastUpload.getMonth();

        if (!sameMonth) {
          replyText = '✅ Ya puedes subir un nuevo replay este mes.';
        } else {
          const nextUpload = new Date(lastUpload);
          nextUpload.setMonth(nextUpload.getMonth() + 1);

          const diffMs = nextUpload - now;
          const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
          const diffHours = Math.floor((diffMs / (1000 * 60 * 60)) % 24);
          const diffMinutes = Math.floor((diffMs / (1000 * 60)) % 60);

          replyText = `⏳ Podrás subir otro replay en **${diffDays} días, ${diffHours} horas y ${diffMinutes} minutos**.`;
        }
      }

      try {
        await message.author.send(replyText);
      } catch {
        console.warn(`❗ No se pudo enviar DM a ${message.author.tag}`);
      }

      await message.delete();
      return;
    }

    // 🔄 Comando !reset @usuario
    if (message.content.startsWith('!reset') && message.member?.permissions.has('Administrator')) {
      const mention = message.mentions.users.first();
      if (!mention) return;

      delete db.data.uploads[mention.id];
      await db.write();

      try {
        await mention.send('🔄 Tu contador ha sido **reseteado por un administrador**. Ya puedes volver a subir un replay.');
      } catch {
        console.warn(`❗ No se pudo enviar DM a ${mention.tag}`);
      }

      await message.delete();
      return;
    }

    // 📥 Subida de replay
    if (message.channel.id === process.env.CANAL_ID) {
      const file = message.attachments.first();
      if (!file || !file.name.endsWith('.SC2Replay')) return;

      const lastUpload = db.data.uploads[userId] ? new Date(db.data.uploads[userId]) : null;

      const sameMonth = lastUpload &&
        now.getFullYear() === lastUpload.getFullYear() &&
        now.getMonth() === lastUpload.getMonth();

      if (sameMonth) {
        await message.delete();

        const nextUpload = new Date(lastUpload);
        nextUpload.setMonth(nextUpload.getMonth() + 1);

        const diffMs = nextUpload - now;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const diffHours = Math.floor((diffMs / (1000 * 60 * 60)) % 24);
        const diffMinutes = Math.floor((diffMs / (1000 * 60)) % 60);

        const messageText = `🚫 Solo puedes subir **1 replay (.SC2Replay)** por mes.\n` +
          `⏳ Podrás subir otro en **${diffDays} días, ${diffHours} horas y ${diffMinutes} minutos**.`;

        try {
          await message.author.send(messageText);
        } catch (err) {
          console.warn(`No se pudo enviar DM a ${message.author.tag}`);
        }

      } else {
        db.data.uploads[userId] = now.toISOString();
        await db.write();
      }
    }
  });

  client.login(process.env.DISCORD_TOKEN);
}

startBot();
