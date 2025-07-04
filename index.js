require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
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

function msToTime(duration) {
  const minutes = Math.floor((duration / (1000 * 60)) % 60);
  const hours = Math.floor((duration / (1000 * 60 * 60)) % 24);
  const days = Math.floor(duration / (1000 * 60 * 60 * 24));
  return `${days} días, ${hours} horas y ${minutes} minutos`;
}

client.on(Events.InteractionCreate, async (interaction) => {
  const hasAdminRole = interaction.member?.roles?.cache?.some((role) =>
    ["Admin", "Fundador"].includes(role.name)
  );

  if (interaction.isChatInputCommand()) {
    const { commandName, user } = interaction;

    if (commandName === "replay-status") {
      const replay = db.uploads[user.id];

      if (!replay) {
        return interaction.reply({
          content: "✅ Aún no has subido ningún replay. ¡Puedes enviar uno ahora!",
          flags: 64
        });
      }

      const timePassed = Date.now() - new Date(replay.fecha).getTime();
      const cooldown = 45 * 24 * 60 * 60 * 1000;

      if (timePassed < cooldown) {
        const restante = msToTime(cooldown - timePassed);
        return interaction.reply({
          content: `⏳ Debes esperar ${restante} para subir otro replay.`,
          flags: 64
        });
      }

      if (replay.revisado) {
        return interaction.reply({
          content: "✅ Tu replay fue revisado correctamente.",
          flags: 64
        });
      }

      if (replay.ausente) {
        return interaction.reply({
          content: "❌ Tu replay no fue revisado porque se te marcó como ausente.",
          flags: 64
        });
      }

      return interaction.reply({
        content: "⏳ Ya subiste un replay. Está pendiente de revisión.",
        flags: 64
      });
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
      return interaction.reply({
        content: "✅ Replay reseteado con éxito.",
        flags: 64
      });
    }
  }

  if (interaction.isMessageComponent()) {
    const { customId, user, message } = interaction;

    if (user.id !== OWNER_ID) {
      return interaction.reply({
        content: "❌ Solo Skros puede usar estos botones.",
        flags: 64
      });
    }

    const userId = message.content.match(/<@(\d+)>/)?.[1];
    if (!userId || !db.uploads[userId]) {
      return interaction.reply({
        content: "❌ No se encontró replay válido para este usuario.",
        flags: 64
      });
    }

    if (customId === "revisado") {
      db.uploads[userId].revisado = true;
      fs.writeFileSync("./db.json", JSON.stringify(db, null, 2));
      await message.react("✅");
      await message.delete();
    }

    if (customId === "ausente") {
      db.uploads[userId].ausente = true;
      fs.writeFileSync("./db.json", JSON.stringify(db, null, 2));
      await message.react("❌");
      await message.delete();
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!message.attachments.size) return;

  const archivo = message.attachments.first();
  if (!archivo.name.endsWith(".SC2Replay")) return;

  const replayAnterior = db.uploads[message.author.id];
  if (replayAnterior) {
    const tiempoPasado = Date.now() - new Date(replayAnterior.fecha).getTime();
    const cooldown = 45 * 24 * 60 * 60 * 1000;
    if (tiempoPasado < cooldown) {
      const restante = msToTime(cooldown - tiempoPasado);
      await message.delete();
      return message.channel.send({
        content: `⏳ <@${message.author.id}> aún no puedes subir otro replay. Espera ${restante}.`,
        ephemeral: true
      });
    }
  }

  db.uploads[message.author.id] = {
    nombre: archivo.name,
    fecha: new Date().toISOString(),
    revisado: false,
    ausente: false
  };
  fs.writeFileSync("./db.json", JSON.stringify(db, null, 2));

  const row = {
    type: 1,
    components: [
      {
        type: 2,
        style: 3,
        label: "Revisado",
        custom_id: "revisado"
      },
      {
        type: 2,
        style: 4,
        label: "Ausente",
        custom_id: "ausente"
      }
    ]
  };

  await message.channel.send({
    content: `📂 Replay recibido de <@${message.author.id}>. Esperando revisión.`,
    components: [row]
  });
});

client.login(DISCORD_TOKEN);

// Keepalive para Render
app.get("/", (req, res) => res.send("Bot activo"));
app.listen(PORT, () => console.log(`🌐 Servidor web activo en puerto ${PORT}`));
