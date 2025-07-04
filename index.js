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
  Events
} = require("discord.js");
const express = require("express");
const fs = require("fs");
const db = require("./db.json");

const app = express();
const PORT = process.env.PORT || 3000;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const OWNER_ID = "882268783958454272";
const COOLDOWN = 45 * 24 * 60 * 60 * 1000; // 45 días en ms

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error("❌ CLIENT_ID o DISCORD_TOKEN no están definidos en el archivo .env");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

const commands = [
  new SlashCommandBuilder()
    .setName("replay-status")
    .setDescription("Consulta si puedes subir un nuevo replay."),
  new SlashCommandBuilder()
    .setName("replay-reset")
    .setDescription("Resetea el contador de replays de un usuario.")
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
        return interaction.reply({ content: "✅ Aún no has subido ningún replay. ¡Puedes enviar uno ahora!", flags: 64 });
      }

      const now = Date.now();
      const uploaded = new Date(replay.fecha).getTime();
      const diff = now - uploaded;

      if (diff < COOLDOWN) {
        const msLeft = COOLDOWN - diff;
        const dias = Math.floor(msLeft / (1000 * 60 * 60 * 24));
        const horas = Math.floor((msLeft / (1000 * 60 * 60)) % 24);
        const minutos = Math.floor((msLeft / (1000 * 60)) % 60);
        return interaction.reply({
          content: `⏳ Debes esperar ${dias} días, ${horas} horas y ${minutos} minutos para subir otro replay.`,
          flags: 64
        });
      }

      if (replay.revisado) {
        return interaction.reply({ content: "✅ Tu replay fue revisado correctamente.", flags: 64 });
      }

      if (replay.ausente) {
        return interaction.reply({ content: "❌ Tu replay no fue revisado porque se te marcó como ausente.", flags: 64 });
      }

      return interaction.reply({ content: "⏳ Ya subiste un replay. Está pendiente de revisión.", flags: 64 });
    }

    if (commandName === "replay-reset") {
      if (user.id !== OWNER_ID && !hasAdminRole) {
        return interaction.reply({
          content: "❌ Solo el propietario o administradores pueden usar este comando.",
          flags: 64
        });
      }

      db.uploads[user.id] = null;
      fs.writeFileSync("./db.json", JSON.stringify(db, null, 2));
      return interaction.reply({ content: "✅ Replay reseteado con éxito.", flags: 64 });
    }
  }

  if (interaction.isButton()) {
    const { customId, user, message } = interaction;

    if (user.id !== OWNER_ID) {
      return interaction.reply({ content: "❌ Solo Skros puede usar estos botones.", flags: 64 });
    }

    const userId = message.content.match(/<@(\d+)>/)?.[1];
    if (!userId || !db.uploads[userId]) {
      return interaction.reply({ content: "❌ No se encontró replay válido para este usuario.", flags: 64 });
    }

    const replayMsg = await message.channel.messages.fetch({ limit: 10 }).then(msgs =>
      msgs.find(m => m.author.id === userId && m.attachments.size > 0)
    );

    if (customId === "revisado") {
      db.uploads[userId].revisado = true;
      fs.writeFileSync("./db.json", JSON.stringify(db, null, 2));
      await message.edit({ content: `✅ Replay de <@${userId}> marcado como revisado.`, components: [] });
      if (replayMsg) await replayMsg.react("✅");
    }

    if (customId === "ausente") {
      db.uploads[userId].ausente = true;
      fs.writeFileSync("./db.json", JSON.stringify(db, null, 2));
      await message.edit({ content: `❌ Replay de <@${userId}> marcado como ausente.`, components: [] });
      if (replayMsg) await replayMsg.react("❌");
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!message.attachments.size) return;
  if (!message.attachments.first().name.endsWith(".SC2Replay")) return;

  const lastReplay = db.uploads[message.author.id];
  if (lastReplay) {
    const now = Date.now();
    const uploaded = new Date(lastReplay.fecha).getTime();
    if (now - uploaded < COOLDOWN) {
      return message.reply({ content: "❌ Aún no puedes subir otro replay. Usa /replay-status para ver el tiempo restante." }).then(m => setTimeout(() => m.delete(), 8000));
    }
  }

  db.uploads[message.author.id] = {
    nombre: message.attachments.first().name,
    fecha: new Date().toISOString(),
    revisado: false,
    ausente: false
  };
  fs.writeFileSync("./db.json", JSON.stringify(db, null, 2));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("revisado").setLabel("Revisado").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("ausente").setLabel("Ausente").setStyle(ButtonStyle.Danger)
  );

  await message.channel.send({
    content: `📂 Replay recibido de <@${message.author.id}>. Esperando revisión.`,
    components: [row]
  });
});

client.login(DISCORD_TOKEN);

// Keepalive
app.get("/", (req, res) => res.send("Bot activo"));
app.listen(PORT, () => console.log(`🌐 Servidor web activo en puerto ${PORT}`));
