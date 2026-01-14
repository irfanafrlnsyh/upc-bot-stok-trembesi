// ==========================
// IMPORT MODULES
// ==========================
import makeWASocket, { useMultiFileAuthState } from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import fs from "fs";
import csv from "csv-parser";
import express from "express";

// ==========================
// 1. LOAD DATA CSV
// ==========================
const CSV_FILE = "./attached_assets/stok_1768363015007.csv";
const stockData = [];

if (fs.existsSync(CSV_FILE)) {
  fs.createReadStream(CSV_FILE)
    .pipe(csv())
    .on("data", (row) => {
      stockData.push({
        KODE_BARANG: row.KODE_BARANG,
        nama_barang: row.nama_barang,
        stok: row.STOK,
        satuan: row.SATUAN,
        lokasi: row.LOKASI,
        last_update: row.LAST_UPDATE
      });
    })
    .on("end", () => {
      console.log("✅ Data stok berhasil dimuat:", stockData.length);
    });
} else {
  console.error("❌ File CSV tidak ditemukan:", CSV_FILE);
}

// ==========================
// 2. HELPER FUNCTIONS
// ==========================
function normalize(text) {
  return text.toString().toLowerCase().trim().replace(/\s+/g, " ");
}

function findBestMatch(data, userInput) {
  const words = normalize(userInput).split(" ");
  return data
    .map(row => {
      const name = normalize(row.nama_barang);
      let score = 0;
      words.forEach(w => {
        if (name.includes(w)) score++;
      });
      return { ...row, score };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

// ==========================
// 3. START BOT
// ==========================
let isRunning = false;

async function startBot() {
  if (isRunning) return; // prevent double run
  isRunning = true;

  const { state, saveCreds } = await useMultiFileAuthState("auth");

  const sock = makeWASocket({
    auth: state,
    browser: ["StokBot", "Chrome", "1.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  // ==========================
  // QR HANDLER
  // ==========================
  sock.ev.on("connection.update", (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      qrcode.generate(qr, { small: true });
      console.log("📱 Scan QR WhatsApp");
    }

    if (connection === "open") {
      console.log("🤖 BOT SIAP & TERHUBUNG");
    }

    if (connection === "close") {
      console.log("❌ Koneksi terputus");
      if (lastDisconnect?.error?.output?.statusCode !== 401) {
        console.log("⏱ Tunggu 15 detik sebelum mencoba reconnect...");
        setTimeout(() => {
          isRunning = false;
          startBot();
        }, 15000);
      } else {
        console.log("⚠️ Session invalid, perlu scan QR lagi");
        isRunning = false;
      }
    }
  });

  // ==========================
  // MESSAGE HANDLER
  // ==========================
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
    if (!text) return;

    if (!text.toLowerCase().includes("@stok")) return;

    const keyword = text.toLowerCase().split("@stok")[1]?.trim();
    if (!keyword) {
      await sock.sendMessage(from, { text: 'Format: @stok nama_barang' });
      return;
    }

    const results = findBestMatch(stockData, keyword);

    let replyText = "";
    if (results.length === 0) {
      replyText = `❌ Barang "${keyword}" tidak ditemukan.`;
    } else if (results.length === 1) {
      const item = results[0];
      replyText =
        `📦 *${item.nama_barang}*\n` +
        `🔢 Kode: ${item.KODE_BARANG}\n` +
        `📊 Stok: *${item.stok} ${item.satuan}*\n` +
        `📍 Lokasi: ${item.lokasi}\n` +
        `⏱ Last update: ${item.last_update}`;
    } else {
      replyText =
        `🔎 Ditemukan ${results.length} barang untuk "${keyword}":\n` +
        results.map((r, i) =>
          `${i + 1}. ${r.nama_barang} (stok: ${r.stok} ${r.satuan}, lokasi: ${r.lokasi}, last update: ${r.last_update})`
        ).join("\n") +
        "\nKetik nama yang lebih spesifik.";
    }

    await sock.sendMessage(from, { text: replyText });
  });
}

// start bot pertama kali
startBot();

// ==========================
// 4. EXPRESS SERVER UNTUK KEEP-ALIVE
// ==========================
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("StokBot aktif! 🚀");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
