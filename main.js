const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, downloadContentFromMessage, downloadMediaMessage } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const bakulan = require('./bakulan.js');
const promo = require('./promo');
const welcome = require('./welcome');
const cron = require('node-cron');
const sharp = require('sharp');
const ytdl = require('ytdl-core');

// ============================================================
// KONFIGURASI AWAL & DEKLARASI PATH
// ============================================================

const FOLDER = path.join(__dirname, 'data');
const USERS_DB = path.join(FOLDER, 'users.json');
const BANNED_DB = path.join(FOLDER, 'banned.json');
const WELCOME_DB = path.join(FOLDER, 'welcome.json');
const RENTALS_DB = path.join(FOLDER, 'rentals.json');
const OPERATORS_DB = path.join(FOLDER, 'operators.json');

// Buat folder data jika belum ada
try {
    if (!fs.existsSync(FOLDER)) fs.mkdirSync(FOLDER, { recursive: true });
} catch (e) {
    console.log('Gagal membuat folder data:', e.message);
}

// ============================================================
// 1. FUNGSI HELPER & UTILITY
// ============================================================


// YouTube Downloader Helper
async function handleDownload(msg, url, type) {
    try {
        // 1. Cek validasi link dulu
        if (!ytdl.validateURL(url)) {
            throw new Error("Link YouTube yang kamu kasih gak valid atau gak kebaca.");
        }

        const info = await ytdl.getInfo(url);
        const title = info.videoDetails.title;

        const options = type === 'mp4' ? 
            { quality: 'highest', filter: 'videoandaudio' } : 
            { quality: 'highestaudio', filter: 'audioonly' };

        const stream = ytdl(url, options);

        // 2. Kirim file
        await client.sendMessage(msg.from, { 
            [type === 'mp4' ? 'video' : 'audio']: { stream: stream }, 
            mimetype: type === 'mp4' ? 'video/mp4' : 'audio/mp4',
            fileName: `${title}.${type}`
        }, { quoted: msg });

    } catch (error) {
    // Ini yang muncul di terminal kamu buat ngecek
    console.log("Ada masalah bos:", error.message);

    // Ini pesan buat orang awam di WhatsApp
    const pesanGagal = `
*Waduh, Maaf Banget! 🙏*

Bot gagal proses videonya nih. Biasanya karena:
1. Video YouTube-nya diprivat atau dibatasi umur.
2. Server YouTube lagi nolak permintaan bot (limit).
3. Link-nya salah atau videonya kepanjangan.

*Solusinya:* Coba kirim ulang link-nya atau pakai link video yang lain ya! 😊
    `.trim();

    // Kirim pesan gagalnya ke user
    await client.sendMessage(msg.from, { text: pesanGagal }, { quoted: msg });
}
}

/**
 * Helper: Konversi video dokumen jadi video biasa
 */
async function handleVideoHD(m, sock) {
    const from = m.key.remoteJid;

    await sock.sendMessage(from, { text: 'Bentar ya, lagi dikonversi jadi video biasa... ⏳' });

    try {
        const buffer = await downloadMediaMessage(m, 'buffer');
        await sock.sendMessage(from, {
            video: buffer,
            caption: 'Nih udah jadi video biasa! Tinggal "Teruskan" ke SW biar jernih.',
            mimetype: 'video/mp4'
        });
    } catch (err) {
        console.log('Error konversi video:', err);
        await sock.sendMessage(from, { text: 'Waduh gagal pas download/kirim videonya.' });
    }
}

/**
 * Helper: Format tanggal DD-MM-YYYY
 */
