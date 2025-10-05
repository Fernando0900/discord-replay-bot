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
  PermissionFlagsBits
} = require("discord.js");
const express = require("express");
const { createClient } = require("@libsql/client");

const app = express();
const PORT = process.env.PORT || 3000;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const OWNER_ID = "360974094457503744";
const COOLDOWN_DIAS = 45;

// Channels where bot is allowed to operate
const BOT_ALLOW_CHANNELS = ["1389033193063321680", "1362639865446924308"];

const pool = createClient({
  url: process.env.DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error("❌ CLIENT_ID o DISCORD_TOKEN no están definidos en el archivo .env");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent // also enable in the Dev Portal
    // If later you need to check roles more reliably, add:
    // GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel]
});

/* ------------------------- Slash Commands (global) ------------------------- */
const commands = [
  new SlashCommandBuilder()
    .setName("replay-status")
    .setDescription("Consulta si puedes subir un nuevo replay."),
  new SlashCommandBuilder()
    .setName("replay-reset")
    .setDescription("Resetea el contador de replays de un usuario.")
    .addUserOption((opt) =>
      opt.setName("usuario").setDescription("Usuario a resetear").setRequired(true)
    )
    // default perms so only staff can see/use it by default
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
].map((c) => c.toJSON());

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
(async () => {
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("✅ Comandos registrados con éxito.");
  } catch (error) {
    console.error("❌ Error al registrar comandos:", error);
  }
})();

/* -------------------------------- Presence -------------------------------- */
client.once("ready", () => {
  console.log(`🤖 Bot conectado como ${client.user.tag}`);
  const estados = [
    { name: "la sección suave 👄", type: 3 },
    { name: "tu replay 📂", type: 3 },
    { name: "dulces sueños 🔞", type: 3 }
  ];
  let i = 0;
  const actualizar = () => {
    const estado = i % estados.length;
    client.user.setPresence({ status: "online", activities: [estados[estado]] });
    console.log(`Status actualizado a ${estados[estado.name]}`);
    i++;
  };
  actualizar();
  setInterval(actualizar, 5 * 60 * 1000);
});

/* --------------------------------- Helpers -------------------------------- */
function getTiempoRestante(fechaISO) {
  const ahora = Date.now();
  const anterior = new Date(fechaISO).getTime();
  const msRestantes = anterior + COOLDOWN_DIAS * 86400000 - ahora;
  if (msRestantes <= 0) return { dias: 0, horas: 0, minutos: 0 };
  const dias = Math.floor(msRestantes / 86400000);
  const horas = Math.floor((msRestantes % 86400000) / 3600000);
  const minutos = Math.floor((msRestantes % 3600000) / 60000);
  return { dias, horas, minutos };
}

function memberHasAdminRole(interaction) {
  // role name check (works without GuildMembers intent)
  return interaction.member?.roles?.cache?.some((role) =>
    ["Admin", "Fundador"].includes(role.name)
  );
}

