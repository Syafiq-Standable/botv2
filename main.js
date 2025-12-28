const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const cheerio = require('cheerio');
const { exec } = require('child_process');
const { ttdl, igdl, youtube } = require('btch-downloader');

// ============================================================
// KONFIGURASI AWAL & DEKLARASI PATH
// ============================================================

const FOLDER = path.join(__dirname, 'data');
const USERS_DB = path.join(FOLDER, 'users.json');
const BANNED_DB = path.join(FOLDER, 'banned.json');
const WELCOME_DB = path.join(FOLDER, 'welcome.json');
const RENTALS_DB = path.join(FOLDER, 'rentals.json');
const OPERATORS_DB = path.join(FOLDER, 'operators.json');
const MUTE_DB = path.join(FOLDER, 'muted.json');
const GROUPS_DB = path.join(FOLDER, 'groups.json');

// Buat folder data jika belum ada
try {
    if (!fs.existsSync(FOLDER)) fs.mkdirSync(FOLDER, { recursive: true });
} catch (e) {
    console.log('Gagal membuat folder data:', e.message);
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function addRental(groupId, groupName, days) {
    if (!fs.existsSync(RENTALS_DB)) fs.writeFileSync(RENTALS_DB, '[]');
    const rentals = JSON.parse(fs.readFileSync(RENTALS_DB));

    // VALIDASI: Pastikan days itu angka valid. Kalau aneh-aneh, paksa jadi 30 hari.
    let validDays = parseInt(days);
    if (isNaN(validDays) || validDays <= 0) validDays = 30;

    // Konversi hari ke milidetik
    const milliseconds = validDays * 24 * 60 * 60 * 1000;
    const expiredDate = Date.now() + milliseconds;

    const index = rentals.findIndex(r => r.id === groupId);
    if (index !== -1) {
        rentals[index].expired = expiredDate;
        rentals[index].name = groupName;
    } else {
        rentals.push({ id: groupId, name: groupName, expired: expiredDate });
    }
    fs.writeFileSync(RENTALS_DB, JSON.stringify(rentals, null, 2));
    return expiredDate;
}

function checkRental(groupId) {
    if (!fs.existsSync(RENTALS_DB)) return false;
    const rentals = JSON.parse(fs.readFileSync(RENTALS_DB));

    const index = rentals.findIndex(r => r.id === groupId);
    if (index === -1) return false;

    // VALIDASI: Kalau datanya rusak (null/NaN), jangan dihapus, anggap aktif dulu biar bisa diperbaiki owner
    if (!rentals[index].expired || isNaN(rentals[index].expired)) {
        return true; // Safe mode: Tetap izinkan
    }

    const now = Date.now();
    if (now > rentals[index].expired) {
        // Hapus hanya jika benar-benar expired
        rentals.splice(index, 1);
        fs.writeFileSync(RENTALS_DB, JSON.stringify(rentals, null, 2));
        return false;
    }

    return true;
}

function getRentalDays(groupId) {
    if (!fs.existsSync(RENTALS_DB)) return 0;
    const rentals = JSON.parse(fs.readFileSync(RENTALS_DB));
    const data = rentals.find(r => r.id === groupId);
    if (!data) return 0;

    // Kalau expirednya error/unlimited
    if (!data.expired) return 999;

    const timeLeft = data.expired - Date.now();
    if (timeLeft <= 0) return 0;

    return Math.ceil(timeLeft / (1000 * 60 * 60 * 24));
}

function getGroupSettings(groupId) {
    if (!fs.existsSync(GROUPS_DB)) fs.writeFileSync(GROUPS_DB, '[]');
    const groups = JSON.parse(fs.readFileSync(GROUPS_DB));
    const group = groups.find(g => g.id === groupId);
    // Default settings: mati semua
    if (!group) return { id: groupId, antilink: false, antitoxic: false };
    return group;
}

// Helper buat save database grup
function updateGroupSettings(groupId, setting, value) {
    if (!fs.existsSync(GROUPS_DB)) fs.writeFileSync(GROUPS_DB, '[]');
    const groups = JSON.parse(fs.readFileSync(GROUPS_DB));
    const index = groups.findIndex(g => g.id === groupId);

    if (index === -1) {
        // Kalau belum ada, bikin baru
        const newGroup = { id: groupId, antilink: false, antitoxic: false };
        newGroup[setting] = value;
        groups.push(newGroup);
    } else {
        // Update yang udah ada
        groups[index][setting] = value;
    }
    fs.writeFileSync(GROUPS_DB, JSON.stringify(groups, null, 2));
}

function loadJSON(filePath, defaultValue = {}) {
    try {
        if (!fs.existsSync(filePath)) return defaultValue;
        const raw = fs.readFileSync(filePath, 'utf8');
        return raw ? JSON.parse(raw) : defaultValue;
    } catch (e) {
        console.log(`Load error ${filePath}:`, e.message);
        return defaultValue;
    }
}

function saveJSON(filePath, data) {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.log(`Save error ${filePath}:`, e.message);
    }
}

async function listRentals(sock) {
    const rentals = loadRentals();
    const now = Date.now();
    const activeRentals = [];

    for (const jid in rentals) {
        const rental = rentals[jid];

        if (rental.expires <= now) continue; // Skip expired

        const timeLeft = rental.expires - now;
        const type = jid.endsWith('@g.us') ? 'Grup' : 'PC';
        let groupName = 'N/A';

        if (type === 'Grup') {
            try {
                const metadata = await sock.groupMetadata(jid).catch(() => null);
                groupName = metadata?.subject || 'Grup Tidak Dikenal';
            } catch (e) {
                groupName = 'Error: ' + e.message.substring(0, 50);
            }
        }

        activeRentals.push({
            jid,
            type,
            name: groupName,
            ...rental,
            duration: formatDuration(timeLeft),
            expiryDate: formatDate(rental.expires)
        });
    }

    return activeRentals;
}

// Database functions
const loadBans = () => loadJSON(BANNED_DB, {});
const saveBans = (data) => saveJSON(BANNED_DB, data);
const loadWelcome = () => loadJSON(WELCOME_DB, {});
const saveWelcome = (data) => saveJSON(WELCOME_DB, data);
const loadUsers = () => loadJSON(USERS_DB, {});
const saveUsers = (data) => saveJSON(USERS_DB, data);
const loadRentals = () => loadJSON(RENTALS_DB, {});
const saveRentals = (data) => saveJSON(RENTALS_DB, data);
const loadOperators = () => loadJSON(OPERATORS_DB, []);
const loadMuted = () => loadJSON(MUTE_DB, {});
const saveMuted = (data) => saveJSON(MUTE_DB, data);

function isOperator(senderJid) {
    if (!senderJid) return false;

    try {
        const list = loadOperators();
        const numericId = senderJid.split('@')[0];

        return list.some(op => {
            if (!op) return false;
            // Cek berbagai format
            const opStr = String(op).replace('@s.whatsapp.net', '');
            return opStr === numericId ||
                senderJid.includes(opStr) ||
                senderJid.endsWith(`${opStr}@s.whatsapp.net`);
        });
    } catch (e) {
        console.error('isOperator error:', e.message);
        return false;
    }
}

function isValidJid(jid) {
    const regex = /^(\d+@(s\.whatsapp\.net|g\.us))$/;
    return regex.test(jid);
}

