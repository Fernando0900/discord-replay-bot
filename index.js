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


const app = express();
const PORT = process.env.PORT || 3000;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const OWNER_ID = "360974094457503744";
const COOLDOWN_DIAS = 45;

const { Pool } = require("pg");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // necesario para Render
  }
});

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
  new SlashCommandBuilder().setName("replay-status").setDescription("Consulta si puedes subir un nuevo replay."),
  new SlashCommandBuilder().setName("replay-reset").setDescription("Resetea el contador de replays de un usuario.")
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
    { name: "la sección suave 👄", type: 3 },
    { name: "tu replay 📂", type: 3 },
    { name: "dulces sueños 🔞", type: 3 },
    { name: "la sección infierno 💀", type: 3 }
  ];
  let estadoActual = 0;
  const actualizarEstado = () => {
    const estado = estados[estadoActual % estados.length];
    client.user.setPresence({ status: "online", activities: [estado] });
    estadoActual++;
  };
  actualizarEstado();
  setInterval(actualizarEstado, 5 * 60 * 1000); // cada 5 min
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
  const hasAdminRole = interaction.member?.roles?.cache?.some((role) => ["Admin", "Fundador"].includes(role.name));

  if (interaction.isChatInputCommand()) {
    const { commandName, user } = interaction;

    if (commandName === "replay-status") {
  await interaction.deferReply({ ephemeral: true });

  const { rows } = await pool.query("SELECT * FROM uploads WHERE user_id = $1", [user.id]);
  const replay = rows[0];

  if (!replay) {
    return interaction.editReply({ content: "✅ Aún no has subido ningún replay. ¡Puedes enviar uno ahora!" });
  }

  const tiempo = getTiempoRestante(replay.fecha);
  if (tiempo.dias > 0 || tiempo.horas > 0 || tiempo.minutos > 0) {
    return interaction.editReply({
      content: `⏳ <@${user.id}> faltan ${tiempo.dias}d ${tiempo.horas}h ${tiempo.minutos}min para que puedas subir otro replay`
    });
  }

  if (replay.revisado) {
    return interaction.editReply({ content: "✅ Tu replay fue revisado correctamente." });
  }

  if (replay.ausente) {
    return interaction.editReply({ content: "❌ Tu replay fue marcado como ausente." });
  }

  return interaction.editReply({ content: "⏳ Replay pendiente de revisión." });
}


    if (commandName === "replay-reset") {
      if (user.id !== OWNER_ID && !hasAdminRole) return interaction.reply({ content: "❌ No autorizado.", flags: 64 });
      await pool.query("DELETE FROM uploads WHERE user_id = $1", [user.id]);
      return interaction.reply({ content: "✅ Replay reseteado.", flags: 64 });
    }
  }

  if (interaction.isButton()) {
    const { customId, user, message } = interaction;
    if (user.id !== OWNER_ID) return interaction.reply({ content: "❌ Solo Skros puede usar estos botones.", flags: 64 });

    const userId = message.content.match(/<@(\d+)>/)?.[1];
    const { rows } = await pool.query("SELECT * FROM uploads WHERE user_id = $1", [userId]);
    const replay = rows[0];
    if (!replay) return interaction.reply({ content: "❌ Replay no encontrado.", flags: 64 });

    try {
      const replayMsg = await message.channel.messages.fetch(replay.mensaje_replay_id);
      if (customId === "revisado") {
        await pool.query("UPDATE uploads SET revisado = TRUE WHERE user_id = $1", [userId]);
        await replayMsg.react("✅");
      }
      if (customId === "ausente") {
        await pool.query("UPDATE uploads SET ausente = TRUE WHERE user_id = $1", [userId]);
        await replayMsg.react("❌");
      }
      if (replay.mensaje_botones_id) {
        const oldMsg = await message.channel.messages.fetch(replay.mensaje_botones_id).catch(() => null);
        if (oldMsg) await oldMsg.delete().catch(() => {});
      }
    } catch {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("revisado").setLabel("Revisado").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("ausente").setLabel("Ausente").setStyle(ButtonStyle.Danger)
      );
      const nuevoMsg = await message.channel.send({ content: `📂 Replay recibido de <@${userId}>. Esperando revisión.`, components: [row] });
      await pool.query("UPDATE uploads SET mensaje_botones_id = $1 WHERE user_id = $2", [nuevoMsg.id, userId]);
      return interaction.reply({ content: "⚠️ Botones regenerados.", flags: 64 });
    }

    await message.delete().catch(() => {});
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.attachments.size) return;
  const archivo = message.attachments.first();
  if (!archivo.name.endsWith(".SC2Replay")) return;

  const { rows } = await pool.query("SELECT * FROM uploads WHERE user_id = $1", [message.author.id]);
  const anterior = rows[0];
  if (anterior) {
    const tiempo = getTiempoRestante(anterior.fecha);
    if (tiempo.dias > 0 || tiempo.horas > 0 || tiempo.minutos > 0) {
      await message.delete();
      return message.channel.send({ content: `⏳ <@${message.author.id}> faltan ${tiempo.dias}d ${tiempo.horas}h ${tiempo.minutos}min para que puedas subir otro replay.` });

    }
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("revisado").setLabel("Revisado").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("ausente").setLabel("Ausente").setStyle(ButtonStyle.Danger)
  );

  const botonesMsg = await message.channel.send({ content: `📂 Replay recibido de <@${message.author.id}>. Esperando revisión.`, components: [row] });

  await pool.query(
    `INSERT INTO uploads (user_id, nombre, fecha, revisado, ausente, mensaje_replay_id, mensaje_botones_id)
     VALUES ($1, $2, $3, FALSE, FALSE, $4, $5)
     ON CONFLICT (user_id)
     DO UPDATE SET nombre = EXCLUDED.nombre, fecha = EXCLUDED.fecha, revisado = FALSE, ausente = FALSE, mensaje_replay_id = EXCLUDED.mensaje_replay_id, mensaje_botones_id = EXCLUDED.mensaje_botones_id`,
    [message.author.id, archivo.name, new Date().toISOString(), message.id, botonesMsg.id]
  );
});

client.login(DISCORD_TOKEN);
app.get("/", (req, res) => res.send("Bot activo"));
app.listen(PORT, () => console.log(`🌐 Servidor web activo en puerto ${PORT}`));