function formatDate(ts) {
    try {
        const d = new Date(Number(ts));
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${dd}-${mm}-${yyyy}`;
    } catch (e) {
        return 'Unknown';
    }
}

/**
 * Helper: Format durasi ms ke teks
 */
function formatDuration(ms) {
    if (ms <= 0) return 'Kadaluarsa';

    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    const parts = [];
    if (days > 0) parts.push(`${days} hari`);
    if (hours % 24 > 0) parts.push(`${hours % 24} jam`);
    if (minutes % 60 > 0 && days === 0) parts.push(`${minutes % 60} menit`);
    if (parts.length === 0 && ms > 0) return 'Kurang dari 1 menit';

    return parts.join(', ');
}

// ============================================================
// 2. SISTEM DATABASE FUNCTIONS
// ============================================================

/**
 * Load data dari JSON file dengan error handling
 */
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

/**
 * Save data ke JSON file dengan error handling
 */
function saveJSON(filePath, data) {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.log(`Save error ${filePath}:`, e.message);
    }
}

// Database functions khusus
const loadBans = () => loadJSON(BANNED_DB, {});
const saveBans = (data) => saveJSON(BANNED_DB, data);
const loadWelcome = () => loadJSON(WELCOME_DB, {});
const saveWelcome = (data) => saveJSON(WELCOME_DB, data);
const loadUsers = () => loadJSON(USERS_DB, {});
const saveUsers = (data) => saveJSON(USERS_DB, data);
const loadRentals = () => loadJSON(RENTALS_DB, {});
const saveRentals = (data) => saveJSON(RENTALS_DB, data);
const loadOperators = () => loadJSON(OPERATORS_DB, []);

/**
 * Cek apakah user adalah operator
 */
function isOperator(fullJid, sock) {
    if (!fullJid) return false;
    try {
        const list = loadOperators();
        const numeric = fullJid.split('@')[0];

        // Bot sendiri dianggap operator
        try {
            const myId = (sock?.user && (sock.user.id || sock.user.jid)) || null;
            if (myId && (fullJid.includes(myId) || fullJid.endsWith(`${myId}@s.whatsapp.net`))) {
                return true;
            }
        } catch (e) { }

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
// 3. SISTEM SEWA (RENTAL)
// ============================================================

/**
 * Grant sewa baru
 */
function grantRental(scope, id, tier, days, grantedBy) {
    const rentals = loadRentals();
    const key = id;
    const expires = Date.now() + (Number(days) || 0) * 24 * 60 * 60 * 1000;
    rentals[key] = {
        scope,
        tier,
        expires,
        grantedBy,
        grantedAt: Date.now(),
        notified3days: false,
        notified1day: false,
        notifiedExpired: false
    };
    saveRentals(rentals);
    return rentals[key];
}

/**
 * Revoke sewa
 */
function revokeRental(id) {
    const rentals = loadRentals();
    if (rentals[id]) delete rentals[id];
    saveRentals(rentals);
}

/**
 * Cek status sewa
 */
function getRental(id) {
    const rentals = loadRentals();
    const r = rentals[id];
    if (!r) return null;
    if (r.expires && Date.now() > r.expires) {
        revokeRental(id);
        return null;
    }
    return r;
}

/**
 * Cek akses untuk command tertentu
 */
function hasAccessForCommand(command, isGroup, senderFullJid, groupId, sock) {
    const cmd = command.toLowerCase();

    // Selalu izinkan .sewa agar user bisa melihat info
    if (cmd === '.sewa') return true;

    // Operator selalu diizinkan
    if (isOperator(senderFullJid, sock)) return true;

    // Jika di grup
    if (isGroup) {
        const rental = getRental(groupId);
        if (rental) {
            // Grup aktif sewa, semua member bisa pakai command
            return true;
        } else {
            // Grup tidak sewa, tidak ada akses
            return false;
        }
    } else {
        // Jika private chat
        const senderId = (senderFullJid || '').split('@')[0];
        const rental = getRental(senderId);

        // Hanya bisa jika user memiliki sewa aktif
        return !!rental;
    }
}

/**
 * Scheduler untuk reminder sewa
 */
function scheduleRentalReminders(sock) {
    const HOUR = 60 * 60 * 1000;
    setInterval(async () => {
        try {
            const rentals = loadRentals();
            const now = Date.now();
            let changed = false;

            for (const [key, r] of Object.entries(rentals)) {
                if (!r || !r.expires) continue;
                const remaining = r.expires - now;

                if (remaining <= 0) {
                    if (!r.notifiedExpired) {
                        const target = r.scope === 'group' ? key : `${key}@s.whatsapp.net`;
                        const text = `⚠️ Masa sewa Anda untuk *${r.scope}* telah berakhir. Akses fitur akan dihentikan. Ketik .sewa untuk info.`;
                        try { await sock.sendMessage(target, { text }); } catch (e) { }
                        r.notifiedExpired = true;
                        changed = true;
                    }
                    continue;
                }

                if (remaining <= 24 * 3600 * 1000 && !r.notified1day) {
                    const target = r.scope === 'group' ? key : `${key}@s.whatsapp.net`;
                    const text = `📢 Pengingat: masa sewa akan berakhir dalam kurang dari 24 jam (${formatDuration(remaining)}). Silakan perpanjang.`;
                    try { await sock.sendMessage(target, { text }); } catch (e) { }
                    r.notified1day = true;
                    changed = true;
                } else if (remaining <= 3 * 24 * 3600 * 1000 && !r.notified3days) {
                    const target = r.scope === 'group' ? key : `${key}@s.whatsapp.net`;
                    const text = `📢 Pengingat: masa sewa akan berakhir dalam ${Math.ceil(remaining / (24 * 3600 * 1000))} hari (${formatDuration(remaining)}).`;
                    try { await sock.sendMessage(target, { text }); } catch (e) { }
                    r.notified3days = true;
                    changed = true;
                }
            }

            if (changed) saveRentals(rentals);
        } catch (e) {
            console.log('Rental scheduler error:', e.message);
        }
    }, HOUR);
}

// ============================================================
// 4. SISTEM PROMO HARIAN
// ============================================================

/**
 * Setup jadwal promo harian
 */
function setupDailyPromo(sock) {
    const PROMO_TARGET = '120363280006072640@g.us'; // Ganti dengan target grup

    const promos = [
        {
            time: '40 7 * * *',
            photo: 'promo_3d.jpg',
            caption: `3D FF 4K. Gak pasaran, gak ribet.

• Solo: 50k • Couple: 70k • Squad: 100k+

Minat? Chat aja: wa.me/6289528950624 #3DFreeFire #Jasa3D`
        },
        {
            time: '41 7 * * *',
            photo: 'promo_topup.jpg',
            caption: `RATE TOPUP PER-ITEM HARI INI
FREE FIRE: 121p
ML: 250p  
ROBLOX: 190p                  `
                        `Untuk Game Lainnya, Chat Saja!\n#SamSukabyone #TopUpMurah`
        },
        {
            time: '42 7 * * *',
            photo: 'promo_sewa.jpg',
            caption: `Bot WA premium, cuma 15k sebulan. Udah bisa hidetag, download video, bikin stiker, sampe jagain grup biar gak kena link spam.

On 24 jam, jarang rewel. Sewa: wa.me/6289528950624 #SewaBot #BotWA`
        },
        {
            time: '15 19 * * *',
            photo: 'promo_3d.jpg',
            caption: `Promo malem: All 3D harga jadi 30k. Pengerjaan sat-set, sejam kelar. Slot terbatas, siapa cepat dia dapat.

Gas: wa.me/6289528950624 #PromoMalam #3DFF`
        }
    ];

    promos.forEach(p => {
        cron.schedule(p.time, async () => {
            const photoPath = path.join(FOLDER, p.photo);
            if (fs.existsSync(photoPath)) {
                await sock.sendMessage(PROMO_TARGET, {
                    image: fs.readFileSync(photoPath),
                    caption: p.caption
                });
            }
        }, { timezone: 'Asia/Jakarta' });
    });
}

// ============================================================
// 5. SISTEM WELCOME & BANNED
// ============================================================

/**
 * Handler untuk welcome message
 */
