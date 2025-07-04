// index.js
require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  Events,
} = require("discord.js");
const express = require("express");
const fs = require("fs");
const db = require("./db.json");

const app = express();
const PORT = process.env.PORT || 3000;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const OWNER_ID = "882268783958454272";

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error("❌ CLIENT_ID o DISCORD_TOKEN no están definidos.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const commands = [
  new SlashCommandBuilder()
    .setName("replay-status")
    .setDescription("Consulta si puedes subir un nuevo replay."),
  new SlashCommandBuilder()
    .setName("replay-reset")
    .setDescription("Resetea el contador de replays de un usuario."),
];

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

(async () => {
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("✅ Comandos registrados con éxito.");
  } catch (error) {
    console.error("❌ Error al registrar comandos:", error);
  }
})();

client.once("ready", () => {
  console.log(`🤖 Bot conectado como ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  const hasAdminRole = interaction.member?.roles?.cache?.some((role) =>
    ["Admin", "Fundador"].includes(role.name)
  );

  if (interaction.isChatInputCommand()) {
    const { commandName, user } = interaction;
    const replay = db.uploads[user.id];

    if (commandName === "replay-status") {
      if (!replay) {
        return interaction.reply({
          content: "✅ Aún no has subido ningún replay. ¡Puedes enviar uno ahora!",
          ephemeral: true,
        });
      }

      if (replay.revisado) {
        return interaction.reply({
          content: "✅ Tu replay fue revisado correctamente.",
          ephemeral: true,
        });
      }

      if (replay.ausente) {
        return interaction.reply({
          content: "❌ Tu replay no fue revisado porque se te marcó como ausente.",
          ephemeral: true,
        });
      }

      return interaction.reply({
        content: "⏳ Ya subiste un replay. Está pendiente de revisión.",
        ephemeral: true,
      });
    }

    if (commandName === "replay-reset") {
      if (user.id !== OWNER_ID && !hasAdminRole) {
        return interaction.reply({
          content: "❌ Solo Skros o administradores pueden usar este comando.",
          ephemeral: true,
        });
      }

      db.uploads[user.id] = null;
      fs.writeFileSync("./db.json", JSON.stringify(db, null, 2));
      return interaction.reply({
        content: "✅ Replay reseteado con éxito.",
        ephemeral: true,
      });
    }
  }

  if (interaction.isButton()) {
    if (interaction.user.id !== OWNER_ID) {
      return interaction.reply({
        content: "❌ Solo Skros puede usar estos botones.",
        ephemeral: true,
      });
    }

    const match = interaction.message.content.match(/<@(\d+)>/);
    const targetUserId = match?.[1];

    if (!targetUserId || !db.uploads[targetUserId]) {
      return interaction.reply({
        content: "❌ No se encontró replay válido para este usuario.",
        ephemeral: true,
      });
    }

    if (interaction.customId === "revisado") {
      db.uploads[targetUserId].revisado = true;
      db.uploads[targetUserId].ausente = false;
      fs.writeFileSync("./db.json", JSON.stringify(db, null, 2));
      return interaction.reply({
        content: `✅ Replay de <@${targetUserId}> marcado como revisado.`,
        ephemeral: true,
      });
    }

    if (interaction.customId === "ausente") {
      db.uploads[targetUserId].ausente = true;
      db.uploads[targetUserId].revisado = false;
      fs.writeFileSync("./db.json", JSON.stringify(db, null, 2));
      return interaction.reply({
        content: `❌ Replay de <@${targetUserId}> marcado como ausente.`,
        ephemeral: true,
      });
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!message.attachments.size) return;

  const archivo = message.attachments.first();
  if (!archivo.name.endsWith(".SC2Replay")) return;

  db.uploads[message.author.id] = {
    nombre: archivo.name,
    fecha: new Date().toISOString(),
    revisado: false,
    ausente: false,
  };
  fs.writeFileSync("./db.json", JSON.stringify(db, null, 2));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("revisado")
      .setLabel("Revisado")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("ausente")
      .setLabel("Ausente")
      .setStyle(ButtonStyle.Danger)
  );

  await message.channel.send({
    content: `📂 Replay recibido de <@${message.author.id}>. Esperando revisión.`,
    components: [row],
  });
});

client.login(DISCORD_TOKEN);

// Keepalive para Render
app.get("/", (req, res) => res.send("Bot activo"));
app.listen(PORT, () =>
  console.log(`🌐 Servidor web activo en puerto ${PORT}`)
);
