const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const cheerio = require('cheerio');

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

const loadMuted = () => loadJSON(MUTE_DB, {});
const saveMuted = (data) => saveJSON(MUTE_DB, data);

// Buat folder data jika belum ada
try {
    if (!fs.existsSync(FOLDER)) fs.mkdirSync(FOLDER, { recursive: true });
} catch (e) {
    console.log('Gagal membuat folder data:', e.message);
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

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

function isOperator(fullJid, sock) {
    if (!fullJid) return false;
    try {
        const list = loadOperators();
        const numeric = fullJid.split('@')[0];

        // Cek di list operator
        for (const op of list) {
            if (!op) continue;
            if (String(op) === numeric) return true;
            if (fullJid.includes(String(op))) return true;
            if (fullJid.endsWith(`${op}@s.whatsapp.net`)) return true;
        }
    } catch (e) {
        console.log('isOperator error:', e.message);
    }
    return false;
}

// ============================================================
// SISTEM SEWA (RENTAL)
// ============================================================

function grantRental(scope, id, tier, days, grantedBy) {
    const rentals = loadRentals();
    const key = id;
    
    // Tentukan waktu kedaluwarsa baru (dimulai dari sisa sewa yang ada atau dari sekarang)
    let currentExpiryTime = Date.now();
    // Ambil tanggal kadaluarsa saat ini jika ada dan belum expired
    if (rentals[key] && rentals[key].expires > Date.now()) {
        currentExpiryTime = rentals[key].expires; 
    }

    const expires = currentExpiryTime + (Number(days) || 0) * 24 * 60 * 60 * 1000;
    
    rentals[key] = {
        scope,
        tier,
        expires,
        grantedBy,
        grantedAt: Date.now()
    };
    saveRentals(rentals);
    return rentals[key];
}

function revokeRental(id) {
    const rentals = loadRentals();
    if (rentals[id]) delete rentals[id];
    saveRentals(rentals);
}

// FIX KRITIS: Fungsi getRental diperbaiki agar mengembalikan objek rental jika aktif
const getRental = (jid) => { // Ganti ID menjadi JID
    let rentals = loadRentals();
    const rentalData = rentals[jid]; // Gunakan JID LENGKAP sebagai kunci
    if (!rentalData || rentalData.expires <= Date.now()) { 
        // Jika tidak ada data atau sudah kadaluarsa
        return false;
    }
    // Jika masih aktif, kembalikan objek lengkapnya
    return rentalData;
};

const hasAccessForCommand = (command, isGroup, sender, groupId, sock) => {
    // sender dan groupId sudah berupa JID LENGKAP di main handler
    const senderFullJid = sender; // 'sender' sudah full JID (participant)
    const senderId = senderFullJid.split('@')[0];

    // 1. Operator selalu lolos (WAJIB ADA untuk Owner/Pengelola Bot)
    if (isOperator(senderId)) { // isOperator tetap cek ID numerik
        return true;
    }

    // 2. Pengecekan Sewa (Rental)
    if (isGroup) {
        // Cek sewa grup menggunakan JID GRUP (groupId/from)
        return getRental(groupId);
    } else {
        // Cek sewa private chat menggunakan JID PENGIRIM (sender)
        return getRental(sender); // PENTING: Gunakan sender JID LENGKAP
    }
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

// ============================================================
// FITUR DOWNLOADER SEDERHANA
// ============================================================

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
    } catch {
        await sock.sendMessage(from, { text: '❌ Gagal download TikTok.' }, { quoted: msg });
    }
}

async function downloadInstagram(url, sock, from, msg) {
    await sock.sendMessage(from, { text: '⏳ Download Instagram...' }, { quoted: msg });
    try {
        const res = await axios.get(`https://instasave.io/download?url=${encodeURIComponent(url)}`);
        const $ = cheerio.load(res.data);
        const mediaUrl = $('a.download-btn').attr('href');
        if (mediaUrl && mediaUrl.includes('.mp4')) {
            await sock.sendMessage(from, { video: { url: mediaUrl }, caption: '✅ Instagram Video' }, { quoted: msg });
        } else if (mediaUrl) {
            await sock.sendMessage(from, { image: { url: mediaUrl }, caption: '✅ Instagram Photo' }, { quoted: msg });
        } else {
            throw new Error('Link tidak ditemukan');
        }
    } catch {
        await sock.sendMessage(from, { text: '❌ Gagal download Instagram.' }, { quoted: msg });
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
    } catch {
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
    } catch {
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
    } catch {
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
    } catch {
        await sock.sendMessage(from, { text: '❌ Gagal membuat QR Code.' }, { quoted: msg });
    }
}

