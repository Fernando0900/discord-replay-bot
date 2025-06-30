require('dotenv').config();

const express = require('express');
const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');

const adapter = new JSONFile('db.json');
const db = new Low(adapter, { uploads: {} });

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Bot is alive!');
});

app.listen(PORT, () => {
  console.log(`🌐 Servidor Express en línea en http://localhost:${PORT}`);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessageReactions // Necesario para botones
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

    if (message.content === '!replay-status' && message.channel.id === process.env.CANAL_ID) {
      const upload = db.data.uploads[userId];
      const lastUpload = upload ? new Date(upload.fecha) : null;
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

        if (upload?.revisado) {
          replyText += '\n✅ Tu replay ya fue **revisado**.';
        } else {
          replyText += '\n🕒 Aún no ha sido revisado.';
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

    if (message.content.startsWith('!replay-reset') && message.member?.permissions.has('Administrator')) {
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

    if (message.channel.id === process.env.CANAL_ID) {
      const file = message.attachments.first();
      if (!file || !file.name.endsWith('.SC2Replay')) return;

      const upload = db.data.uploads[userId];
      const lastUpload = upload ? new Date(upload.fecha) : null;

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
        // Guardar el replay con revisado: false
        db.data.uploads[userId] = {
          fecha: now.toISOString(),
          revisado: false
        };
        await db.write();

        // Enviar mensaje con botón
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`revisar_${userId}`)
            .setLabel('✅ Revisado')
            .setStyle(ButtonStyle.Success)
        );

        await message.reply({
          content: `🎮 Replay recibido de <@${userId}>. Esperando revisión.`,
          components: [row]
        });
      }
    }
  });

  // Manejar botón de revisión
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    const ownerId = '882268783958454272';
    const [action, targetId] = interaction.customId.split('_');

    if (action === 'revisar' && interaction.user.id === ownerId) {
      if (db.data.uploads[targetId]) {
        db.data.uploads[targetId].revisado = true;
        await db.write();

        await interaction.update({
          content: `✅ Replay de <@${targetId}> **revisado por el dueño**.`,
          components: []
        });
      }
    }
  });

  client.login(process.env.DISCORD_TOKEN);
}

startBot();