/* ------------------------------ Interactions ------------------------------ */
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // Slash Commands
    if (interaction.isChatInputCommand()) {
      // channel allowlist guard
      if (!BOT_ALLOW_CHANNELS.includes(interaction.channelId)) {
        return interaction.reply({
          content: "❌ Este comando solo se puede usar en el canal <#1389033193063321680>.",
          ephemeral: true
        });
      }

      const { commandName, user, memberPermissions } = interaction;

      if (commandName === "replay-status") {
        await interaction.deferReply({ ephemeral: true });

        const result = await pool.execute({
          sql: "SELECT * FROM uploads WHERE user_id = ?",
          args: [user.id]
        });
        const replay = result.rows[0];

        if (!replay) {
          return interaction.editReply(
            "✅ Aún no has subido ningún replay. ¡Puedes enviar uno ahora!"
          );
        }

        const tiempo = getTiempoRestante(replay.fecha);
        if (tiempo.dias || tiempo.horas || tiempo.minutos) {
          return interaction.editReply(
            `⏳ <@${user.id}> faltan ${tiempo.dias}d ${tiempo.horas}h ${tiempo.minutos}min para que puedas subir otro replay.`
          );
        }

        if (replay.revisado)
          return interaction.editReply("✅ Tu replay fue revisado correctamente.");
        if (replay.ausente) return interaction.editReply("❌ Tu replay fue marcado como ausente.");
        return interaction.editReply("⏳ Replay pendiente de revisión.");
      }

      if (commandName === "replay-reset") {
        // Owner OR user with ManageGuild OR role names allowed
        const isOwner = user.id === OWNER_ID;
        const hasPerm =
          memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
          memberHasAdminRole(interaction);
        if (!isOwner && !hasPerm) {
          return interaction.reply({ content: "❌ No autorizado.", ephemeral: true });
        }

        const target = interaction.options.getUser("usuario", true);
        await pool.execute({ sql: "DELETE FROM uploads WHERE user_id = ?", args: [target.id] });
        return interaction.reply({
          content: `✅ Replay reseteado para <@${target.id}>.`,
          ephemeral: true
        });
      }
    }

    // Buttons
    if (interaction.isButton()) {
      const { customId, user, message } = interaction;
      if (user.id !== OWNER_ID) {
        return interaction.reply({
          content: "❌ Solo Skros puede usar estos botones.",
          ephemeral: true
        });
      }

      const userId = message.content.match(/<@(\d+)>/)?.[1];
      if (!userId) {
        return interaction.reply({
          content: "❌ No se pudo identificar el usuario.",
          ephemeral: true
        });
      }

      const result = await pool.execute({
        sql: "SELECT * FROM uploads WHERE user_id = ?",
        args: [userId]
      });
      const replay = result.rows[0];
      if (!replay)
        return interaction.reply({ content: "❌ Replay no encontrado.", ephemeral: true });

      try {
        const replayMsg = await message.channel.messages.fetch(replay.mensaje_replay_id);
        if (customId === "revisado") {
          await pool.execute({
            sql: "UPDATE uploads SET revisado = TRUE, ausente = FALSE WHERE user_id = ?",
            args: [userId]
          });
          await replayMsg.react("✅");
        } else if (customId === "ausente") {
          await pool.execute({
            sql: "UPDATE uploads SET ausente = TRUE, revisado = FALSE WHERE user_id = ?",
            args: [userId]
          });
          await replayMsg.react("❌");
        }

        if (replay.mensaje_botones_id) {
          const oldMsg = await message.channel.messages
            .fetch(replay.mensaje_botones_id)
            .catch(() => null);
          if (oldMsg) await oldMsg.delete().catch(() => {});
        }

        await interaction.reply({ content: "✅ Actualizado.", ephemeral: true });
      } catch (_err) {
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
        const nuevoMsg = await message.channel.send({
          content: `📂 Replay recibido de <@${userId}>. Esperando revisión.`,
          components: [row]
        });
        await pool.execute({
          sql: "UPDATE uploads SET mensaje_botones_id = ? WHERE user_id = ?",
          args: [nuevoMsg.id, userId]
        });
        return interaction.reply({ content: "⚠️ Botones regenerados.", ephemeral: true });
      }
    }
  } catch (err) {
    console.error("❌ Error en InteractionCreate:", err);
  }
});

/* ------------------------------ Message Create ----------------------------- */
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.attachments.size) return;
  if (!BOT_ALLOW_CHANNELS.includes(message.channelId)) return;

  const archivo = message.attachments.first();
  if (!archivo?.name?.endsWith?.(".SC2Replay")) return;

  try {
    const result = await pool.execute({
      sql: "SELECT * FROM uploads WHERE user_id = ?",
      args: [message.author.id]
    });
    const anterior = result.rows[0];

    if (anterior) {
      const tiempo = getTiempoRestante(anterior.fecha);
      if (tiempo.dias || tiempo.horas || tiempo.minutos) {
        await message.delete().catch(() => {});
        return message.channel.send({
          content: `⏳ <@${message.author.id}> faltan ${tiempo.dias}d ${tiempo.horas}h ${tiempo.minutos}min para que puedas subir otro replay.`
        });
      }
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("revisado")
        .setLabel("Revisado")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("ausente").setLabel("Ausente").setStyle(ButtonStyle.Danger)
    );

    const botonesMsg = await message.channel.send({
      content: `📂 Replay recibido de <@${message.author.id}>. Esperando revisión.`,
      components: [row]
    });

    await pool.execute({
      sql: `INSERT INTO uploads (user_id, nombre, fecha, revisado, ausente, mensaje_replay_id, mensaje_botones_id)
            VALUES (?, ?, ?, FALSE, FALSE, ?, ?)
            ON CONFLICT(user_id)
            DO UPDATE SET nombre = excluded.nombre,
                          fecha = excluded.fecha,
                          revisado = FALSE,
                          ausente = FALSE,
                          mensaje_replay_id = excluded.mensaje_replay_id,
                          mensaje_botones_id = excluded.mensaje_botones_id`,
      args: [message.author.id, archivo.name, new Date().toISOString(), message.id, botonesMsg.id]
    });
  } catch (err) {
    console.error("❌ Error en MessageCreate:", err);
  }
});

/* ------------------------------ Start & Harden ----------------------------- */
client.login(DISCORD_TOKEN);

app.get("/", (_req, res) => res.send("Bot activo"));
const server = app.listen(PORT, () => console.log(`🌐 Servidor web activo en puerto ${PORT}`));

process.on("SIGTERM", () => server.close());
process.on("unhandledRejection", (err) => console.error("UNHANDLED REJECTION:", err));
process.on("uncaughtException", (err) => console.error("UNCAUGHT EXCEPTION:", err));