async function getPrayerTime(city, sock, from, msg) {
    try {
        const res = await axios.get(`https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}&country=Indonesia&method=8`);
        const t = res.data.data.timings;
        const text = `🕌 Jadwal Sholat ${city.toUpperCase()}\n\nSubuh: ${t.Fajr}\nDzuhur: ${t.Dhuhr}\nAshar: ${t.Asr}\nMaghrib: ${t.Maghrib}\nIsya: ${t.Isha}`;
        await sock.sendMessage(from, { text }, { quoted: msg });
    } catch {
        await sock.sendMessage(from, { text: '❌ Gagal ambil jadwal sholat.' }, { quoted: msg });
    }
}

// ============================================================
// FUNGSI GAME SEDERHANA
// ============================================================

function getRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
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
// WELCOME HANDLER
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

// ============================================================
// BAN HANDLER
// ============================================================

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

        // Setup handlers
        setupWelcomeHandler(sock);
        setupBanHandler(sock);

        // Connection handlers
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
                
                // FIX UTAMA: Cegah error 'fromMe' jika msg itu sendiri undefined/null (non-message event)
                if (!msg || !msg.message) return;

                const from = msg.key.remoteJid;
                const groupId = from;
                const sender = msg.key.participant || from;
                const isGroup = from.endsWith('@g.us');
                const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';

                // Ambil teks dulu sebelum dipake filter fromMe
                const text = (
                    msg.message?.conversation ||
                    msg.message?.extendedTextMessage?.text ||
                    msg.message?.imageMessage?.caption ||
                    msg.message?.videoMessage?.caption || // Tambahkan ini agar lebih aman
                    ''
                ).trim();
                const textLower = text.toLowerCase();

                // Filter fromMe (Sekarang 'text' udah aman karena udah didefinisikan di atas)
                if (msg.key.fromMe && !text.startsWith('.')) return;

                // --- SISTEM MUTE (FIXED) ---
                const muted = loadMuted();
                if (isGroup && muted[from]?.includes(sender)) {
                    const groupMetadata = await sock.groupMetadata(from); // Ambil metadata dulu
                    const participants = groupMetadata.participants;
                    const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
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

                // Anti link
                const groupLinkRegex = /chat.whatsapp.com\/(?:invite\/)?([0-9a-zA-Z]{20,26})/i;
                if (isGroup && groupLinkRegex.test(textLower)) {
                    const groupMetadata = await sock.groupMetadata(from);
                    const participants = groupMetadata.participants;
                    const botAdmin = participants.find(p => p.id === (sock.user.id.split(':')[0] + '@s.whatsapp.net'))?.admin;
                    const userAdmin = participants.find(p => p.id === sender)?.admin;

                    if (botAdmin && !userAdmin) {
                        await sock.groupParticipantsUpdate(from, [sender], 'remove');
                        return;
                    }
                }

                //cek akses sewa
                const prefix = '.';

                if (!textLower.startsWith(prefix)) {
                    return;
                }

                const freeCommands = ['.sewa', '.ping', '.help', '.menu', '.profile', '.ceksewa']; // Tambahkan .ceksewa ke free command
                const commandUtama = textLower.split(' ')[0];


                const isFreeCommand = freeCommands.some(freeCmd =>
                    commandUtama === freeCmd
                );


                if (!isFreeCommand) {
                    // Pengecekan akses bot hanya untuk command berbayar
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
                    // ID yang harus dicek adalah JID LENGKAP (Group ID untuk grup, Sender JID untuk PC)
                    const idToCheck = isGroup ? groupId : sender; 
                    
                    // getRental sekarang mengembalikan objek rental jika masih aktif
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

                // HELP/MENU
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

                // PING
                if (textLower === '.ping') {
                    const start = Date.now();
                    await sock.sendMessage(from, { text: '🏓 Pong!' });
                    const latency = Date.now() - start;
                    await sock.sendMessage(from, {
                        text: `⚡ Latency: ${latency}ms\n🕐 Uptime: ${process.uptime().toFixed(2)}s`
                    });
                    return;
                }

                // TIKTOK DOWNLOADER
                if (textLower.startsWith('.tt ')) {
                    const url = text.split(' ')[1];
                    if (!url.includes('tiktok')) {
                        return sock.sendMessage(from, { text: '❌ Link TikTok tidak valid!' }, { quoted: msg });
                    }
                    await downloadTikTok(url, sock, from, msg);
                    return;
                }

                // INSTAGRAM DOWNLOADER
                if (textLower.startsWith('.ig ')) {
                    const url = text.split(' ')[1];
                    if (!url.includes('instagram.com')) {
                        return sock.sendMessage(from, { text: '❌ Link Instagram tidak valid!' }, { quoted: msg });
                    }
                    await downloadInstagram(url, sock, from, msg);
                    return;
                }

                // STICKER MAKER
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
                    } catch {
                        await sock.sendMessage(from, { text: '❌ Gagal membuat sticker.' }, { quoted: msg });
                    }
                    return;
                }

                // WAIFU
                if (textLower === '.waifu') {
                    await getWaifu(sock, from, msg);
                    return;
                }

                // NEKO
                if (textLower === '.neko') {
                    await getNeko(sock, from, msg);
                    return;
                }

                // TRUTH OR DARE
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

                // QR CODE GENERATOR
                if (textLower.startsWith('.qrgen ')) {
                    const data = text.split(' ').slice(1).join(' ');
                    if (!data) {
                        return sock.sendMessage(from, { text: '❌ Format: .qrgen [teks]' }, { quoted: msg });
                    }
                    await generateQR(data, sock, from, msg);
                    return;
                }

                // SHOLAT TIME
                if (textLower.startsWith('.sholat ')) {
                    const city = text.split(' ').slice(1).join(' ');
                    if (!city) {
                        return sock.sendMessage(from, { text: '❌ Format: .sholat [kota]' }, { quoted: msg });
                    }
                    await getPrayerTime(city, sock, from, msg);
                    return;
                }

                // SEWA INFO
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

                // EXPLAINING CUSTOM FEATURES
                if (textLower === '.customfeatures') {
                    const customText = `"Fitur Custom itu ibarat Kakak punya asisten pribadi di WA. Kakak mager catat pengeluaran di buku? Atau repot mau ngatur jadwal tapi sering lupa?

Di BOT SAM, Kakak bisa request fitur buat bantu keseharian. Contohnya: — Catat Keuangan: Tinggal chat 'Beli kopi 20rb', nanti SAM otomatis rekap total pengeluaran Kakak sebulan. — Reminder Mager: Chat 'SAM, ingetin bayar kos besok jam 10', nanti SAM bakal tag Kakak tepat waktu. — Catatan Rahasia: Simpan data apa pun di SAM, tinggal panggil lagi kapan aja Kakak butuh.

Intinya, apa yang Kakak pengen SAM lakuin buat bantu hidup Kakak jadi lebih simpel, tinggal bilang. Saya buatkan sistemnya khusus buat Kakak."`

                    await sock.sendMessage(from, { text: customText });
                    return;
                }


                // PROFILE
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
                    } catch {
                        await sock.sendMessage(from, { text: '❌ Gagal mendapatkan profile.' });
                    }
                    return;
                }

                // GROUP COMMANDS
                if (isGroup) {
                    const groupMetadata = await sock.groupMetadata(from);
                    const participants = groupMetadata.participants;
                    const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                    const botAdmin = participants.find(p => p.id === botNumber)?.admin;
                    const userAdmin = participants.find(p => p.id === sender)?.admin;
                    const isBotAdmin = botAdmin === 'admin' || botAdmin === 'superadmin';
                    const isUserAdmin = userAdmin === 'admin' || userAdmin === 'superadmin';

                    // CEK GROUP ID (BARU DITAMBAHKAN)
                    if (textLower === '.cekidgroup') {
                        const idGroupText = `🌐 *ID GRUP*\n\nID: ${from}\n_Gunakan ID ini untuk keperluan sewa atau operator._`;
                        await sock.sendMessage(from, { text: idGroupText }, { quoted: msg });
                        return;
                    }

                    // HIDETAG BY BOT SAM
                    if (textLower.startsWith('.hidetag') || textLower === '.h') {
                        if (!isUserAdmin && !isOperator(sender, sock)) {
                            return sock.sendMessage(from, { text: '❌ Hanya admin/operator yang bisa pakai ini, Bos!' });
                        }

                        // Ambil teks setelah command .hidetag
                        const teks = text.slice(9) || 'Panggilan untuk warga grup! 📢';

                        // Kirim pesan dengan mentions semua peserta tapi gak kelihatan nomornya
                        await sock.sendMessage(from, {
                            text: teks,
                            mentions: participants.map(p => p.id)
                        });
                        return;
                    }

                    // FORMAT: .setalarm 07:00 | Pesan Lu
                    if (textLower.startsWith('.setalarm')) { // Pakai startsWith tanpa spasi dulu buat nge-trap
                        if (!isUserAdmin && !isOperator(sender, sock)) return;

                        // 1. CEK: Cuma ngetik .setalarm doang?
                        if (text.trim() === '.setalarm') {
                            return sock.sendMessage(from, {
                                text: `⚠️ *FORMAT SALAH, BOS!*\n\nPenggunaan:\n*.setalarm Jam | Pesan*\nContoh:\n.setalarm 07:00 | Waktunya bangun!\n_Note: Pake format 24 jam ya._`
                            });
                        }

                        // 2. CEK: Ada isinya tapi kurang lengkap (nggak pake '|')
                        const input = text.slice(10).split('|');
                        if (input.length < 2) {
                            return sock.sendMessage(from, {
                                text: `❌ *DATA KURANG LENGKAP!*\n\nJangan lupa kasih pembatas garis tegak (|) antara jam dan pesannya.\nContoh: .setalarm 12:00 | Makan siang!`
                            });
                        }

                        const time = input[0].trim();
                        const msgAlarm = input[1].trim();

                        // 3. CEK: Format jam bener gak?
                        if (!/^\d{2}:\d{2}$/.test(time)) {
                            return sock.sendMessage(from, {
                                text: `🕒 *FORMAT JAM SALAH!*\n\nPake format HH:mm (Contoh: 07:05 atau 21:00).`
                            });
                        }

                        // Kalau semua aman, baru simpan ke DB
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

                    // FORMAT: .delalarm (Hapus alarm berdasarkan nomor urut)
                    if (textLower.startsWith('.delalarm ')) {
                        if (!isUserAdmin && !isOperator(sender, sock)) return;

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

                    // FORMAT: .listalarm (Cek semua jadwal di grup ini)
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
                        if (!isUserAdmin && !isOperator(sender, sock)) return;

                        // Ambil teks setelah ".h "
                        const pesan = text.slice(3).trim();
                        if (!pesan) return; // Kalau cuma ngetik ".h" doang, SAM diem aja

                        // Ambil semua member buat dimention
                        const groupMetadata = await sock.groupMetadata(from);
                        const participants = groupMetadata.participants.map(p => p.id);

                        // SAM kirim pesan lu sambil nge-ghost mention
                        await sock.sendMessage(from, {
                            text: pesan,
                            mentions: participants
                        });
                    }

                    // TAGALL
                    if (textLower === '.tagall') {
                        if (!isUserAdmin && !isOperator(sender, sock)) {
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

                    // KICK
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

                    // BAN
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

                    // COMMAND .MUTE
                    if (textLower.startsWith('.mute')) {
                        if (!isUserAdmin && !isOperator(sender, sock)) return;

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

                    // COMMAND .UNMUTE
                    if (textLower.startsWith('.unmute')) {
                        if (!isUserAdmin && !isOperator(sender, sock)) return;

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

                    // PROMOTE/DEMOTE
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

                    // OpenGroup
                    if (textLower === '.opengroup') {
                        if (!isUserAdmin || !isBotAdmin) {
                            return sock.sendMessage(from, { text: '❌ Bot dan user harus admin grup!' });
                        }

                        try {
                            // Mengubah ke pengaturan normal (semua member bisa mengirim pesan)
                            await sock.groupSettingUpdate(from, 'not_announcement');
                            await sock.sendMessage(from, { text: '✅ Grup berhasil *DIBUKA*! Semua member kini bisa mengirim pesan.' });
                        } catch (e) {
                            await sock.sendMessage(from, { text: `❌ Gagal membuka grup: ${e.message}` });
                        }
                        return;
                    }

                    // CLOSE GROUP (Hanya Admin yang Bisa Mengirim Pesan = 'announcement')
                    if (textLower === '.closegroup') {
                        if (!isUserAdmin || !isBotAdmin) {
                            return sock.sendMessage(from, { text: '❌ Bot dan user harus admin grup!' });
                        }

                        try {
                            // Mengubah ke pengaturan restricted (hanya admin yang bisa mengirim pesan)
                            await sock.groupSettingUpdate(from, 'announcement');
                            await sock.sendMessage(from, { text: '✅ Grup berhasil *DITUTUP*! Hanya admin yang bisa mengirim pesan.' });
                        } catch (e) {
                            await sock.sendMessage(from, { text: `❌ Gagal menutup grup: ${e.message}` });
                        }
                        return;
                    }

                    // SET GROUP NAME
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

                    // Struktur sederhana buat Reminder
                    let reminders = [];

                    if (textLower.startsWith('.remind')) {
                        const input = text.split(' '); // Contoh: .remind 10m bayar kos
                        if (input.length < 3) return sock.sendMessage(from, { text: 'Format: .remind [durasi][s/m/h] [pesan]\nContoh: .remind 10m jemput adek' });

                        const timeStr = input[1];
                        const message = text.slice(text.indexOf(timeStr) + timeStr.length).trim();

                        // Convert durasi (s = detik, m = menit, h = jam)
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
                // OPERATOR COMMANDS (DILUAR IF GROUP)
                // ============================================
                
                const command = textLower.split(' ')[0];
                const senderId = sender.split('@')[0];

                if (isOperator(senderId)) {
                    switch (command) {
                        case prefix + 'addrent':
                            // 1. Dapatkan ID target dan durasi
                            const argsRent = textLower.split(' ');
                            if (argsRent.length < 3) {
                                await sock.sendMessage(from, { text: `Format salah! Gunakan: ${prefix}addrent [JID/Group ID LENGKAP] [Hari]` }, { quoted: msg });
                                return;
                            }

                            // PENTING: ID target harus ditambahkan @s.whatsapp.net atau @g.us jika belum ada
                            let targetId = argsRent[1].trim();
                            if (!targetId.includes('@')) {
                                // Asumsi: jika user, maka PC. Jika grup, harusnya operator sudah pakai ID lengkap
                                targetId = targetId.length < 18 ? `${targetId}@s.whatsapp.net` : `${targetId}@g.us`;
                            } 
                            
                            const days = parseInt(argsRent[2]);

                            if (isNaN(days) || days <= 0) {
                                await sock.sendMessage(from, { text: 'Durasi hari harus angka positif.' }, { quoted: msg });
                                return;
                            }

                            // 2. Beri Sewa (Menggunakan 5 argumen: scope, id, tier, days, grantedBy)
                            const grantedBy = senderId;
                            // Asumsi scope 'MANUAL' dan tier 'A' untuk operator
                            const rentalInfo = grantRental('MANUAL', targetId, 'A', days, grantedBy);

                            if (rentalInfo) {
                                await sock.sendMessage(from, { text: `✅ Berhasil menambahkan sewa untuk ID: *${targetId}* selama *${days} hari*.\nKedaluwarsa: ${formatDate(rentalInfo.expires)}` }, { quoted: msg });
                            } else {
                                await sock.sendMessage(from, { text: `❌ Gagal menambahkan sewa. Terjadi kesalahan database.` }, { quoted: msg });
                            }
                            return;

                        case prefix + 'delrent':
                            // 1. Dapatkan ID target
                            const argsDel = textLower.split(' ');
                            if (argsDel.length < 2) {
                                await sock.sendMessage(from, { text: `Format salah! Gunakan: ${prefix}delrent [ID JID/Group]` }, { quoted: msg });
                                return;
                            }
                            const idToRevoke = argsDel[1].replace('@', ''); // Bersihkan '@'

                            // 2. Cabut Sewa
                            revokeRental(idToRevoke);

                            // Cek lagi untuk konfirmasi
                            if (!loadRentals()[idToRevoke] || !getRental(idToRevoke)) {
                                await sock.sendMessage(from, { text: `✅ Berhasil mencabut/menghapus sewa dari ID: *${idToRevoke}*.` }, { quoted: msg });
                            } else {
                                await sock.sendMessage(from, { text: `❌ Gagal mencabut. Mungkin ID *${idToRevoke}* tidak memiliki sewa aktif sebelumnya.` }, { quoted: msg });
                            }
                            return;
                            
                        case prefix + 'addprem':
                        case prefix + 'delprem':
                            // Perintah premium sudah dihapus dari menu, tapi jika operator masih mencoba
                            await sock.sendMessage(from, { text: `⚠️ Perintah ${command} sudah diganti dengan *${prefix}addrent* dan *${prefix}delrent*.` }, { quoted: msg });
                            return;
                    }
                }

            } catch (e) {
                console.error('Message handler error:', e);
            }
        });

    } catch (error) {
        console.error('Failed to connect:', error);
        setTimeout(connectToWhatsApp, 5000);
    }

    // --- MESIN JAM ALARM (SAM JAGA MALEM) ---
    let lastRun = "";
    setInterval(async () => {
        const now = new Date().toLocaleTimeString('en-GB', {
            hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta'
        });

        if (lastRun === now) return;

        let db = loadJSON('scheduler.json', []);
        if (db.length === 0) return;

        let executed = false;
        for (let task of db) {
            if (task.time === now) {
                try {
                    const meta = await sock.groupMetadata(task.groupId);
                    const members = meta.participants.map(p => p.id);
                    await sock.sendMessage(task.groupId, {
                        text: `📢 *PENGINGAT OTOMATIS*\n\n${task.message}`,
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
}

// ============================================================
// START BOT
// ============================================================

connectToWhatsApp();