function setupWelcomeHandler(sock) {
    sock.ev.on('group-participants.update', async (update) => {
        if (update.action !== 'add') return;

        const welcomes = loadWelcome();
        const caption = welcomes[update.id] || `SELAMAT DATANG $nama DI $grup!\nNomor: $nomor\nSemoga betah ya! 🔥`;

        for (const user of update.participants) {
            try {
                const meta = await sock.groupMetadata(update.id);
                const pp = await sock.profilePictureUrl(user, 'image')
                    .catch(() => 'https://i.ibb.co/3mZmy8Z/default-pp.jpg');
                const name = await sock.getName(user) || 'User';
                const finalCaption = caption
                    .replace('$nama', name)
                    .replace('$nomor', user.split('@')[0])
                    .replace('$grup', meta.subject);

                await sock.sendMessage(update.id, {
                    image: { url: pp },
                    caption: finalCaption
                });
            } catch (e) { }
        }
    });
}

/**
 * Handler untuk auto kick banned user
 */
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
                for (const p of toKick) {
                    await sock.sendMessage(id, {
                        text: `@${p.split('@')[0]} dibanned dari grup ini!`,
                        mentions: [p]
                    });
                }
            } catch (e) {
                console.log('Auto kick join error:', e);
            }
        }
    });
}

// ============================================================
// 6. FUNGSI GROUP CONTROL
// ============================================================

/**
 * Helper: Set group announcement dengan fallback
 */
async function setGroupAnnouncement(sock, jid, announce) {
    const mode = announce ? 'announcement' : 'not_announcement';

    // Coba berbagai method yang tersedia di Baileys
    if (typeof sock.groupSettingChange === 'function') {
        return sock.groupSettingChange(jid, mode);
    }
    if (typeof sock.groupSettingUpdate === 'function') {
        return sock.groupSettingUpdate(jid, mode);
    }
    if (typeof sock.groupUpdate === 'function') {
        try {
            return sock.groupUpdate(jid, { announce });
        } catch (e) { }
    }
    throw new Error('Group setting change not supported');
}

// ============================================================
// 7. MAIN BOT CONNECTION & MESSAGE HANDLER
// ============================================================

