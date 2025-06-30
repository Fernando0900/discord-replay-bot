require('dotenv').config();

const express = require('express');
const { Client, GatewayIntentBits, Partials, Routes, REST, SlashCommandBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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

  client.once('ready', async () => {
    console.log(`✅ Bot conectado como ${client.user.tag}`);

    const commands = [
      new SlashCommandBuilder()
        .setName('replay-status')
        .setDescription('Consulta si puedes subir un nuevo replay.'),

      new SlashCommandBuilder()
        .setName('replay-reset')
        .setDescription('Resetea el contador de replays de un usuario.')
        .addUserOption(option =>
          option.setName('usuario')
            .setDescription('Usuario a resetear')
            .setRequired(true)
        )
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ Comandos registrados');
  });

  client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand()) {
      const userId = interaction.user.id;
      const now = new Date();

      if (interaction.commandName === 'replay-status') {
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

          replyText += upload?.revisado
            ? '\n✅ Tu replay ya fue **revisado**.'
            : '\n🕒 Aún no ha sido revisado.';
        }

        try {
          await interaction.user.send(replyText);
        } catch {
          await interaction.reply({ content: replyText, ephemeral: true });
          return;
        }

        await interaction.reply({ content: '📩 Te envié los detalles por DM.', ephemeral: true });
      }

      if (interaction.commandName === 'replay-reset') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return interaction.reply({ content: '❌ Solo administradores pueden usar este comando.', ephemeral: true });
        }

        const target = interaction.options.getUser('usuario');
        delete db.data.uploads[target.id];
        await db.write();

        try {
          await target.send('🔄 Tu contador ha sido **reseteado por un administrador**. Ya puedes volver a subir un replay.');
        } catch {
          await interaction.reply({ content: `❗ No se pudo enviar DM a ${target.tag}`, ephemeral: true });
          return;
        }

        await interaction.reply({ content: `✅ Contador reseteado para ${target.tag}.`, ephemeral: true });
      }
    }

    if (interaction.isButton()) {
      const ownerId = '882268783958454272';
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

          try {
            const user = await client.users.fetch(targetId);
            await user.send('📭 Tu replay fue marcado como **ausente**. No estuviste presente cuando se iba a revisar.');
          } catch {
            console.warn(`❗ No se pudo enviar DM a ${targetId}`);
          }

          await interaction.update({
            content: `❌ Replay de <@${targetId}> **marcado como ausente por Skros**.`,
            components: []
          });
        }
      }
    }
  });

  client.on('messageCreate', async (message) => {
    if (message.author.bot || message.channel.id !== process.env.CANAL_ID) return;

    const file = message.attachments.first();
    if (!file || !file.name.endsWith('.SC2Replay')) return;

    const userId = message.author.id;
    const now = new Date();
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
      } catch {
        await message.reply({ content: messageText, ephemeral: true });
      }

    } else {
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
    }
  });

  client.login(process.env.DISCORD_TOKEN);
}

startBot();
