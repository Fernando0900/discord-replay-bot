# 🤖 Discord Replay Bot

Bot de Discord que permite a los usuarios subir **1 replay (.SC2Replay)** por mes. 

## Funcionalidades
- Verificación automática del tipo de archivo.
- Restricción de 1 replay por usuario al mes.
- El bot responde por DM si el replay se rechaza.
- Administradores pueden resetear el contador con `!reset @usuario`.
- Comando `!replay-status` para ver cuándo se podrá volver a subir replay.

## Requisitos

- Node.js
- `.env` con:

```env
DISCORD_TOKEN=tu_token_aqui
CANAL_ID=tu_id_del_canal

Instalación
npm install
node index.js