function formatDate(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleDateString('id-ID', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

function formatDuration(ms) {
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    return `${days} hari ${hours} jam`;
}

function getRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

// ============================================================
// SISTEM SEWA (RENTAL)
// ============================================================

function normalizeJid(inputJid, context = 'auto') {
    let jid = inputJid.trim();

    // Jika sudah format lengkap, return langsung
    if (jid.includes('@')) return jid;

    // Tentukan jenis berdasarkan konteks atau panjang angka
    if (context === 'group' || jid.length >= 15) {
        return jid + '@g.us';
    } else if (context === 'private' || jid.length < 15) {
        return jid + '@s.whatsapp.net';
    } else {
        // Auto detect (15+ digit = grup, kurang = private)
        return jid + (jid.length >= 15 ? '@g.us' : '@s.whatsapp.net');
    }
}

function revokeRental(id) {
    const rentals = loadRentals();
    let deleted = false;

    // Coba hapus dengan berbagai format
    const formatsToTry = [
        id, // Format lengkap
        id.split('@')[0], // Tanpa domain
        id.includes('@g.us') ? id.replace('@g.us', '') : id.replace('@s.whatsapp.net', '') // Balik domain
    ];

    for (const format of formatsToTry) {
        if (rentals[format]) {
            console.log(`[REVOKE] Menghapus rental dengan format: ${format}`);
            delete rentals[format];
            deleted = true;
        }
    }

    if (deleted) {
        saveRentals(rentals);
        console.log(`[REVOKE SUCCESS] ${id} dihapus dari database`);
        return true;
    } else {
        console.log(`[REVOKE FAILED] ${id} tidak ditemukan di database`);
        return false;
    }
}

function grantRental(scope, id, tier, days, grantedBy, context = 'auto') {
    const rentals = loadRentals();

    // Normalisasi ID
    let normalizedId = id;
    if (!id.includes('@')) {
        normalizedId = normalizeJid(id, context);
    }

    // Handle existing rental (perpanjangan)
    let currentExpiryTime = Date.now();
    if (rentals[normalizedId] && rentals[normalizedId].expires > Date.now()) {
        currentExpiryTime = rentals[normalizedId].expires;
        console.log(`Memperpanjang sewa yang ada untuk: ${normalizedId}`);
    }

    const expires = currentExpiryTime + (Number(days) || 0) * 24 * 60 * 60 * 1000;

    // Auto-detect scope dari JID
    const autoScope = normalizedId.endsWith('@g.us') ? 'group' : 'private';

    rentals[normalizedId] = {
        scope: scope === 'MANUAL' ? autoScope : scope,
        tier: tier || 'premium',
        expires,
        grantedBy: grantedBy.includes('@') ? grantedBy.split('@')[0] : grantedBy,
        grantedAt: Date.now(),
        notified3days: false,
        notified1day: false,
        notifiedExpired: false
    };

    saveRentals(rentals);
    console.log(`[RENTAL GRANTED] ${normalizedId} - ${days} hari`);
    return rentals[normalizedId];
}

function getRental(jid) {
    try {
        // Load semua data rental
        const rentals = loadRentals();

        // 1. Coba dengan JID lengkap terlebih dahulu
        if (rentals[jid]) {
            const rentalData = rentals[jid];
            if (rentalData.expires > Date.now()) {
                return rentalData;
            }
        }

        // 2. Jika JID mengandung @, coba tanpa domain (fallback buat database lama)
        if (jid.includes('@')) {
            const jidWithoutDomain = jid.split('@')[0];
            if (rentals[jidWithoutDomain]) {
                const rentalData = rentals[jidWithoutDomain];
                if (rentalData.expires > Date.now()) {
                    return rentalData;
                }
            }
        }

        // 3. Cek kemungkinan format lain (manual matching)
        for (const key in rentals) {
            if (!key.includes('@')) {
                let possibleMatch = false;
                if (jid.endsWith('@g.us') && key === jid.replace('@g.us', '')) {
                    possibleMatch = true;
                } else if (jid.endsWith('@s.whatsapp.net') && key === jid.replace('@s.whatsapp.net', '')) {
                    possibleMatch = true;
                }

                if (possibleMatch) {
                    const rentalData = rentals[key];
                    if (rentalData.expires > Date.now()) {
                        return rentalData;
                    }
                }
            }
        }

        // 4. Tidak ditemukan atau sudah expired
        return false;
    } catch (e) {
        console.error('Error in getRental:', e.message);
        return false;
    }
}

const hasAccessForCommand = (command, isGroup, sender, groupId, sock) => {
    const senderId = sender.split('@')[0];

    // 1. Operator selalu lolos
    if (isOperator(senderId)) {
        return true;
    }

    // 2. Pengecekan Sewa
    if (isGroup) {
        return getRental(groupId);
    } else {
        return getRental(sender);
    }
};

// ============================================================
// FUNGSI BACKGROUND JOBS (Scheduler & Reminder)
// ============================================================

function setupBackgroundJobs(sock) {
    // Cache system untuk scheduler
    let schedulerCache = null;
    let lastCacheUpdate = 0;
    const CACHE_TTL = 60000;

    function getSchedulerData() {
        const now = Date.now();
        if (!schedulerCache || (now - lastCacheUpdate) > CACHE_TTL) {
            schedulerCache = loadJSON('scheduler.json', []);
            lastCacheUpdate = now;
        }
        return schedulerCache;
    }

    // Alarm scheduler
    let lastRun = "";
    setInterval(async () => {
        const now = new Date().toLocaleTimeString('en-GB', {
            hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta'
        });

        if (lastRun === now) return;

        let db = getSchedulerData();
        if (db.length === 0) return;

        let executed = false;
        for (let task of db) {
            if (task.time === now) {
                try {
                    const meta = await sock.groupMetadata(task.groupId);
                    const members = meta.participants.map(p => p.id);
                    await sock.sendMessage(task.groupId, {
                        text: `${task.message}\n\n_alarm otomatis dari SAM_`,
                        mentions: members
                    });
                    executed = true;
                } catch (e) {
                    console.log(`Gagal kirim alarm: ${e.message}`);
                }
            }
        }
        if (executed) lastRun = now;
    }, 30000);

    // Rental reminder
    setInterval(async () => {
        console.log('--- Running Daily Rental Reminder Check ---');
        const rentals = loadRentals();
        const now = Date.now();
        const reminderThreshold = 3 * 24 * 60 * 60 * 1000;

        for (const jid in rentals) {
            const rental = rentals[jid];

            if (rental.expires <= now) continue;

            const timeLeft = rental.expires - now;

            if (timeLeft <= reminderThreshold) {
                const duration = formatDuration(timeLeft);

                const reminderMessage = `
🔔 *PENGINGAT SEWA BOT SAM* 🔔
ID *${jid}* memiliki masa sewa yang akan *KEDALUWARSA*.
Sisa Waktu: *${duration}*
Tanggal Kedaluwarsa: ${formatDate(rental.expires)}

Segera perpanjang untuk menghindari bot terhenti!
Ketik *.sewa* untuk info perpanjangan.
`.trim();

                try {
                    await sock.sendMessage(jid, { text: reminderMessage });
                    console.log(`Sent rental reminder to: ${jid}`);
                } catch (e) {
                    console.log(`Gagal kirim reminder ke ${jid}: ${e.message}`);
                }
            }
        }
    }, 43200000);
}

// ============================================================
// FITUR DOWNLOADER .TT .IG .YTMP3 .YTMP4 .FB .X
// ============================================================

async function downloadInstagram(url, sock, from, msg) {
    await sock.sendMessage(from, { text: '⏳ Download Instagram...' }, { quoted: msg });
    try {
        // Menggunakan API Widipe
        const res = await axios.get(`https://widipe.com/download/igdl?url=${url}`);

        // Cek apakah ada hasilnya
        if (res.data && res.data.result && res.data.result.length > 0) {
            const videoUrl = res.data.result[0].url; // Ambil video pertama

            await sock.sendMessage(from, {
                video: { url: videoUrl },
                caption: '✅ Instagram Download'
            }, { quoted: msg });
        } else {
            throw new Error('Video tidak ditemukan');
        }
    } catch (error) {
        console.error('IG download error:', error.message);
        await sock.sendMessage(from, { text: '❌ Gagal download Instagram (Link private/Error).' }, { quoted: msg });
    }
}

// --- DOWNLOADER YOUTUBE (Pakai API Widipe) ---
async function downloadYouTube(url, sock, from, msg) {
    await sock.sendMessage(from, { text: '⏳ Download YouTube...' }, { quoted: msg });
    try {
        const res = await axios.get(`https://widipe.com/download/ytdl?url=${url}`);

        if (res.data && res.data.result && res.data.result.mp4) {
            const videoUrl = res.data.result.mp4;
            const title = res.data.result.title || 'YouTube Video';

            await sock.sendMessage(from, {
                video: { url: videoUrl },
                caption: `✅ ${title}`
            }, { quoted: msg });
        } else {
            throw new Error('Video tidak ditemukan');
        }
    } catch (error) {
        console.error('YouTube download error:', error.message);
        await sock.sendMessage(from, { text: '❌ Gagal download YouTube.' }, { quoted: msg });
    }
}

async function downloadTikTok(url, sock, from, msg) {
    await sock.sendMessage(from, { text: '⏳ Download TikTok...' }, { quoted: msg });
    try {
        const res = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`);
        if (res.data.code === 0) {
            const videoUrl = res.data.data.play;
            await sock.sendMessage(from, {
                video: { url: videoUrl },
                caption: '✅ TikTok Download'
            }, { quoted: msg });
        } else {
            throw new Error('Gagal download');
        }
    } catch (error) {
        console.error('TikTok download error:', error.message);
        await sock.sendMessage(from, { text: '❌ Gagal download TikTok.' }, { quoted: msg });
    }
}


// ============================================================
// FITUR STICKER
// ============================================================

async function createSticker(imageBuffer, sock, from, msg) {
    try {
        await sock.sendMessage(from, { text: '🔄 Buat sticker...' }, { quoted: msg });
        const sticker = await sharp(imageBuffer)
            .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .webp({ quality: 80 })
            .toBuffer();
        await sock.sendMessage(from, { sticker }, { quoted: msg });
    } catch (error) {
        console.error('Sticker error:', error.message);
        await sock.sendMessage(from, { text: '❌ Gagal buat sticker.' }, { quoted: msg });
    }
}

// ============================================================
// FITUR ANIME SEDERHANA
// ============================================================

async function getWaifu(sock, from, msg) {
    try {
        const res = await axios.get('https://api.waifu.pics/sfw/waifu');
        await sock.sendMessage(from, {
            image: { url: res.data.url },
            caption: '🌸 Random waifu~'
        }, { quoted: msg });
    } catch (error) {
        console.error('Waifu error:', error.message);
        await sock.sendMessage(from, { text: '❌ Gagal mendapatkan waifu.' }, { quoted: msg });
    }
}

async function getNeko(sock, from, msg) {
    try {
        const res = await axios.get('https://api.waifu.pics/sfw/neko');
        await sock.sendMessage(from, {
            image: { url: res.data.url },
            caption: '🐱 Neko girl~'
        }, { quoted: msg });
    } catch (error) {
        console.error('Neko error:', error.message);
        await sock.sendMessage(from, { text: '❌ Gagal mendapatkan neko.' }, { quoted: msg });
    }
}

// ============================================================
// FITUR UTILITY SEDERHANA
// ============================================================

async function generateQR(text, sock, from, msg) {
    try {
        const url = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(text)}`;
        await sock.sendMessage(from, {
            image: { url },
            caption: `📱 QR Code: ${text}`
        }, { quoted: msg });
    } catch (error) {
        console.error('QR error:', error.message);
        await sock.sendMessage(from, { text: '❌ Gagal membuat QR Code.' }, { quoted: msg });
    }
}

async function getPrayerTime(city, sock, from, msg) {
    try {
        const res = await axios.get(`https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}&country=Indonesia&method=8`);
        const t = res.data.data.timings;
        const text = `🕌 Jadwal Sholat ${city.toUpperCase()}\n\nSubuh: ${t.Fajr}\nDzuhur: ${t.Dhuhr}\nAshar: ${t.Asr}\nMaghrib: ${t.Maghrib}\nIsya: ${t.Isha}`;
        await sock.sendMessage(from, { text }, { quoted: msg });
    } catch (error) {
        console.error('Sholat error:', error.message);
        await sock.sendMessage(from, { text: '❌ Gagal ambil jadwal sholat.' }, { quoted: msg });
    }
}

function truthOrDare(type = 'truth') {
    const truths = [
        "Kapan terakhir kali kamu berbohong?",
        "Apa rahasia yang belum pernah kamu beritahu siapapun?",
        "Siapa crush kamu saat ini?",
        "Apa hal paling memalukan yang pernah terjadi padamu?",
        "Jika harus memilih antara uang dan cinta, mana yang kamu pilih?"
    ];

    const dares = [
        "Kirim pesan 'Aku sayang kamu' ke kontak terakhir di chat kamu",
        "Ubah nama WhatsApp kamu menjadi 'Aku Ganteng/Cantik' selama 1 jam",
        "Kirim foto selfie terjelek kamu ke grup",
        "Telepon crush kamu dan bilang 'Halo sayang'",
        "Post status WhatsApp dengan kata-kata 'Aku butuh pacar'"
    ];

    return type === 'truth' ? getRandom(truths) : getRandom(dares);
}

// ============================================================
// HANDLER GRUP
// ============================================================

function setupWelcomeHandler(sock) {
    sock.ev.on('group-participants.update', async (update) => {
        if (update.action !== 'add') return;

        const welcomes = loadWelcome();
        const caption = welcomes[update.id] || `Selamat datang di grup!\nSemoga betah ya! 🔥`;

        for (const user of update.participants) {
            try {
                const name = await sock.getName(user) || 'User';
                const finalCaption = caption.replace('$nama', name);
                await sock.sendMessage(update.id, { text: finalCaption });
            } catch (e) { }
        }
    });
}

function setupBanHandler(sock) {
    sock.ev.on('group-participants.update', async (update) => {
        const { id, participants, action } = update;
        if (action !== 'add') return;

        const bans = loadBans();
        if (!bans[id]) return;

        const toKick = participants.filter(p => bans[id].includes(p));
        if (toKick.length > 0) {
            try {
                await sock.groupParticipantsUpdate(id, toKick, 'remove');
            } catch (e) {
                console.log('Auto kick error:', e);
            }
        }
    });
}

// ============================================================
// MAIN BOT CONNECTION
// ============================================================

async function connectToWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

        const sock = makeWASocket({
            auth: state,
            version: [2, 3000, 1027934701],
            printQRInTerminal: true
        });

        setupWelcomeHandler(sock);
        setupBanHandler(sock);

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) qrcode.generate(qr, { small: true });

            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) {
                    console.log('Reconnecting...');
                    setTimeout(connectToWhatsApp, 3000);
                }
            } else if (connection === 'open') {
                console.clear();
                console.log(`
╔══════════════════════════════════════╗
║         BOT BERHASIL DIHIDUPKAN      ║
║         Made by Sukabyone            ║
╚══════════════════════════════════════╝
                `);
            }
        });

        sock.ev.on('creds.update', saveCreds);

        // Main message handler
        sock.ev.on('messages.upsert', async (m) => {
            try {
                const msg = m.messages[0];
                if (!msg || !msg.message) return;

                const from = msg.key.remoteJid;
                const groupId = from;
                const sender = msg.key.participant || from;
                const isGroup = from.endsWith('@g.us');
                const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';

                const text = (
                    msg.message?.conversation ||
                    msg.message?.extendedTextMessage?.text ||
                    msg.message?.imageMessage?.caption ||
                    msg.message?.videoMessage?.caption ||
                    ''
                ).trim();
                const textLower = text.toLowerCase();

                if (msg.key.fromMe && !text.startsWith('.')) return;

                // Sistem Mute
                const muted = loadMuted();
                if (isGroup && muted[from]?.includes(sender)) {
                    const groupMetadata = await sock.groupMetadata(from);
                    const participants = groupMetadata.participants;
                    const botAdmin = participants.find(p => p.id === botNumber)?.admin;

                    if (botAdmin) {
                        await sock.sendMessage(from, { delete: msg.key });
                    }
                    return;
                }

                // Update user record
                try {
                    const users = loadUsers();
                    const id = sender.split('@')[0];
                    const now = Date.now();

                    if (!users[id]) {
                        users[id] = {
                            jid: sender,
                            name: msg.pushName || '',
                            firstSeen: now,
                            count: 1
                        };
                    } else {
                        users[id].count = (users[id].count || 0) + 1;
                        if (msg.pushName) users[id].name = msg.pushName;
                        if (!users[id].firstSeen) users[id].firstSeen = now;
                    }
                    saveUsers(users);
                } catch (e) {
                    console.log('Update user error:', e.message);
                }

                // Anti banned user
                if (isGroup) {
                    const bans = loadBans();
                    if (bans[from]?.includes(sender)) {
                        try {
                            await sock.groupParticipantsUpdate(from, [sender], 'remove');
                        } catch (e) { }
                        return;
                    }
                }

                // ============================================================
                // LOGIKA SATPAM (MODERASI OTOMATIS)
                // ============================================================

                const isOp = isOperator(sender.split('@')[0]); // Cek status operator
                const groupSettings = isGroup ? getGroupSettings(from) : null; // Load database grup

                // 1. CEK ANTI-LINK
                if (isGroup && groupSettings?.antilink) {
                    if (text.includes('chat.whatsapp.com')) {
                        // Cek Admin/Bot Admin
                        const groupMetadata = await sock.groupMetadata(from);
                        const participants = groupMetadata.participants;
                        const botAdmin = participants.find(p => p.id === botNumber)?.admin;
                        const userAdmin = participants.find(p => p.id === sender)?.admin;

                        // Kalau User BUKAN Admin & BUKAN Operator, tapi Bot ADMIN -> Sikat
                        if (botAdmin && !userAdmin && !isOp) {
                            await sock.sendMessage(from, { delete: msg.key }); // Hapus pesan
                            await sock.sendMessage(from, {
                                text: `⚠️ Dilarang kirim link grup lain!`,
                                mentions: [sender]
                            });
                            return; // Stop proses biar command lain gak jalan
                        }
                    }
                }

                // 2. CEK ANTI-TOXIC
                if (isGroup && groupSettings?.antitoxic) {
                    const badwords = ['anjg', 'anjing', 'babi', 'monyet', 'kunyuk', 'bajingan', 'tolol', 'goblok', 'kontol', 'memek', 'ngentot'];

                    if (badwords.some(word => textLower.includes(word))) {
                        const groupMetadata = await sock.groupMetadata(from);
                        const participants = groupMetadata.participants;
                        const botAdmin = participants.find(p => p.id === botNumber)?.admin;
                        const userAdmin = participants.find(p => p.id === sender)?.admin;

                        if (botAdmin && !userAdmin && !isOp) {
                            await sock.sendMessage(from, { delete: msg.key }); // Hapus pesan
                            await sock.sendMessage(from, {
                                text: `⚠️ Mulutnya dijaga ya! (Auto Delete)`,
                                mentions: [sender]
                            });
                            return;
                        }
                    }
                }

                // Cek akses sewa
                const prefix = '.';
                if (!textLower.startsWith(prefix)) {
                    return;
                }

                const freeCommands = ['.sewa', '.ping', '.help', '.menu', '.profile', '.ceksewa'];
                const commandUtama = textLower.split(' ')[0];
                const isFreeCommand = freeCommands.some(freeCmd => commandUtama === freeCmd);

                if (!isFreeCommand) {
                    if (!hasAccessForCommand(commandUtama, isGroup, sender, groupId, sock)) {
                        let replyText = isGroup
                            ? `❌ Grup ini belum menyewa bot!\nKetik .sewa untuk info penyewaan.`
                            : `❌ Anda belum menyewa bot!\nKetik .sewa untuk info penyewaan.`;

                        await sock.sendMessage(from, { text: replyText });
                        return;
                    }
                }

                // ============================================
                // COMMAND HANDLER
                // ============================================

                if (textLower === '.ceksewa') {
                    const idToCheck = isGroup ? groupId : sender;
                    const access = getRental(idToCheck);

                    let replyText;
                    if (access) {
                        const remainingMs = access.expires - Date.now();
                        const duration = formatDuration(remainingMs);

                        replyText = `✅ *STATUS SEWA*\n\n`;
                        replyText += `ID: ${idToCheck}\n`;
                        replyText += `Scope: ${access.scope.toUpperCase()}\n`;
                        replyText += `Tier: ${access.tier}\n`;
                        replyText += `Expired: ${formatDate(access.expires)}\n`;
                        replyText += `Sisa Waktu: ${duration}\n\n`;
                        replyText += `_Terima kasih sudah menyewa BOT SAM!_`;

                    } else {
                        replyText = isGroup
                            ? `❌ Grup ini *belum* memiliki akses sewa.\nKetik .sewa untuk info penyewaan.`
                            : `❌ Anda *belum* memiliki akses sewa.\nKetik .sewa untuk info penyewaan.`;
                    }

                    await sock.sendMessage(from, { text: replyText }, { quoted: msg });
                    return;
                }

                if (textLower === '.menu' || textLower === '.help') {
                    const userNama = msg.pushName || 'User';
                    const menuText = `
*SAM* — _v1.2 (Stable)_
━━━━━━━━━━━━━━

*USER:* ${userNama.toUpperCase()}
*MODE:* ${isGroup ? 'Group Chat' : 'Private Chat'}

*— MEDIA TOOLS*
.tt        (tiktok)
.ig        (instagram)
.s         (stiker)
.qrgen     (kode qr)

*— GROUP ADMIN*
.h         (hidetag)
.tagall    (mention all)
.kick      (keluarkan)
.ban       (blokir)
.mute      (bungkam)
.setname   (ganti nama)
.setdesc   (ganti deskripsi)
.opengroup (buka grup)
.closegroup (tutup grup)

*— SCHEDULER (ALARM)*
.setalarm  (set jam|pesan)
.listalarm (cek jadwal)
.delalarm  (hapus jadwal)

*— OPERATOR ONLY*
.addrent   (tambah sewa)
.delrent   (hapus sewa)

*— HIBURAN & LAINNYA*
.truth     .waifu
.dare      .neko
.sholat    (jadwal)

*— INFO SYSTEM*
.profile   .ping
.sewa      .help
.ceksewa   .cekidgroup

━━━━━━━━━━━━━━
_Managed by Sukabyone_
*BOT SAM* — _Tuff & Reliable_
`.trim();

                    await sock.sendMessage(from, { text: menuText }, { quoted: msg });
                    return;
                }

                if (textLower === '.ping') {
                    const start = Date.now();
                    await sock.sendMessage(from, { text: '🏓 Pong!' });
                    const latency = Date.now() - start;
                    await sock.sendMessage(from, {
                        text: `⚡ Latency: ${latency}ms\n🕐 Uptime: ${process.uptime().toFixed(2)}s`
                    });
                    return;
                }

                if (textLower.startsWith('.tt ')) {
                    const url = text.split(' ')[1];
                    if (!url.includes('tiktok')) {
                        return sock.sendMessage(from, { text: '❌ Link TikTok tidak valid!' }, { quoted: msg });
                    }
                    await downloadTikTok(url, sock, from, msg);
                    return;
                }

                // 2. INSTAGRAM
                if (textLower.startsWith('.ig') || textLower.startsWith('.instagram')) {
                    const url = text.split(' ')[1];
                    if (!url) return sock.sendMessage(from, { text: 'Mana linknya?' }, { quoted: msg });

                    // Panggil fungsi khusus Instagram
                    await downloadInstagram(url, sock, from, msg);
                    return;
                }

                // 3. YOUTUBE
                if (textLower.startsWith('.yt') || textLower.startsWith('.youtube')) {
                    const url = text.split(' ')[1];
                    if (!url) return sock.sendMessage(from, { text: 'Mana linknya?' }, { quoted: msg });

                    // Panggil fungsi khusus YouTube
                    await downloadYouTube(url, sock, from, msg);
                    return;
                }

                if (textLower === '.sticker' || textLower === '.s') {
                    const imgMsg = msg.message?.imageMessage ||
                        msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;

                    if (!imgMsg) {
                        return sock.sendMessage(from, { text: '❌ Kirim atau reply gambar dengan caption .sticker' }, { quoted: msg });
                    }

                    try {
                        const stream = await downloadContentFromMessage(imgMsg, 'image');
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) {
                            buffer = Buffer.concat([buffer, chunk]);
                        }
                        await createSticker(buffer, sock, from, msg);
                    } catch (error) {
                        console.error('Sticker error:', error.message);
                        await sock.sendMessage(from, { text: '❌ Gagal membuat sticker.' }, { quoted: msg });
                    }
                    return;
                }

                if (textLower === '.waifu') {
                    await getWaifu(sock, from, msg);
                    return;
                }

                if (textLower === '.neko') {
                    await getNeko(sock, from, msg);
                    return;
                }

                if (textLower === '.truth') {
                    const truth = truthOrDare('truth');
                    await sock.sendMessage(from, { text: `🤔 *TRUTH*\n\n${truth}` }, { quoted: msg });
                    return;
                }

                if (textLower === '.dare') {
                    const dare = truthOrDare('dare');
                    await sock.sendMessage(from, { text: `😈 *DARE*\n\n${dare}` }, { quoted: msg });
                    return;
                }

                if (textLower.startsWith('.qrgen ')) {
                    const data = text.split(' ').slice(1).join(' ');
                    if (!data) {
                        return sock.sendMessage(from, { text: '❌ Format: .qrgen [teks]' }, { quoted: msg });
                    }
                    await generateQR(data, sock, from, msg);
                    return;
                }

                if (textLower.startsWith('.sholat ')) {
                    const city = text.split(' ').slice(1).join(' ');
                    if (!city) {
                        return sock.sendMessage(from, { text: '❌ Format: .sholat [kota]' }, { quoted: msg });
                    }
                    await getPrayerTime(city, sock, from, msg);
                    return;
                }

                if (textLower === '.sewa') {
                    const promoText = `
*SAM* — _Sewa BOT Pricelist!_
━━━━━━━━━━━━━━━━━━

*CUSTOM FEATURE*
Mulai dari — 50k
_Punya ide BOT sendiri agar grup makin seru atau tertib? Silakan diskusikan, saya buatkan khusus untuk grup Anda._

*GROUP PASS*
7 Hari    —  10k
15 Hari   —  15k
30 Hari   —  20k
90 Hari   —  50k

*PRIVATE PASS*
30 Hari   —  35k
_Privasi total. Tanpa antrean. Respon prioritas._

*CAPABILITIES*
— *Security:* Mute System (Silent target), Anti-Link, Auto-Kick Banned.
— *Group Tools:* Hidetag (Ghost mention), Tagall, Kick/Ban, Promote/Demote.
— *Essentials:* Sticker maker, ToImage, Profile & Chat counter.
— *System:* 24/7 Active, Zero Delay, No Ads.

*KONTAK*
wa.me/6289528950624
━━━━━━━━━━━━━━━━━━
*OWNER: SUKABYONE*
`.trim();

                    await sock.sendMessage(from, { text: promoText });
                    return;
                }



                if (textLower === '.profile') {
                    try {
                        const users = loadUsers();
                        const id = sender.split('@')[0];
                        const user = users[id] || { name: 'Unknown', count: 0, firstSeen: Date.now() };

                        let profileText = `👤 *PROFILE*\n\n`;
                        profileText += `📛 Nama: ${user.name}\n`;
                        profileText += `📞 Nomor: ${id}\n`;
                        profileText += `📊 Total Chat: ${user.count}\n`;
                        profileText += `📅 Bergabung: ${formatDate(user.firstSeen)}\n`;

                        await sock.sendMessage(from, { text: profileText });
                    } catch (error) {
                        console.error('Profile error:', error.message);
                        await sock.sendMessage(from, { text: '❌ Gagal mendapatkan profile.' });
                    }
                    return;
                }

                // ============================================================
                // COMMAND: .hd (Convert Document Video to HD Video)
                // ============================================================
                if (textLower === '.hd') {
                    try {
                        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                        const doc = msg.message?.documentWithCaptionMessage?.message?.documentMessage ||
                            msg.message?.documentMessage ||
                            quoted?.documentMessage ||
                            quoted?.documentWithCaptionMessage?.message?.documentMessage;

                        if (!doc) return sock.sendMessage(from, { text: '❌ Mana file videonya ngab?' });
                        if (!doc.mimetype.includes('video')) return sock.sendMessage(from, { text: '❌ Harus format video ya!' });

                        // Langsung kirim status proses
                        await sock.sendMessage(from, { text: '⏳ *BOT SAM* sedang memproses HD...' }, { quoted: msg });

                        // OPTIMASI: Pakai Array untuk kumpulin chunk (lebih cepat dari Buffer.concat di dalam loop)
                        const stream = await downloadContentFromMessage(doc, 'document');
                        let chunks = [];
                        for await (const chunk of stream) {
                            chunks.push(chunk);
                        }
                        const finalBuffer = Buffer.concat(chunks);

                        if (finalBuffer.length === 0) throw new Error('Buffer kosong');

                        // KIRIM BALIK
                        await sock.sendMessage(from, {
                            video: finalBuffer,
                            caption: '✅ *Video HD Sukses!*',
                            mimetype: 'video/mp4'
                        }, { quoted: msg });

                        // Bersihkan memori
                        chunks = [];
                    } catch (err) {
                        console.error('Error Fitur HD:', err);
                        await sock.sendMessage(from, { text: '❌ Gagal. Coba upload ulang filenya terus ketik .hd lagi.' });
                    }
                }

                // GROUP COMMANDS
                if (isGroup) {
                    // 1. Ambil Metadata Grup
                    const groupMetadata = await sock.groupMetadata(from);
                    const participants = groupMetadata.participants;

                    // 2. Teknik Pencocokan (Number Only)
                    const myNumber = sock.user.id.split(':')[0].split('@')[0];
                    const senderNumber = sender.split(':')[0].split('@')[0];

                    const botParticipant = participants.find(p => p.id.includes(myNumber));
                    const senderParticipant = participants.find(p => p.id.includes(senderNumber));

                    // 3. Status Admin (Pakai ?. biar aman)
                    const isBotAdmin = botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin';
                    const isUserAdmin = senderParticipant?.admin === 'admin' || senderParticipant?.admin === 'superadmin';

                    // Cek Operator
                    const isOp = isOperator(senderNumber);

                    // ============================================================
                    // LOGIKA SATPAM (ACTION DELETE)
                    // ============================================================
                    const groupSettings = getGroupSettings(from);

                    // --- ANTI LINK ---
                    if (groupSettings?.antilink) {
                        if (text.includes('chat.whatsapp.com')) {
                            // Cek Admin (Supaya Admin/Op gak kena hapus)
                            if (!isUserAdmin && !isOp) {
                                // Coba hapus (Pakai Try-Catch biar kalau bukan admin gak crash)
                                if (isBotAdmin) {
                                    await sock.sendMessage(from, { delete: msg.key });
                                    await sock.sendMessage(from, { text: `⚠️ @${senderNumber} Jangan share link grup lain!`, mentions: [sender] });
                                } else {
                                    // Kalau bot ternyata belum admin, diem aja atau kasih tau owner (optional)
                                    // console.log('Gagal hapus link: Bot bukan admin');
                                }
                            }
                        }
                    }

                    // --- ANTI TOXIC ---
                    if (groupSettings?.antitoxic) {
                        const badwords = ['anjg', 'anjing', 'babi', 'monyet', 'kunyuk', 'bajingan', 'tolol', 'goblok', 'kontol', 'memek', 'ngentot'];
                        if (badwords.some(word => textLower.includes(word))) {
                            if (!isUserAdmin && !isOp) {
                                if (isBotAdmin) {
                                    await sock.sendMessage(from, { delete: msg.key });
                                    await sock.sendMessage(from, { text: `⚠️ @${senderNumber} Toxic terdeteksi!`, mentions: [sender] });
                                }
                            }
                        }
                    }

                    // ============================================================
                    // COMMAND MODERASI (ADMIN ONLY)
                    // ============================================================

                    // --- COMMAND ANTI LINK ---
                    if (textLower.startsWith('.antilink')) {
                        // Cek user admin atau operator
                        if (!isUserAdmin && !isOp) return sock.sendMessage(from, { text: '❌ Ente bukan Admin Grup!' }, { quoted: msg });

                        const args = text.split(' ')[1];
                        if (args === 'on') {
                            updateGroupSettings(from, 'antilink', true);

                            // DISINI PERUBAHANNYA: Kita HAPUS syarat bot harus admin. 
                            // Kita cuma kasih peringatan kalau bot belum sadar dia admin.
                            let warning = '';
                            if (!isBotAdmin) warning = '\n\n⚠️ *Note:* Sistem mendeteksi Bot belum Admin. Pastikan Bot sudah jadi Admin ya biar work!';

                            await sock.sendMessage(from, { text: `🛡️ Anti-Link AKTIF!${warning}` }, { quoted: msg });

                        } else if (args === 'off') {
                            updateGroupSettings(from, 'antilink', false);
                            await sock.sendMessage(from, { text: '🛡️ Anti-Link MATI.' }, { quoted: msg });
                        } else {
                            await sock.sendMessage(from, { text: 'Ketik: .antilink on atau .antilink off' }, { quoted: msg });
                        }
                        return;
                    }

                    // --- COMMAND ANTI TOXIC ---
                    if (textLower.startsWith('.antitoxic')) {
                        if (!isUserAdmin && !isOp) return sock.sendMessage(from, { text: '❌ Ente bukan Admin Grup!' }, { quoted: msg });

                        const args = text.split(' ')[1];
                        if (args === 'on') {
                            updateGroupSettings(from, 'antitoxic', true);

                            let warning = '';
                            if (!isBotAdmin) warning = '\n\n⚠️ *Note:* Sistem mendeteksi Bot belum Admin. Pastikan Bot sudah jadi Admin ya biar work!';

                            await sock.sendMessage(from, { text: `🤬 Anti-Toxic AKTIF!${warning}` }, { quoted: msg });
                        } else if (args === 'off') {
                            updateGroupSettings(from, 'antitoxic', false);
                            await sock.sendMessage(from, { text: '🤬 Anti-Toxic MATI.' }, { quoted: msg });
                        } else {
                            await sock.sendMessage(from, { text: 'Ketik: .antitoxic on atau .antitoxic off' }, { quoted: msg });
                        }
                        return;
                    }



                    if (textLower === '.cekidgroup') {
                        const idGroupText = `🌐 *ID GRUP*\n\nID: ${from}\n_Gunakan ID ini untuk keperluan sewa atau operator._`;
                        await sock.sendMessage(from, { text: idGroupText }, { quoted: msg });
                        return;
                    }

                    if (textLower.startsWith('.hidetag') || textLower === '.h') {
                        if (!isUserAdmin && !isOperator(sender)) {
                            return sock.sendMessage(from, { text: '❌ Hanya admin/operator yang bisa pakai ini, Bos!' });
                        }

                        const teks = text.slice(9) || 'Panggilan untuk warga grup! 📢';
                        await sock.sendMessage(from, {
                            text: teks,
                            mentions: participants.map(p => p.id)
                        });
                        return;
                    }

                    // ALARM COMMANDS
                    if (textLower.startsWith('.setalarm')) {
                        if (!isUserAdmin && !isOperator(sender)) return;

                        if (text.trim() === '.setalarm') {
                            return sock.sendMessage(from, {
                                text: `⚠️ *FORMAT SALAH, BOS!*\n\nPenggunaan:\n*.setalarm Jam | Pesan*\nContoh:\n.setalarm 07:00 | Waktunya bangun!\n_Note: Pake format 24 jam ya._`
                            });
                        }

                        const input = text.slice(10).split('|');
                        if (input.length < 2) {
                            return sock.sendMessage(from, {
                                text: `❌ *DATA KURANG LENGKAP!*\n\nJangan lupa kasih pembatas garis tegak (|) antara jam dan pesannya.\nContoh: .setalarm 12:00 | Makan siang!`
                            });
                        }

                        const time = input[0].trim();
                        const msgAlarm = input[1].trim();

                        if (!/^\d{2}:\d{2}$/.test(time)) {
                            return sock.sendMessage(from, {
                                text: `🕒 *FORMAT JAM SALAH!*\n\nPake format HH:mm (Contoh: 07:05 atau 21:00).`
                            });
                        }

                        try {
                            let db = loadJSON('scheduler.json', []);
                            db.push({
                                id: Date.now(),
                                groupId: from,
                                time: time,
                                message: msgAlarm
                            });
                            saveJSON('scheduler.json', db);

                            await sock.sendMessage(from, {
                                text: `✅ *ALARM BERHASIL DISET!*\n\n⏰ Jam: ${time}\n📝 Pesan: ${msgAlarm}`
                            });
                        } catch (e) {
                            console.log('Error setalarm:', e.message);
                            await sock.sendMessage(from, { text: '❌ Waduh, sistem database lagi error nih, Bos.' });
                        }
                    }

                    if (textLower.startsWith('.delalarm ')) {
                        if (!isUserAdmin && !isOperator(sender)) return;

                        const index = parseInt(text.split(' ')[1]) - 1;
                        if (isNaN(index)) return sock.sendMessage(from, { text: 'Masukin nomornya, Bos. Contoh: .delalarm 1' });

                        let db = loadJSON('scheduler.json', []);
                        let groupTasks = db.filter(item => item.groupId === from);

                        if (index < 0 || index >= groupTasks.length) {
                            return sock.sendMessage(from, { text: 'Nomor alarm nggak ketemu.' });
                        }

                        const targetId = groupTasks[index].id;
                        let newDb = db.filter(item => item.id !== targetId);
                        saveJSON('scheduler.json', newDb);

                        await sock.sendMessage(from, { text: `✅ Alarm nomor ${index + 1} berhasil dihapus!` });
                        return;
                    }

                    if (textLower === '.listalarm') {
                        let db = loadJSON('scheduler.json', []);
                        let groupTasks = db.filter(item => item.groupId === from);

                        if (groupTasks.length === 0) {
                            return sock.sendMessage(from, { text: 'Belum ada alarm yang di-set buat grup ini, Bos.' });
                        }

                        let listText = `⏰ *DAFTAR ALARM GRUP*\n\n`;
                        groupTasks.forEach((task, i) => {
                            listText += `${i + 1}. [${task.time}] - ${task.message}\n`;
                        });
                        listText += `\n_Hapus pake: .delalarm [nomor]_`;

                        await sock.sendMessage(from, { text: listText });
                        return;
                    }

                    if (textLower.startsWith('.h ')) {
                        if (!isUserAdmin && !isOperator(sender)) return;

                        const pesan = text.slice(3).trim();
                        if (!pesan) return;

                        await sock.sendMessage(from, {
                            text: pesan,
                            mentions: participants.map(p => p.id)
                        });
                    }

                    if (textLower === '.tagall') {
                        if (!isUserAdmin && !isOperator(sender)) {
                            return sock.sendMessage(from, { text: '❌ Hanya admin/operator!' });
                        }

                        let tagText = '📢 *TAG ALL*\n\n';
                        participants.forEach((p, i) => {
                            tagText += `${i + 1}. @${p.id.split('@')[0]}\n`;
                        });

                        await sock.sendMessage(from, {
                            text: tagText,
                            mentions: participants.map(p => p.id)
                        });
                        return;
                    }

                    if (textLower.startsWith('.kick')) {
                        if (!isUserAdmin || !isBotAdmin) {
                            return sock.sendMessage(from, { text: '❌ Bot dan user harus admin!' });
                        }

                        let targets = [];
                        const ext = msg.message?.extendedTextMessage;

                        if (ext?.contextInfo?.mentionedJid) {
                            targets = ext.contextInfo.mentionedJid;
                        }

                        if (targets.length === 0) {
                            return sock.sendMessage(from, { text: '❌ Tag member yang ingin dikick!' });
                        }

                        try {
                            await sock.groupParticipantsUpdate(from, targets, 'remove');
                            await sock.sendMessage(from, {
                                text: `✅ Berhasil mengkick ${targets.length} member!`
                            });
                        } catch (e) {
                            await sock.sendMessage(from, { text: `❌ Gagal: ${e.message}` });
                        }
                        return;
                    }

                    if (textLower.startsWith('.ban ')) {
                        if (!isUserAdmin || !isBotAdmin) {
                            return sock.sendMessage(from, { text: '❌ Bot dan user harus admin!' });
                        }

                        let target = null;
                        if (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length) {
                            target = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
                        }

                        if (!target) {
                            return sock.sendMessage(from, { text: '❌ Tag member yang ingin diban!' });
                        }

                        try {
                            await sock.groupParticipantsUpdate(from, [target], 'remove');
                            const bans = loadBans();
                            if (!bans[from]) bans[from] = [];
                            if (!bans[from].includes(target)) {
                                bans[from].push(target);
                                saveBans(bans);
                            }

                            await sock.sendMessage(from, {
                                text: `✅ @${target.split('@')[0]} berhasil dibanned!`,
                                mentions: [target]
                            });
                        } catch (e) {
                            await sock.sendMessage(from, { text: `❌ Gagal: ${e.message}` });
                        }
                        return;
                    }

                    if (textLower.startsWith('.mute')) {
                        if (!isUserAdmin && !isOperator(sender)) return;

                        let target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                        if (!target && msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
                            target = msg.message.extendedTextMessage.contextInfo.participant;
                        }

                        if (!target) return sock.sendMessage(from, { text: 'Tag targetnya, Bos.' });

                        const muted = loadMuted();
                        if (!muted[from]) muted[from] = [];
                        if (!muted[from].includes(target)) {
                            muted[from].push(target);
                            saveMuted(muted);
                        }

                        await sock.sendMessage(from, { text: `🤐 @${target.split('@')[0]} has been silenced.`, mentions: [target] });
                        return;
                    }

                    if (textLower.startsWith('.unmute')) {
                        if (!isUserAdmin && !isOperator(sender)) return;

                        let target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                        if (!target) return;

                        const muted = loadMuted();
                        if (muted[from]) {
                            muted[from] = muted[from].filter(id => id !== target);
                            saveMuted(muted);
                        }

                        await sock.sendMessage(from, { text: `🔊 @${target.split('@')[0]} can speak again.`, mentions: [target] });
                        return;
                    }

                    if (textLower.startsWith('.promote') || textLower.startsWith('.demote')) {
                        if (!isUserAdmin || !isBotAdmin) {
                            return sock.sendMessage(from, { text: '❌ Bot dan user harus admin!' });
                        }

                        let targets = [];
                        const ext = msg.message?.extendedTextMessage;

                        if (ext?.contextInfo?.mentionedJid) {
                            targets = ext.contextInfo.mentionedJid;
                        }

                        if (targets.length === 0) {
                            return sock.sendMessage(from, { text: '❌ Tag member!' });
                        }

                        const action = textLower.startsWith('.promote') ? 'promote' : 'demote';

                        try {
                            await sock.groupParticipantsUpdate(from, targets, action);
                            await sock.sendMessage(from, {
                                text: `✅ Berhasil ${action} ${targets.length} member!`
                            });
                        } catch (e) {
                            await sock.sendMessage(from, { text: `❌ Gagal: ${e.message}` });
                        }
                        return;
                    }

                    if (textLower === '.opengroup') {
                        if (!isUserAdmin || !isBotAdmin) {
                            return sock.sendMessage(from, { text: '❌ Bot dan user harus admin grup!' });
                        }

                        try {
                            await sock.groupSettingUpdate(from, 'not_announcement');
                            await sock.sendMessage(from, { text: '✅ Grup berhasil *DIBUKA*! Semua member kini bisa mengirim pesan.' });
                        } catch (e) {
                            await sock.sendMessage(from, { text: `❌ Gagal membuka grup: ${e.message}` });
                        }
                        return;
                    }

                    if (textLower === '.closegroup') {
                        if (!isUserAdmin || !isBotAdmin) {
                            return sock.sendMessage(from, { text: '❌ Bot dan user harus admin grup!' });
                        }

                        try {
                            await sock.groupSettingUpdate(from, 'announcement');
                            await sock.sendMessage(from, { text: '✅ Grup berhasil *DITUTUP*! Hanya admin yang bisa mengirim pesan.' });
                        } catch (e) {
                            await sock.sendMessage(from, { text: `❌ Gagal menutup grup: ${e.message}` });
                        }
                        return;
                    }

                    if (textLower.startsWith('.setname ')) {
                        if (!isUserAdmin || !isBotAdmin) {
                            return sock.sendMessage(from, { text: '❌ Bot dan user harus admin!' });
                        }

                        const newName = text.slice(9);
                        if (!newName || newName.length > 25) {
                            return sock.sendMessage(from, { text: '❌ Nama grup maksimal 25 karakter!' });
                        }

                        try {
                            await sock.groupUpdateSubject(from, newName);
                            await sock.sendMessage(from, { text: `✅ Nama grup berhasil diubah!` });
                        } catch (e) {
                            await sock.sendMessage(from, { text: `❌ Gagal: ${e.message}` });
                        }
                        return;
                    }

                    if (textLower.startsWith('.remind')) {
                        const input = text.split(' ');
                        if (input.length < 3) return sock.sendMessage(from, { text: 'Format: .remind [durasi][s/m/h] [pesan]\nContoh: .remind 10m jemput adek' });

                        const timeStr = input[1];
                        const message = text.slice(text.indexOf(timeStr) + timeStr.length).trim();

                        const duration = parseInt(timeStr);
                        let ms = 0;
                        if (timeStr.endsWith('s')) ms = duration * 1000;
                        else if (timeStr.endsWith('m')) ms = duration * 60 * 1000;
                        else if (timeStr.endsWith('h')) ms = duration * 60 * 60 * 1000;
                        else return sock.sendMessage(from, { text: 'Pake s/m/h Bos (Contoh: 10m)' });

                        await sock.sendMessage(from, { text: `✅ Oke, SAM bakal ingetin "${message}" dalam ${timeStr}.` });

                        setTimeout(async () => {
                            await sock.sendMessage(from, {
                                text: `⏰ *REMINDER:* ${message}\n\nHey @${sender.split('@')[0]}, waktunya tiba!`,
                                mentions: [sender]
                            });
                        }, ms);
                    }
                }

                // ============================================
                // OPERATOR COMMANDS
                // ============================================

                const command = textLower.split(' ')[0];
                const senderId = sender.split('@')[0];

                if (isOperator(senderId)) {
                    switch (command) {
                        case prefix + 'listrent':
                        case prefix + 'ceksewaall':
                            const activeRentals = await listRentals(sock);

                            if (activeRentals.length === 0) {
                                await sock.sendMessage(from, { text: 'Bot lagi *santai*. Belum ada yang aktif sewa saat ini.' }, { quoted: msg });
                                return;
                            }

                            let listText = '📄 *CATATAN OPERATOR* 📄\n_Hanya untuk internal._\n\n';

                            activeRentals.forEach((r, i) => {
                                const nameDisplay = r.type === 'Grup' ? ` (${r.name})` : '';
                                listText += `*${i + 1}. ${r.type}${nameDisplay}*:\n`;
                                listText += ` > ID: ${r.jid}\n`;
                                listText += ` > Level: ${r.tier}\n`;
                                listText += ` > Habis: ${r.expiryDate} (Sisa ${r.duration})\n`;
                                listText += ` > Diberi: ${r.grantedBy}\n\n`;
                            });

                            listText += `_Total ${activeRentals.length} akses aktif. Keep it lowkey._`;

                            await sock.sendMessage(from, { text: listText.trim() }, { quoted: msg });
                            return;

                        case prefix + 'addrent':
                            if (!isOperator(senderId)) {
                                return sock.se  ndMessage(from, { text: '❌ Hanya operator!' }, { quoted: msg });
                            }

                            const args = text.split(' ');

                            // Handle .addrent list
                            if (args.length > 1 && args[1].toLowerCase() === 'list') {
                                const activeRentals = await listRentals(sock);

                                if (activeRentals.length === 0) {
                                    return sock.sendMessage(from, { text: '📭 Belum ada sewa aktif.' }, { quoted: msg });
                                }

                                let listText = `📋 *DAFTAR SEWA AKTIF* (${activeRentals.length})\n\n`;

                                activeRentals.slice(0, 10).forEach((r, i) => {
                                    const nameDisplay = r.type === 'Grup' ? ` (${r.name.substring(0, 20)}...)` : '';
                                    listText += `${i + 1}. *${r.type}${nameDisplay}*\n`;
                                    listText += `   ⏳ ${r.duration} lagi\n`;
                                    listText += `   📅 ${r.expiryDate}\n`;
                                    listText += `   🆔 ${r.jid.substring(0, 20)}...\n\n`;
                                });

                                if (activeRentals.length > 10) {
                                    listText += `...dan ${activeRentals.length - 10} lainnya.\n`;
                                }

                                await sock.sendMessage(from, { text: listText }, { quoted: msg });
                                return;
                            }

                            // Tampilkan help jika format salah
                            if (args.length < 2) {
                                const helpText = `📋 *CARA PAKAI .addrent* 📋

1. *DI GRUP* (otomatis):
   .addrent 30  → sewa grup ini 30 hari
   .addrent group 30 → sama seperti atas
   .addrent extend 30 → perpanjang sewa

2. *DI PRIVATE CHAT*:
   .addrent 628123456789 30 → sewa user
   .addrent 120363423805458918@g.us 30 → sewa grup

3. *LAINNYA*:
   .addrent list → lihat semua sewa aktif

*Contoh:* \`.addrent 7\` → sewa 7 hari`;
                                return sock.sendMessage(from, { text: helpText }, { quoted: msg });
                            }

                            try {
                                let targetId, days, context;

                                // SCENARIO 1: ".addrent 30" (di grup → otomatis grup ini)
                                if (args.length === 2 && !isNaN(args[1])) {
                                    targetId = from;
                                    days = parseInt(args[1]);
                                    context = 'group';
                                }
                                // SCENARIO 2: ".addrent group 30"
                                else if (args[1].toLowerCase() === 'group' && !isNaN(args[2])) {
                                    targetId = from;
                                    days = parseInt(args[2]);
                                    context = 'group';
                                }
                                // SCENARIO 3: ".addrent extend 30"
                                else if (args[1].toLowerCase() === 'extend' && !isNaN(args[2])) {
                                    targetId = from;
                                    days = parseInt(args[2]);
                                    context = 'group';

                                    const existing = getRental(targetId);
                                    if (!existing) {
                                        return sock.sendMessage(from, {
                                            text: '❌ Grup ini belum punya sewa aktif. Gunakan `.addrent 30` saja.'
                                        }, { quoted: msg });
                                    }
                                }
                                // SCENARIO 4: Format lengkap
                                else if (args.length >= 3 && !isNaN(args[2])) {
                                    targetId = args[1];
                                    days = parseInt(args[2]);
                                    context = targetId.length >= 15 ? 'group' : 'private';
                                }
                                else {
                                    return sock.sendMessage(from, {
                                        text: '❌ Format salah! Contoh: `.addrent 30` atau `.addrent 628123456789 30`'
                                    }, { quoted: msg });
                                }

                                if (isNaN(days) || days <= 0) {
                                    return sock.sendMessage(from, { text: '❌ Jumlah hari harus angka positif!' }, { quoted: msg });
                                }

                                // Grant rental
                                const rentalInfo = grantRental('MANUAL', targetId, 'A', days, senderId, context);

                                // Format response
                                const now = new Date();
                                const expiryDate = new Date(rentalInfo.expires);
                                const daysDiff = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));

                                let response = `✅ *SEWA DITAMBAHKAN* ✅\n\n`;
                                response += `📌 *ID:* ${targetId.includes('@') ? targetId : normalizeJid(targetId, context)}\n`;
                                response += `⏱️ *Durasi:* ${days} hari\n`;
                                response += `📅 *Berlaku hingga:* ${formatDate(rentalInfo.expires)}\n`;
                                response += `⏳ *Sisa:* ${daysDiff} hari\n`;
                                response += `👤 *Ditambahkan oleh:* @${senderId.split('@')[0]}\n\n`;
                                response += `_Status: ${rentalInfo.scope.toUpperCase()} - ${rentalInfo.tier}_`;

                                await sock.sendMessage(from, {
                                    text: response,
                                    mentions: [sender]
                                }, { quoted: msg });

                            } catch (error) {
                                console.error('Addrent error:', error);
                                await sock.sendMessage(from, {
                                    text: `❌ Gagal menambah sewa: ${error.message}`
                                }, { quoted: msg });
                            }
                            return;

                        case prefix + 'delrent':
                            // Fix: Gunakan variable yang konsisten
                            const delArgs = text.split(' ');

                            if (delArgs.length < 2) {
                                await sock.sendMessage(from, {
                                    text: `Format salah! Gunakan: ${prefix}delrent [ID JID/Group]\n\nContoh:\n.delrent 628123456789\n.delrent 120363423805458918@g.us`
                                }, { quoted: msg });
                                return;
                            }

                            let idToRevoke = delArgs[1].trim();

                            // Handle ".delrent group" (hapus sewa grup saat ini)
                            if (idToRevoke.toLowerCase() === 'group' && isGroup) {
                                idToRevoke = from; // ID grup sekarang
                                console.log(`[DELRENT] Auto-targeting current group: ${idToRevoke}`);
                            }

                            // Normalisasi JID jika belum lengkap
                            if (!idToRevoke.includes('@')) {
                                // Auto-detect: angka panjang = grup, pendek = private
                                idToRevoke = idToRevoke.length >= 15 ?
                                    `${idToRevoke}@g.us` :
                                    `${idToRevoke}@s.whatsapp.net`;
                            }

                            // Validasi JID
                            if (!isValidJid(idToRevoke)) {
                                await sock.sendMessage(from, {
                                    text: `❌ Format JID tidak valid.\n\nFormat yang benar:\n• Private: 628123456789@s.whatsapp.net\n• Group: 120363423805458918@g.us\n\nID yang dimasukkan: ${idToRevoke}`
                                }, { quoted: msg });
                                return;
                            }

                            // Cek apakah ada sewa aktif sebelum dihapus
                            const existingRental = getRental(idToRevoke);

                            if (!existingRental) {
                                await sock.sendMessage(from, {
                                    text: `❌ ID *${idToRevoke}* tidak memiliki sewa aktif.`
                                }, { quoted: msg });
                                return;
                            }

                            // Hapus sewa
                            revokeRental(idToRevoke);

                            // Verifikasi penghapusan
                            const afterDelete = getRental(idToRevoke);

                            if (!afterDelete) {
                                const response = `✅ *SEWA DIHAPUS* ✅\n\n` +
                                    `📌 *ID:* ${idToRevoke}\n` +
                                    `🗑️ *Dihapus oleh:* @${senderId.split('@')[0]}\n` +
                                    `📅 *Data sewa sebelumnya:*\n` +
                                    `   - Tier: ${existingRental.tier}\n` +
                                    `   - Expired: ${formatDate(existingRental.expires)}\n` +
                                    `   - Scope: ${existingRental.scope}\n\n` +
                                    `_Status: TERHAPUS ✅_`;

                                await sock.sendMessage(from, {
                                    text: response,
                                    mentions: [sender]
                                }, { quoted: msg });
                            } else {
                                await sock.sendMessage(from, {
                                    text: `⚠️ Peringatan: Penghapusan mungkin gagal. ID masih terdeteksi memiliki akses.`
                                }, { quoted: msg });
                            }
                            return;


                        case prefix + 'addprem':
                        case prefix + 'delprem':
                            await sock.sendMessage(from, { text: `⚠️ Perintah ${command} sudah diganti dengan *${prefix}addrent* dan *${prefix}delrent*.` }, { quoted: msg });
                            return;
                    }


                    // AUDIT COMMAND
                    if (textLower === '.checkall') {
                        if (!isOperator(senderId)) return;

                        const commands = [
                            { name: 'Downloader (TT)', func: typeof downloadTikTok },
                            { name: 'Downloader (IG)', func: typeof downloadInstagram },
                            { name: 'Downloader (YT)', func: typeof ytMp4 },
                            { name: 'Sticker Maker', func: typeof createSticker },
                            { name: 'Database System', func: typeof loadUsers },
                            { name: 'Rental System', func: typeof grantRental },
                            { name: 'Anime API', func: typeof getWaifu },
                            { name: 'Scheduler/Alarm', func: typeof setupBackgroundJobs }
                        ];

                        let checkList = `🛠️ *AUDIT COMMAND SAM BOT*\n━━━━━━━━━━━━━━━\n`;

                        commands.forEach(cmd => {
                            const status = cmd.func === 'function' ? '✅ Ready' : '❌ Broken/Undefined';
                            checkList += `• *${cmd.name}*: ${status}\n`;
                        });

                        // Cek folder sampah buat storage
                        const sampahDir = path.join(__dirname, 'database', 'sampah');
                        const sampahReady = fs.existsSync(sampahDir) ? '✅ Exists' : '⚠️ Missing (Auto-create)';
                        checkList += `\n• *Folder Junk*: ${sampahReady}`;

                        checkList += `\n━━━━━━━━━━━━━━━\n_Status: Diagnostic Complete_`;

                        await sock.sendMessage(from, { text: checkList }, { quoted: msg });
                        return;
                    }
                }


            } catch (e) {
                console.error('Message handler error:', e);
            }
        });

        setupBackgroundJobs(sock);

    } catch (error) {
        console.error('Failed to connect:', error);
        setTimeout(connectToWhatsApp, 5000);
    }
}

// ============================================================
// START BOT
// ============================================================

connectToWhatsApp();