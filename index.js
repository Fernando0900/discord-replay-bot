// Versión actualizada de index.js sin mensajes por DM
require('dotenv').config();

const express = require('express');
const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');
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
    GatewayIntentBits.GuildMessageReactions
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
    if (message.author.bot || !message.guild || message.system) return;
    const userId = message.author.id;
    const now = new Date();
    const limitDaysMs = 45 * 24 * 60 * 60 * 1000;

    // !replay-status
    if (message.content === '!replay-status' && message.channel.id === process.env.CANAL_ID) {
      const upload = db.data.uploads[userId];
      const lastUpload = upload ? new Date(upload.fecha) : null;
      let replyText;

      if (!lastUpload) {
        replyText = '✅ Aún no has subido ningún replay. ¡Puedes enviar uno ahora!';
      } else {
        const nextUpload = new Date(lastUpload.getTime() + limitDaysMs);
        const diffMs = nextUpload - now;

        if (diffMs <= 0) {
          replyText = '✅ Ya puedes subir un nuevo replay.';
        } else {
          const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
          const diffHours = Math.floor((diffMs / (1000 * 60 * 60)) % 24);
          const diffMinutes = Math.floor((diffMs / (1000 * 60)) % 60);

          replyText = `⏳ Podrás subir otro replay en **${diffDays} días, ${diffHours} horas y ${diffMinutes} minutos**.`;
        }

        replyText += upload?.revisado
          ? '\n✅ Tu replay ya fue **revisado**.'
          : '\n🕒 Aún no ha sido revisado.';
      }

      await message.reply({ content: replyText, ephemeral: true });
      await message.delete();
      return;
    }

    // !replay-reset @usuario (solo admins)
    if (message.content.startsWith('!replay-reset') && message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
      const mention = message.mentions.users.first();
      if (!mention) return;

      delete db.data.uploads[mention.id];
      await db.write();

      await message.reply({ content: `🔄 Replay de ${mention.tag} ha sido reseteado. Ya puede subir uno nuevo.`, ephemeral: true });
      await message.delete();
      return;
    }

    // Subida de replay
    if (message.channel.id === process.env.CANAL_ID) {
      const file = message.attachments.first();
      if (!file || !file.name.endsWith('.SC2Replay')) return;

      const upload = db.data.uploads[userId];
      const lastUpload = upload ? new Date(upload.fecha) : null;
      const tooSoon = lastUpload && (now - lastUpload) < limitDaysMs;

      if (tooSoon) {
        await message.delete();

        const nextUpload = new Date(lastUpload.getTime() + limitDaysMs);
        const diffMs = nextUpload - now;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const diffHours = Math.floor((diffMs / (1000 * 60 * 60)) % 24);
        const diffMinutes = Math.floor((diffMs / (1000 * 60)) % 60);

        const msg = `🚫 Solo puedes subir **1 replay (.SC2Replay)** cada 45 días.\n` +
          `⏳ Podrás subir otro en **${diffDays} días, ${diffHours} horas y ${diffMinutes} minutos**.`;

        await message.reply({ content: msg, ephemeral: true });
        return;
      }

      // Se permite la subida
      db.data.uploads[userId] = {
        fecha: now.toISOString(),
        revisado: false
      };
      await db.write();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`revisar_${userId}`)
          .setLabel('✅ Revisado')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`ausente_${userId}`)
          .setLabel('❌ Ausente')
          .setStyle(ButtonStyle.Danger)
      );

      await message.reply({
        content: `🎮 Replay recibido de <@${userId}>. Esperando revisión.`,
        components: [row]
      });

      return;
    }
  });

  // Botones de revisión
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    const ownerId = '360974094457503744';
    const [action, targetId] = interaction.customId.split('_');

    if (interaction.user.id !== ownerId) {
      return interaction.reply({ content: '❌ Solo Skros puede usar este botón.', ephemeral: true });
    }

    if (action === 'revisar') {
      if (db.data.uploads[targetId]) {
        db.data.uploads[targetId].revisado = true;
        await db.write();

        await interaction.update({
          content: `✅ Replay de <@${targetId}> **revisado por Skros**.`,
          components: []
        });
      }
    }

    if (action === 'ausente') {
      if (db.data.uploads[targetId]) {
        db.data.uploads[targetId].revisado = false;
        await db.write();

        await interaction.update({
          content: `❌ Replay de <@${targetId}> **marcado como ausente por Skros**.`,
          components: []
        });
      }
    }
  });

  client.login(process.env.DISCORD_TOKEN);
}

startBot();