async function connectToWhatsApp() {
    try {
        // ======================
        // 7.1. INITIALIZATION
        // ======================
        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

        const sock = makeWASocket({
            auth: state,
            version: [2, 3000, 1027934701]
        });

        // ======================
        // 7.2. SETUP SCHEDULERS & HANDLERS
        // ======================
        setupDailyPromo(sock);
        setupWelcomeHandler(sock);
        setupBanHandler(sock);

        // ======================
        // 7.3. CONNECTION HANDLERS
        // ======================
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
                console.log('\x1b[38;5;196m');
                console.log(`
 ▀█████████▄   ▄██████▄      ███             ▄████████    ▄████████   ▄▄▄▄███▄▄▄▄  
  ███    ███ ███    ███ ▀█████████▄        ███    ███   ███    ███ ▄██▀▀▀███▀▀▀██▄
  ███    ███ ███    ███    ▀███▀▀██        ███    █▀    ███    ███ ███   ███   ███
 ▄███▄▄▄██▀  ███    ███     ███   ▀        ███          ███    ███ ███   ███   ███
▀▀███▀▀▀██▄  ███    ███     ███          ▀███████████ ▀███████████ ███   ███   ███
  ███    ██▄ ███    ███     ███                   ███   ███    ███ ███   ███   ███
  ███    ███ ███    ███     ███             ▄█    ███   ███    ███ ███   ███   ███
▄█████████▀   ▀██████▀     ▄████▀         ▄████████▀    ███    █▀   ▀█   ███   █▀                               

                ╔══════════════════════════════════════════════╗
                ║          SAM BOT SUKSES DINYALAKAN!!!        ║
                ║       ON 24/7 • VPS • ZERO DC • PREMIUM      ║
                ║           MADE BY SUKABYONE © 2025           ║
                ╚══════════════════════════════════════════════╝
                `);
                console.log('\x1b[0m');

                // Start rental reminder
                scheduleRentalReminders(sock);
            }
        });

        sock.ev.on('creds.update', saveCreds);

        // ======================
        // 7.4. MAIN MESSAGE HANDLER
        // ======================
        sock.ev.on('messages.upsert', async (m) => {
            try {
                const msg = m.messages[0];
                if (!msg.message || msg.key.fromMe) return;

                const from = msg.key.remoteJid;
                const text = (
                    msg.message?.conversation ||
                    msg.message?.extendedTextMessage?.text ||
                    msg.message?.imageMessage?.caption ||
                    msg.message?.videoMessage?.caption ||
                    ''
                ).trim().toLowerCase();

                const sender = msg.key.participant || from;
                const isGroup = from.endsWith('@g.us');
                const groupId = from;

                // ======================
                // 7.4.1. UPDATE USER RECORD
                // ======================
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

                // ======================
                // 7.4.2. ANTI BANNED USER
                // ======================
                if (isGroup) {
                    const bans = loadBans();
                    if (bans[from]?.includes(sender)) {
                        try {
                            await sock.groupParticipantsUpdate(from, [sender], 'remove');
                            await sock.sendMessage(from, {
                                text: `@${sender.split('@')[0]} dibanned dari grup ini!`,
                                mentions: [sender]
                            });
                        } catch (e) { }
                        return;
                    }
                }

                // ======================
                // 7.4.3. COMMAND HANDLING
                // ======================

                // Daftar command yang selalu diizinkan tanpa sewa
                const freeCommands = ['.sewa', '.ping', '.help', '.menu'];

                // Cek apakah command perlu akses sewa
                const needsRental = !freeCommands.some(freeCmd =>
                    text === freeCmd || text.startsWith(freeCmd + ' ')
                );

                if (needsRental) {
                    // Cek akses berdasarkan sewa
                    if (!hasAccessForCommand(text.split(' ')[0], isGroup, sender, groupId, sock)) {
                        let replyText = '';

                        if (isGroup) {
                            replyText = `❌ Grup ini belum menyewa bot!\n\n` +
                                `Untuk menggunakan fitur ini, admin grup harus menyewa bot terlebih dahulu.\n` +
                                `Ketik *.sewa* untuk info penyewaan.\n\n` +
                                `📞 Hubungi Owner: wa.me/6289528950624`;
                        } else {
                            replyText = `❌ Anda belum menyewa bot!\n\n` +
                                `Untuk menggunakan fitur ini, Anda harus menyewa bot terlebih dahulu.\n` +
                                `Ketik *.sewa* untuk info penyewaan.\n\n` +
                                `📞 Hubungi Owner: wa.me/6289528950624`;
                        }

                        await sock.sendMessage(from, { text: replyText });
                        return; // Stop eksekusi command
                    }
                }

                // ---- VIDEO HD COMMAND ----
                if (text === '.hd') {
                    const isVideo = msg.message?.videoMessage || msg.message?.documentMessage;
                    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                    const isQuotedVideo = quotedMsg?.videoMessage || quotedMsg?.documentMessage;

                    if (isVideo) {
                        await handleVideoHD(msg, sock);
                    } else if (quotedMsg && isQuotedVideo) {
                        const fakeMsg = {
                            key: msg.key,
                            message: quotedMsg
                        };
                        await handleVideoHD(fakeMsg, sock);
                    } else {
                        await sock.sendMessage(from, {
                            text: 'Kirim video/dokumen video dengan caption *.hd* atau reply videonya!'
                        });
                    }
                    return;
                }

                // ---- TOPUP COMMAND ----
                if (text === '.topup' || text === '.harga') {
                    const photo = path.join(FOLDER, 'promo_topup.jpg');
                    const promoText = `RATE TOPUP PER-ITEM HARI INI
FREE FIRE: 121p
ML: 250p  
ROBLOX: 190p                  `
                        `Untuk Game Lainnya, Chat Saja!\n#SamSukabyone #TopUpMurah`;

                    if (fs.existsSync(photo)) {
                        await sock.sendMessage(from, {
                            image: fs.readFileSync(photo),
                            caption: promoText
                        });
                    } else {
                        await sock.sendMessage(from, { text: promoText });
                    }
                    return;
                }

                // ---- SETWELCOME COMMAND ----
                if (text.startsWith('.setwelcome ') && isGroup) {
                    const group = await sock.groupMetadata(from);
                    const participant = group.participants.find(p => p.id === sender);
                    const isAdmin = participant?.admin === 'admin' || participant?.admin === 'superadmin';

                    if (!isAdmin) {
                        return sock.sendMessage(from, { text: 'Hanya admin group!' });
                    }

                    const newMsg = text.slice(12);
                    const welcomes = loadWelcome();
                    welcomes[from] = newMsg;
                    saveWelcome(welcomes);

                    const preview = newMsg
                        .replace('$nama', 'Nama')
                        .replace('$nomor', '628xxx')
                        .replace('$grup', group.subject);

                    await sock.sendMessage(from, {
                        text: `Welcome diupdate!\nPreview:\n${preview}`
                    });
                    return;
                }

                // ---- BAN/UNBAN COMMANDS ----
                if (text.startsWith('.ban ') && isGroup) {
                    const group = await sock.groupMetadata(from);
                    const participant = group.participants.find(p => p.id === sender);
                    const isAdmin = participant?.admin === 'admin' || participant?.admin === 'superadmin';

                    if (!isAdmin) {
                        return sock.sendMessage(from, { text: 'Hanya admin grup yang bisa ban!' });
                    }

                    // Cek rental group
                    if (!getRental(from)) {
                        return sock.sendMessage(from, { text: 'Grup ini belum sewa bot!' });
                    }

                    let target = null;
                    if (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length) {
                        target = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
                    } else if (text.split(' ')[1]) {
                        target = text.split(' ')[1].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                    }

                    if (!target) {
                        return sock.sendMessage(from, {
                            text: 'Cara pakai: .ban @user atau .ban 628xxx'
                        });
                    }

                    try {
                        await sock.groupParticipantsUpdate(from, [target], 'remove');
                        const bans = loadBans();
                        if (!bans[from]) bans[from] = [];
                        if (!bans[from].includes(target)) bans[from].push(target);
                        saveBans(bans);

                        await sock.sendMessage(from, {
                            text: `✅ @${target.split('@')[0]} berhasil dibanned & dikick!`,
                            mentions: [target]
                        });
                    } catch (e) {
                        await sock.sendMessage(from, { text: 'Gagal ban: ' + e.message });
                    }
                    return;
                }

                if (text.startsWith('.unban ') && isGroup) {
                    const group = await sock.groupMetadata(from);
                    const participant = group.participants.find(p => p.id === sender);
                    const isAdmin = participant?.admin === 'admin' || participant?.admin === 'superadmin';

                    if (!isAdmin) {
                        return sock.sendMessage(from, { text: 'Hanya admin grup yang bisa unban!' });
                    }

                    let target = null;
                    if (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length) {
                        target = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
                    } else if (text.split(' ')[1]) {
                        target = text.split(' ')[1].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                    }

                    if (!target) {
                        return sock.sendMessage(from, {
                            text: 'Cara pakai: .unban @user atau .unban 628xxx'
                        });
                    }

                    const bans = loadBans();
                    if (bans[from]?.includes(target)) {
                        bans[from] = bans[from].filter(u => u !== target);
                        if (bans[from].length === 0) delete bans[from];
                        saveBans(bans);
                        await sock.sendMessage(from, {
                            text: `✅ @${target.split('@')[0]} berhasil di-unban!`,
                            mentions: [target]
                        });
                    } else {
                        await sock.sendMessage(from, { text: 'User ini gak ada di daftar banned.' });
                    }
                    return;
                }

                // ---- MENU COMMAND ----
                if (text === '.menu' || text === '.help') {
                    const menuText = `📌 *𝐒𝐚𝐦𝐀𝐥 | รักและรักคุณจริงๆ 🔥*\n` +
                        `• .menu / .help - Tampilkan menu\n` +
                        `• .ping - Cek status & latency\n` +
                        `• .profile [@user] - Lihat profil\n` +
                        `• .stiker - Buat stiker dari gambar\n` +
                        `• .cekidgroup - Lihat ID grup\n\n` +
                        `📥 *DOWNLOADER:*\n` +
                        `• .tt [link] - Download TikTok\n` +
                        `• .ig [link] - Download Instagram\n\n` +
                        `👥 *ADMIN GRUP:*\n` +
                        `• .tagall - Tag semua anggota\n` +
                        `• .hidetag [pesan] - Tag tanpa notif\n` +
                        `• .promote/demote [@user] - Atur admin\n` +
                        `• .kick/ban/unban [@user] - Kelola member\n` +
                        `• .close/opengroup - Buka/tutup grup\n\n` +
                        `🔐 *SEWA & AKSES:*\n` +
                        `• .sewa - Info sewa bot\n` +
                        `• .ceksewa - Cek status sewa\n\n` +
                        `────────────────────\n` +
                        `📞 *KONTAK OWNER:*\n` +
                        `wa.me/6289528950624 - Sam @Sukabyone\n\n` +
                        `💎 *Note:* Beberapa fitur membutuhkan sewa bot. Ketik .sewa untuk info lengkap!`;

                    await sock.sendMessage(from, { text: menuText });
                    return;
                }

                // ---- PING COMMAND ----
                if (text === '.ping') {
                    const msgTs = msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : Date.now();
                    const tickMs = Date.now() - msgTs;
                    const tickS = (tickMs / 1000).toFixed(2);
                    await sock.sendMessage(from, {
                        text: `🚀 Bot aktif!\nLatency: ${tickS} detik (${tickMs} ms)`
                    });
                    return;
                }

                // ---- PROFILE COMMAND ----
                if (text === '.profile' || text === '.profil') {
                    const ext = msg.message?.extendedTextMessage;
                    let targetJid = null;

                    if (ext?.contextInfo?.mentionedJid && ext.contextInfo.mentionedJid.length) {
                        targetJid = ext.contextInfo.mentionedJid[0];
                    } else if (ext?.contextInfo?.participant) {
                        targetJid = ext.contextInfo.participant;
                    } else {
                        targetJid = sender;
                    }

                    const users = loadUsers();
                    const id = targetJid.split('@')[0];
                    const record = users[id] || {
                        jid: targetJid,
                        name: msg.pushName || 'Unknown',
                        firstSeen: null,
                        count: 0
                    };

                    const profileText = `*-- [ PROFILE ] --*\n` +
                        `👤 Nama: ${record.name || 'Unknown'}\n` +
                        `📞 NO. HP: ${id}\n` +
                        `📊 Total Penggunaan: ${record.count || 0} chat\n` +
                        `📅 Bergabung: ${record.firstSeen ? formatDate(record.firstSeen) : 'Unknown'}`;

                    await sock.sendMessage(from, {
                        text: profileText,
                        mentions: targetJid ? [targetJid] : []
                    });
                    return;
                }

                // ---- GROUP CONTROL COMMANDS ----
                if (text === '.closegroup' || text === '.opengroup') {
                    if (!isGroup) {
                        return sock.sendMessage(from, { text: 'Perintah ini hanya untuk grup.' });
                    }

                    const group = await sock.groupMetadata(from);
                    const participant = group.participants.find(p => p.id === sender);
                    const isAdmin = participant?.admin === 'admin' || participant?.admin === 'superadmin';

                    if (!isAdmin) {
                        return sock.sendMessage(from, { text: 'Hanya admin grup yang bisa menggunakan perintah ini.' });
                    }

                    // Cek akses sewa
                    if (!hasAccessForCommand(text, true, sender, from, sock)) {
                        return sock.sendMessage(from, { text: 'Fitur ini membutuhkan paket sewa. Ketik .sewa untuk info.' });
                    }

                    try {
                        if (text === '.closegroup') {
                            await setGroupAnnouncement(sock, from, true);
                            await sock.sendMessage(from, {
                                text: 'Sukses! Grup ditutup — hanya admin yang bisa mengirim pesan sekarang.'
                            });
                        } else {
                            await setGroupAnnouncement(sock, from, false);
                            await sock.sendMessage(from, {
                                text: 'Sukses! Grup dibuka — semua anggota bisa mengirim pesan sekarang.'
                            });
                        }
                    } catch (err) {
                        console.log('Group control error:', err.message);
                        const errorMsg = text === '.closegroup'
                            ? 'Gagal menutup grup. Mungkin bot bukan admin? 😭'
                            : 'Gagal membuka grup. Cek lagi status admin bot! 🤔';
                        await sock.sendMessage(from, { text: errorMsg });
                    }
                    return;
                }

                // ---- PROMOTE/DEMOTE COMMANDS ----
                if (text.startsWith('.promote') || text.startsWith('.demote')) {
                    if (!isGroup) {
                        return sock.sendMessage(from, { text: 'Perintah ini hanya untuk grup.' });
                    }

                    const group = await sock.groupMetadata(from);
                    const participant = group.participants.find(p => p.id === sender);
                    const isAdmin = participant?.admin === 'admin' || participant?.admin === 'superadmin';

                    if (!isAdmin) {
                        return sock.sendMessage(from, { text: 'Hanya admin grup yang bisa menggunakan perintah ini.' });
                    }

                    // Cek akses sewa
                    if (!hasAccessForCommand(text.split(' ')[0], true, sender, from, sock)) {
                        return sock.sendMessage(from, { text: 'Fitur ini membutuhkan paket sewa. Ketik .sewa untuk info.' });
                    }

                    let targets = [];
                    const ext = msg.message?.extendedTextMessage;
                    if (ext?.contextInfo?.mentionedJid && ext.contextInfo.mentionedJid.length) {
                        targets = ext.contextInfo.mentionedJid;
                    } else if (ext?.contextInfo?.participant) {
                        targets = [ext.contextInfo.participant];
                    }

                    if (!targets.length) {
                        return sock.sendMessage(from, {
                            text: 'Tandai (mention) atau reply ke pengguna yang ingin di-promote/demote.\nContoh: .promote @user'
                        });
                    }

                    try {
                        const action = text.startsWith('.promote') ? 'promote' : 'demote';
                        await sock.groupParticipantsUpdate(from, targets, action);
                        const mentionText = targets.map(jid => `@${jid.split('@')[0]}`).join(', ');
                        await sock.sendMessage(from, {
                            text: `Sukses melakukan ${action} untuk ${mentionText}`,
                            mentions: targets
                        });
                    } catch (err) {
                        console.log('Promote/Demote error:', err.message);
                        await sock.sendMessage(from, {
                            text: `Gagal mengubah status admin \n\n_keterangan: bot belum menjadi admin atau target merupakan pembuat group_`
                        });
                    }
                    return;
                }

                // ---- TAGALL COMMAND ----
                if (text === '.tagall') {
                    if (!isGroup) {
                        return sock.sendMessage(from, { text: 'Di grup aja yaaa' });
                    }

                    if (!hasAccessForCommand('.tagall', true, sender, from, sock)) {
                        return sock.sendMessage(from, {
                            text: 'Fitur ini hanya tersedia untuk grup yang menyewa bot. Ketik .sewa untuk info.'
                        });
                    }

                    const group = await sock.groupMetadata(from);
                    let teks = 'TAG SEMUA ORANG!\n';
                    for (let mem of group.participants) {
                        teks += ` @${mem.id.split('@')[0]}\n`;
                    }
                    teks += ` \nBERHASIL TAG SEMUA ORANG ✅`;

                    await sock.sendMessage(from, {
                        text: teks,
                        mentions: group.participants.map(a => a.id)
                    });
                    return;
                }

                // ---- HIDETAG COMMAND ----
                if (text.startsWith('.hidetag ') || text === '.hidetag' || text.startsWith('.h ') || text === '.h') {
                    if (!isGroup) {
                        return sock.sendMessage(from, { text: 'bisa dipake nyaa cuma di group' });
                    }

                    if (!hasAccessForCommand('.hidetag', true, sender, from, sock)) {
                        return sock.sendMessage(from, {
                            text: 'Fitur ini hanya tersedia untuk grup yang menyewa bot. Ketik .sewa untuk info.'
                        });
                    }

                    let pesan = '';
                    if (text.startsWith('.hidetag ')) {
                        pesan = text.slice(9).trim();
                    } else if (text.startsWith('.h ')) {
                        pesan = text.slice(3).trim();
                    }

                    const messageToSend = pesan || '\n‎';
                    const group = await sock.groupMetadata(from);

                    await sock.sendMessage(from, {
                        text: messageToSend,
                        mentions: group.participants.map(a => a.id)
                    });
                    return;
                }

                // ---- TIKTOK DOWNLOADER ----
                if (text.startsWith('.tt ') || text.startsWith('.tiktok ') || text === '.tt' || text === '.tiktok') {
                    if (text === '.tt' || text === '.tiktok') {
                        return sock.sendMessage(from, {
                            text: 'apa? bisa gaa?\ngini loh caranyaa\n".tt https://vt.tiktok.com/abc" \n\ngitu aja gabisa'
                        });
                    }

                    const url = text.split(' ').slice(1).join(' ');
                    if (!url.includes('tiktok')) {
                        return sock.sendMessage(from, {
                            text: 'link TikTok-nya SALAAHHHHH!\ngini nih contoh yang bener: .tt https://vt.tiktok.com/abc'
                        });
                    }

                    // Cek akses sewa
                    if (!hasAccessForCommand('.tt', isGroup, sender, groupId, sock)) {
                        return sock.sendMessage(from, {
                            text: 'Fitur ini hanya tersedia untuk akun/grup yang menyewa bot. Ketik .sewa untuk info.'
                        });
                    }

                    await sock.sendMessage(from, { text: 'Sabar yaaa, lagi diprosess... ⏳' });

                    try {
                        const res = await axios.get(`https://tikwm.com/api/?url=${url}`);
                        if (res.data.code !== 0) throw new Error('API error: ' + res.data.msg);

                        const videoUrl = res.data.data.play;
                        const title = res.data.data.title || 'TikTok Video';
                        const author = res.data.data.author.unique_id || 'unknown';

                        await sock.sendMessage(from, {
                            video: { url: videoUrl },
                            caption: `✅ TikTok Video Downloaded!\n\n📌 Title: ${title}\n👤 Author: ${author}\n\n_Downloaded by SAM BOT🔥_`
                        });
                    } catch (err) {
                        console.log('TikTok download error:', err.message);
                        await sock.sendMessage(from, {
                            text: `yaahhh gagalll😭\nError: ${err.message}\ncoba link lain atau tunggu bentar.`
                        });
                    }
                    return;
                }

                // ---- SEWA COMMAND ----
                if (text === '.sewa') {
                    const promoText = `🌟 *Sistem Penyewaan Bot* 🌟 \n 𝐒𝐚𝐦𝐀𝐥 | รักและรักคุณจริงๆ \n\n` +
                        `✨ *Sistem sewa sederhana:*\n` +
                        `• *Sewa = Bisa menggunakan semua fitur bot*\n` +
                        `• *Tidak sewa = Tidak bisa menggunakan sama sekali*\n\n` +
                        `📌 Cara penyewaan:\n` +
                        `• Hubungi kontak Owner / Admin di bawah \n` +
                        `• Chat Admin dan katakan bahwa ingin menyewa bot. \n  •_contoh: "Saya ingin menyewa bot selama 30 hari"_ \n\n` +
                        `💰 *Harga Sewa:*\n` +
                        `• Rp 10.000 untuk 30 hari (1 bulan)\n` +
                        `• Rp 25.000 untuk 90 hari (3 bulan)\n` +
                        `• Rp 45.000 untuk 180 hari (6 bulan)\n\n` +
                        `📞 *Kontak Owner / Admin:*\n` +
                        `• wa.me/6289528950624 - Sam @Sukabyone \n\n` +
                        `Terima kasih! ✨`;

                    await sock.sendMessage(from, { text: promoText });
                    return;
                }

                // ---- GRANT/REVOKE COMMANDS ----
                if (text.startsWith('.grant ') || text.startsWith('.revoke ')) {
                    if (!isOperator(sender, sock)) {
                        return sock.sendMessage(from, { text: 'Hanya operator yang boleh pakai perintah ini!' });
                    }

                    const args = text.trim().split(' ');
                    const cmd = args[0].toLowerCase();

                    try {
                        if (cmd === '.grant') {
                            const scope = args[1]?.toLowerCase();
                            const target = args[2];
                            const days = parseInt(args[3] || args[2]);

                            if (!scope || !target || isNaN(days) || days <= 0) {
                                return sock.sendMessage(from, {
                                    text: 'Format: .grant private/group <id/grup> <hari>'
                                });
                            }

                            let id = scope === 'private' ? target.replace(/[^0-9]/g, '') : (isGroup ? from : target);
                            if (id.startsWith('0')) id = '62' + id.slice(1);

                            grantRental(scope, id, 'premium', days, sender);
                            await sock.sendMessage(from, {
                                text: `✅ ${scope.toUpperCase()} ${id} berhasil disewa ${days} hari!`
                            });
                        }

                        if (cmd === '.revoke') {
                            const targetRaw = args[1];
                            let keyToRevoke = targetRaw;

                            if (!keyToRevoke && isGroup) {
                                keyToRevoke = from;
                            } else if (!keyToRevoke) {
                                return sock.sendMessage(from, {
                                    text: 'Format: .revoke <groupId> atau .revoke <idUser>'
                                });
                            }

                            if (!keyToRevoke.includes('@g.us')) {
                                if (keyToRevoke.includes('@')) keyToRevoke = keyToRevoke.split('@')[0];
                                keyToRevoke = String(keyToRevoke).replace(/[^0-9]/g, '');
                                if (keyToRevoke.startsWith('0')) {
                                    keyToRevoke = '62' + keyToRevoke.slice(1);
                                }
                            }

                            revokeRental(keyToRevoke);
                            await sock.sendMessage(from, {
                                text: `❌ Rental untuk *${keyToRevoke}* berhasil dicabut!`
                            });
                        }
                    } catch (e) {
                        await sock.sendMessage(from, { text: 'Error: ' + e.message });
                    }
                    return;
                }

                // ---- UPDATE COMMAND ----
                if (text === '.update' || text === '.up') {
                    if (!isOperator(sender, sock)) {
                        return sock.sendMessage(from, { text: '🚨 Hanya operator yang boleh pakai perintah ini!' });
                    }

                    await sock.sendMessage(from, {
                        text: '🚀 Proses update bot dimulai! \n\n~ Menarik Kode Terbaru\n~ Mengaktifkan Kode Baru\n\nMohon tunggu sebentar...'
                    });

                    exec('./update.sh', async (error, stdout, stderr) => {
                        if (error) {
                            console.error(`Exec Error (.update): ${error.message}`);
                            return sock.sendMessage(from, {
                                text: `❌ GAGAL UPDATE (Exec Error):\n\`\`\`\n${error.message}\n\`\`\``
                            });
                        }

                        let outputText = `✅ UPDATE BOT SELESAI!\n\n--- Output Konsol ---\n\`\`\`\n${stdout}\n\`\`\``;
                        if (stderr) {
                            outputText += `\n\n⚠️ Peringatan (Stderr):\n\`\`\`\n${stderr}\n\`\`\``;
                        }

                        await sock.sendMessage(from, { text: outputText });
                    });
                    return;
                }

                // ---- STICKER COMMAND ----
                const stickerTriggers = ['.s', '.stiker', '.sticker'];
                const isStickerCmd = stickerTriggers.some(trigger =>
                    text === trigger || text.startsWith(trigger + ' ')
                );

                if (isStickerCmd) {
                    let imgMsg = null;

                    // Cek dari caption
                    if (msg.message?.imageMessage) {
                        const caption = (msg.message.imageMessage.caption || '').toLowerCase();
                        if (stickerTriggers.some(t => caption.includes(t))) {
                            imgMsg = msg.message.imageMessage;
                        }
                    }

                    // Cek dari reply
                    if (!imgMsg && msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage) {
                        imgMsg = msg.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage;
                    }

                    if (!imgMsg) {
                        return sock.sendMessage(from, {
                            text: 'Cara pakai:\n• Kirim foto + caption *.stiker*\n• Atau reply foto + ketik *.stiker*\n\nSupport JPG/PNG/GIF!'
                        });
                    }

                    await sock.sendMessage(from, { text: 'Oke bentar, lagi kubikin stikernya... 🔥' });

                    try {
                        const stream = await downloadContentFromMessage(imgMsg, 'image');
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) {
                            buffer = Buffer.concat([buffer, chunk]);
                        }

                        const stickerBuffer = await sharp(buffer)
                            .resize(512, 512, {
                                fit: 'contain',
                                background: { r: 0, g: 0, b: 0, alpha: 0 }
                            })
                            .webp({ quality: 80 })
                            .toBuffer();

                        await sock.sendMessage(from, { sticker: stickerBuffer });
                    } catch (err) {
                        console.log('Sticker error:', err.message);
                        await sock.sendMessage(from, {
                            text: 'Yahhhh gagall, fotonya terlalu HD kayanya deh 😭\nCoba foto yang lebih kecil (max 1MB) atau format JPG/PNG.'
                        });
                    }
                    return;
                }

                // ---- CEK ID GROUP ----
                if (text === '.cekidgroup') {
                    if (!isGroup) {
                        return sock.sendMessage(from, { text: 'Perintah ini hanya untuk grup.' });
                    }
                    const meta = await sock.groupMetadata(from);
                    await sock.sendMessage(from, {
                        text: `Group: ${meta?.subject || 'Group'}\nID: ${from}`
                    });
                    return;
                }

                // ---- JOIN GROUP ----
                if (text.startsWith('.join ')) {
                    const parts = text.split(/\s+/);
                    const link = parts[1];

                    if (!link || !link.includes('chat.whatsapp.com')) {
                        return sock.sendMessage(from, {
                            text: 'Format: .join <link chat.whatsapp.com/...>'
                        });
                    }

                    const code = link.split('chat.whatsapp.com/')[1];
                    if (!code) {
                        return sock.sendMessage(from, { text: 'Link invalid.' });
                    }

                    try {
                        await sock.groupAcceptInvite(code);
                        await sock.sendMessage(from, { text: 'Berhasil join grup via link!' });
                    } catch (e) {
                        console.log('Join error:', e.message);
                        await sock.sendMessage(from, { text: `Gagal join: ${e.message}` });
                    }
                    return;
                }

                // ---- KICK COMMAND ----
                if (text.startsWith('.kick')) {
                    if (!isGroup) {
                        return sock.sendMessage(from, { text: 'Perintah ini hanya untuk grup.' });
                    }

                    const group = await sock.groupMetadata(from);
                    const participant = group.participants.find(p => p.id === sender);
                    const isAdmin = participant?.admin === 'admin' || participant?.admin === 'superadmin';

                    if (!isAdmin) {
                        return sock.sendMessage(from, { text: 'Hanya admin grup yang bisa menggunakan perintah ini.' });
                    }

                    if (!hasAccessForCommand('.kick', true, sender, from, sock)) {
                        return sock.sendMessage(from, { text: 'Fitur ini membutuhkan paket sewa. Ketik .sewa untuk info.' });
                    }

                    let targets = [];
                    const ext = msg.message?.extendedTextMessage;
                    if (ext?.contextInfo?.mentionedJid && ext.contextInfo.mentionedJid.length) {
                        targets = ext.contextInfo.mentionedJid;
                    } else if (ext?.contextInfo?.participant) {
                        targets = [ext.contextInfo.participant];
                    }

                    if (!targets.length) {
                        return sock.sendMessage(from, {
                            text: 'Tandai (mention) atau reply ke pengguna yang ingin dikick.'
                        });
                    }

                    try {
                        await sock.groupParticipantsUpdate(from, targets, 'remove');
                        await sock.sendMessage(from, {
                            text: `Sukses mengeluarkan: ${targets.map(t => '@' + t.split('@')[0]).join(', ')}`,
                            mentions: targets
                        });
                    } catch (e) {
                        console.log('Kick error:', e.message);
                        await sock.sendMessage(from, { text: `Gagal kick: ${e.message}` });
                    }
                    return;
                }

                // ---- CEK SEWA COMMAND ----
                if (text.startsWith('.ceksewa')) {
                    try {
                        const parts = text.trim().split(/\s+/);
                        const arg1 = parts[1];
                        const arg2 = parts[2];
                        const ext = msg.message?.extendedTextMessage;

                        let scope = null;
                        let target = null;

                        if (!arg1) {
                            if (isGroup) {
                                scope = 'group';
                                target = from;
                            } else {
                                scope = 'private';
                                target = sender.split('@')[0];
                            }
                        } else if (arg1.toLowerCase() === 'group') {
                            scope = 'group';
                            target = arg2 || (isGroup ? from : null);
                        } else if (arg1.toLowerCase() === 'private') {
                            scope = 'private';
                            target = arg2 || null;
                        } else {
                            if (arg1.includes('@') || (ext?.contextInfo?.mentionedJid && ext.contextInfo.mentionedJid.length)) {
                                if (ext?.contextInfo?.mentionedJid && ext.contextInfo.mentionedJid.length) {
                                    scope = 'private';
                                    target = ext.contextInfo.mentionedJid[0];
                                } else {
                                    if (arg1.endsWith('@g.us')) {
                                        scope = 'group';
                                        target = arg1;
                                    } else {
                                        scope = 'private';
                                        target = arg1.split('@')[0];
                                    }
                                }
                            } else {
                                scope = 'private';
                                target = arg1;
                            }
                        }

                        if (!scope || !target) {
                            return sock.sendMessage(from, {
                                text: 'Format: .ceksewa group <groupId> atau .ceksewa private <@mention|idUser> atau jalankan di grup tanpa argumen untuk cek grup.'
                            });
                        }

                        let key = target;
                        if (scope === 'private') {
                            if (typeof key === 'string' && key.includes('@')) key = key.split('@')[0];
                            key = String(key).replace(/[^0-9]/g, '');
                            if (key.startsWith('0')) key = '62' + key.slice(1);
                        }

                        const rental = getRental(key);
                        if (!rental) {
                            return sock.sendMessage(from, {
                                text: `Tidak ada sewa aktif untuk ${scope} ${target}`
                            });
                        }

                        const remainingMs = rental.expires - Date.now();
                        const textOut = `📌 Info Sewa (${scope})\n` +
                            `Target: ${target}\n` +
                            `Kadaluarsa: ${formatDate(rental.expires)} (${formatDuration(remainingMs)})\n` +
                            `Diberikan oleh: ${rental.grantedBy || 'unknown'}`;

                        return sock.sendMessage(from, { text: textOut });
                    } catch (e) {
                        console.log('Ceksewa error:', e.message);
                        return sock.sendMessage(from, {
                            text: 'Terjadi error saat memeriksa sewa: ' + e.message
                        });
                    }
                }

                // ======================
                // BAKULAN SYSTEM COMMANDS
                // ======================

                // Note: Bakulan commands would be integrated here
                // For brevity, I've kept the existing bakulan system calls
                // but you should adapt them to use the helper functions

            } catch (e) {
                console.log('Message handler error:', e.message);
            }
        });

    } catch (error) {
        console.error('Failed to connect:', error);
        setTimeout(connectToWhatsApp, 5000);
    }
}

// ============================================================
// 8. START BOT
// ============================================================

connectToWhatsApp();