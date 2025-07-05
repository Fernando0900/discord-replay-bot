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
const OWNER_ID = "360974094457503744";
const COOLDOWN_DIAS = 45;

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

  const estados = [
    { name: "🟢 Bot Activo", type: 0 },             // Playing
    { name: "📂 Esperando replays", type: 3 },      // Watching
    { name: "⏱️ En línea las 24h", type: 2 },       // Listening
    { name: "✅ Revisando replays", type: 3 }       // Watching
  ];

  let estadoActual = 0;

  const actualizarEstado = () => {
    const estado = estados[estadoActual % estados.length];
    client.user.setPresence({
      status: "online",
      activities: [estado]
    });
    estadoActual++;
  };

  actualizarEstado(); // Estado inicial
  setInterval(actualizarEstado, 2 * 60 * 1000); // Cada 2 minutos
});


function getTiempoRestante(fecha) {
  const ahora = new Date();
  const anterior = new Date(fecha);
  const msRestantes = anterior.getTime() + COOLDOWN_DIAS * 86400000 - ahora.getTime();
  const dias = Math.floor(msRestantes / 86400000);
  const horas = Math.floor((msRestantes % 86400000) / 3600000);
  const minutos = Math.floor((msRestantes % 3600000) / 60000);
  return { dias, horas, minutos };
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

      const tiempo = getTiempoRestante(replay.fecha);
      if (tiempo.dias > 0 || tiempo.horas > 0 || tiempo.minutos > 0) {
        return interaction.reply({
          content: `⏳ <@${user.id}> aún no puedes subir otro replay. Espera ${tiempo.dias} días, ${tiempo.horas} horas y ${tiempo.minutos} minutos.`,
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

  if (interaction.isButton()) {
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

    try {
      const replayMsg = await message.channel.messages.fetch(db.uploads[userId].mensajeReplayId);

      if (customId === "revisado") {
        db.uploads[userId].revisado = true;
        fs.writeFileSync("./db.json", JSON.stringify(db, null, 2));
        await replayMsg.react("✅");
      }

      if (customId === "ausente") {
        db.uploads[userId].ausente = true;
        fs.writeFileSync("./db.json", JSON.stringify(db, null, 2));
        await replayMsg.react("❌");
      }

      if (db.uploads[userId].mensajeBotonesId) {
        const oldMsg = await message.channel.messages.fetch(db.uploads[userId].mensajeBotonesId).catch(() => null);
        if (oldMsg) await oldMsg.delete().catch(() => {});
      }

    } catch (err) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("revisado").setLabel("Revisado").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("ausente").setLabel("Ausente").setStyle(ButtonStyle.Danger)
      );

      const nuevoMsg = await message.channel.send({
        content: `📂 Replay recibido de <@${userId}>. Esperando revisión.`,
        components: [row]
      });

      db.uploads[userId].mensajeBotonesId = nuevoMsg.id;
      fs.writeFileSync("./db.json", JSON.stringify(db, null, 2));

      return interaction.reply({
        content: "⚠️ Los botones anteriores expiraron. Se han regenerado.",
        flags: 64
      });
    }

    await message.delete().catch(() => {});
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!message.attachments.size) return;

  const archivo = message.attachments.first();
  if (!archivo.name.endsWith(".SC2Replay")) return;

  const anterior = db.uploads[message.author.id];
  if (anterior) {
    const tiempo = getTiempoRestante(anterior.fecha);
    if (tiempo.dias > 0 || tiempo.horas > 0 || tiempo.minutos > 0) {
      await message.delete();
      return message.channel.send({
        content: `⏳ <@${message.author.id}> aún no puedes subir otro replay. Espera ${tiempo.dias} días, ${tiempo.horas} horas y ${tiempo.minutos} minutos.`,
        flags: 64
      });
    }
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("revisado").setLabel("Revisado").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("ausente").setLabel("Ausente").setStyle(ButtonStyle.Danger)
  );

  const botonesMsg = await message.channel.send({
    content: `📂 Replay recibido de <@${message.author.id}>. Esperando revisión.`,
    components: [row]
  });

  db.uploads[message.author.id] = {
    nombre: archivo.name,
    fecha: new Date().toISOString(),
    revisado: false,
    ausente: false,
    mensajeReplayId: message.id,
    mensajeBotonesId: botonesMsg.id
  };
  fs.writeFileSync("./db.json", JSON.stringify(db, null, 2));
});

client.login(DISCORD_TOKEN);

app.get("/", (req, res) => res.send("Bot activo"));
app.listen(PORT, () => console.log(`🌐 Servidor web activo en puerto ${PORT}`));
