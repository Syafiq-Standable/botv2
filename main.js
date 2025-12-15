const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, downloadContentFromMessage, downloadMediaMessage, generateForwardMessageContent, prepareWAMessageMedia } = require('@whiskeysockets/baileys');
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
const ytdl = require('@distube/ytdl-core');
const FormData = require('form-data');
const { Image } = require('canvas');
const { spawn } = require('child_process');
const fetch = require('node-fetch');
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
const PREMIUM_DB = path.join(FOLDER, 'premium.json');
const SETTINGS_DB = path.join(FOLDER, 'settings.json');
const GAME_DB = path.join(FOLDER, 'games.json');

// Buat folder data jika belum ada
try {
    if (!fs.existsSync(FOLDER)) fs.mkdirSync(FOLDER, { recursive: true });
} catch (e) {
    console.log('Gagal membuat folder data:', e.message);
}

// ============================================================
// 1. FUNGSI HELPER & UTILITY
// ============================================================

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
            caption: 'Nih, coba cek sekarang. Harusnya udah gak blank hitam lagi.',
            mimetype: 'video/mp4',
            fileName: 'video_hd.mp4'
        }, { quoted: m });
    } catch (err) {
        console.log('Error HD:', err);
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

/**
 * Helper: Download file dari URL
 */
async function downloadFile(url, filename) {
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream'
    });
    const writer = fs.createWriteStream(filename);
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

/**
 * Helper: Random item dari array
 */
function getRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
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
const loadPremium = () => loadJSON(PREMIUM_DB, []);
const savePremium = (data) => saveJSON(PREMIUM_DB, data);
const loadSettings = () => loadJSON(SETTINGS_DB, {});
const saveSettings = (data) => saveJSON(SETTINGS_DB, data);
const loadGames = () => loadJSON(GAME_DB, {});
const saveGames = (data) => saveJSON(GAME_DB, data);

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

/**
 * Cek apakah user premium
 */
function isPremium(userId) {
    const premium = loadPremium();
    return premium.includes(userId);
}

/**
 * Tambah user premium
 */
function addPremium(userId) {
    const premium = loadPremium();
    if (!premium.includes(userId)) {
        premium.push(userId);
        savePremium(premium);
    }
}

/**
 * Hapus user premium
 */
function removePremium(userId) {
    const premium = loadPremium();
    const index = premium.indexOf(userId);
    if (index > -1) {
        premium.splice(index, 1);
        savePremium(premium);
    }
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
    if (cmd === '.sewa' || cmd === '.menu' || cmd === '.help' || cmd === '.ping') return true;

    // Operator selalu diizinkan
    if (isOperator(senderFullJid, sock)) return true;

    // Premium user diizinkan
    if (isPremium(senderFullJid.split('@')[0])) return true;

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
            caption: `Mau top up? Di sini aja yang murah.

FF: 70💎 (8k) | 140💎 (15k) | Weekly (26k) ML: 3💎 (1k) | 1050💎 (262k) | Weekly (27k) Lainnya: Roblox, PUBG, Genshin ready.

Detail lain tanya di wa.me/6289528950624 #TopUpMurah #Diamond`
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
// 7. FUNGSI DOWNLOADER
// ============================================================

/**
 * Download YouTube MP3
 */
async function youtubeMp3(url, sock, from, msg) {
    try {
        await sock.sendMessage(from, { text: '⏳ Sedang mengunduh audio YouTube...' }, { quoted: msg });
        
        const info = await ytdl.getInfo(url);
        const title = info.videoDetails.title.replace(/[^\w\s]/gi, '');
        
        const audioStream = ytdl(url, {
            quality: 'highestaudio',
            filter: 'audioonly'
        });
        
        const tempFile = path.join(FOLDER, `audio_${Date.now()}.mp3`);
        const writeStream = fs.createWriteStream(tempFile);
        
        audioStream.pipe(writeStream);
        
        await new Promise((resolve, reject) => {
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
        });
        
        await sock.sendMessage(from, {
            audio: fs.readFileSync(tempFile),
            mimetype: 'audio/mpeg',
            fileName: `${title}.mp3`
        }, { quoted: msg });
        
        fs.unlinkSync(tempFile);
    } catch (error) {
        console.error('YouTube MP3 Error:', error);
        await sock.sendMessage(from, { text: `❌ Gagal mengunduh audio: ${error.message}` }, { quoted: msg });
    }
}

/**
 * Download YouTube MP4
 */
async function youtubeMp4(url, sock, from, msg) {
    try {
        await sock.sendMessage(from, { text: '⏳ Sedang mengunduh video YouTube...' }, { quoted: msg });
        
        const info = await ytdl.getInfo(url);
        const title = info.videoDetails.title.replace(/[^\w\s]/gi, '');
        
        const videoStream = ytdl(url, {
            quality: 'highest',
            filter: 'videoandaudio'
        });
        
        const tempFile = path.join(FOLDER, `video_${Date.now()}.mp4`);
        const writeStream = fs.createWriteStream(tempFile);
        
        videoStream.pipe(writeStream);
        
        await new Promise((resolve, reject) => {
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
        });
        
        await sock.sendMessage(from, {
            video: fs.readFileSync(tempFile),
            mimetype: 'video/mp4',
            fileName: `${title}.mp4`,
            caption: `📹 ${title}`
        }, { quoted: msg });
        
        fs.unlinkSync(tempFile);
    } catch (error) {
        console.error('YouTube MP4 Error:', error);
        await sock.sendMessage(from, { text: `❌ Gagal mengunduh video: ${error.message}` }, { quoted: msg });
    }
}

/**
 * Download Instagram
 */
async function downloadInstagram(url, sock, from, msg) {
    try {
        await sock.sendMessage(from, { text: '⏳ Mengunduh dari Instagram...' }, { quoted: msg });
        
        const apiUrl = `https://api.instagram.com/oembed/?url=${encodeURIComponent(url)}`;
        const response = await axios.get(apiUrl);
        
        if (response.data.thumbnail_url) {
            await sock.sendMessage(from, {
                image: { url: response.data.thumbnail_url },
                caption: `📸 Instagram\n${response.data.title || 'Post Instagram'}`
            }, { quoted: msg });
        } else {
            await sock.sendMessage(from, { text: '❌ Tidak dapat mengunduh konten Instagram' }, { quoted: msg });
        }
    } catch (error) {
        console.error('Instagram Error:', error);
        await sock.sendMessage(from, { text: `❌ Gagal mengunduh Instagram: ${error.message}` }, { quoted: msg });
    }
}

/**
 * Download Facebook
 */
async function downloadFacebook(url, sock, from, msg) {
    try {
        await sock.sendMessage(from, { text: '⏳ Mengunduh dari Facebook...' }, { quoted: msg });
        
        // Menggunakan API pihak ketiga
        const apiUrl = `https://fbdown.net/download.php?url=${encodeURIComponent(url)}`;
        const response = await axios.get(apiUrl);
        
        // Parsing HTML untuk mendapatkan link download
        const $ = cheerio.load(response.data);
        const downloadLink = $('a[href*="facebook.com"]').attr('href');
        
        if (downloadLink) {
            await sock.sendMessage(from, {
                video: { url: downloadLink },
                caption: '📹 Video Facebook'
            }, { quoted: msg });
        } else {
            await sock.sendMessage(from, { text: '❌ Tidak dapat mengunduh video Facebook' }, { quoted: msg });
        }
    } catch (error) {
        console.error('Facebook Error:', error);
        await sock.sendMessage(from, { text: `❌ Gagal mengunduh Facebook: ${error.message}` }, { quoted: msg });
    }
}

/**
 * Download Twitter
 */
async function downloadTwitter(url, sock, from, msg) {
    try {
        await sock.sendMessage(from, { text: '⏳ Mengunduh dari Twitter...' }, { quoted: msg });
        
        // Menggunakan API twitsave
        const apiUrl = `https://twitsave.com/info?url=${encodeURIComponent(url)}`;
        const response = await axios.get(apiUrl);
        
        if (response.data.video) {
            await sock.sendMessage(from, {
                video: { url: response.data.video },
                caption: `🐦 Twitter Video\n${response.data.text || ''}`
            }, { quoted: msg });
        } else {
            await sock.sendMessage(from, { text: '❌ Tidak dapat mengunduh video Twitter' }, { quoted: msg });
        }
    } catch (error) {
        console.error('Twitter Error:', error);
        await sock.sendMessage(from, { text: `❌ Gagal mengunduh Twitter: ${error.message}` }, { quoted: msg });
    }
}

// ============================================================
// 8. FUNGSI AI
// ============================================================

/**
 * ChatGPT
 */
async function chatGPT(prompt, sock, from, msg) {
    try {
        await sock.sendMessage(from, { text: '🤖 Sedang berpikir...' }, { quoted: msg });
        
        // Menggunakan API OpenAI
        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 1000
        }, {
            headers: {
                'Authorization': `Bearer YOUR_OPENAI_API_KEY`, // Ganti dengan API key Anda
                'Content-Type': 'application/json'
            }
        });
        
        const answer = response.data.choices[0].message.content;
        await sock.sendMessage(from, { text: `🤖 ChatGPT:\n\n${answer}` }, { quoted: msg });
    } catch (error) {
        console.error('ChatGPT Error:', error);
        await sock.sendMessage(from, { text: '❌ Gagal menghubungi ChatGPT. Coba lagi nanti.' }, { quoted: msg });
    }
}

/**
 * DALL-E Image Generation
 */
async function dalleGenerate(prompt, sock, from, msg) {
    try {
        await sock.sendMessage(from, { text: '🎨 Sedang membuat gambar...' }, { quoted: msg });
        
        const response = await axios.post('https://api.openai.com/v1/images/generations', {
            prompt: prompt,
            n: 1,
            size: '512x512'
        }, {
            headers: {
                'Authorization': `Bearer YOUR_OPENAI_API_KEY`, // Ganti dengan API key Anda
                'Content-Type': 'application/json'
            }
        });
        
        const imageUrl = response.data.data[0].url;
        await sock.sendMessage(from, {
            image: { url: imageUrl },
            caption: `🎨 DALL-E: ${prompt}`
        }, { quoted: msg });
    } catch (error) {
        console.error('DALL-E Error:', error);
        await sock.sendMessage(from, { text: '❌ Gagal membuat gambar. Coba lagi nanti.' }, { quoted: msg });
    }
}

/**
 * Remini - Enhance Foto
 */
async function reminiEnhance(imageBuffer, sock, from, msg) {
    try {
        await sock.sendMessage(from, { text: '✨ Sedang meningkatkan kualitas foto...' }, { quoted: msg });
        
        // Menggunakan API Remini
        const formData = new FormData();
        formData.append('image', imageBuffer, 'photo.jpg');
        
        const response = await axios.post('https://api.remini.ai/v1/enhance', formData, {
            headers: {
                ...formData.getHeaders(),
                'Authorization': 'Bearer YOUR_REMINI_API_KEY' // Ganti dengan API key Anda
            }
        });
        
        const enhancedImage = Buffer.from(response.data.image, 'base64');
        await sock.sendMessage(from, {
            image: enhancedImage,
            caption: '✨ Foto telah ditingkatkan kualitasnya'
        }, { quoted: msg });
    } catch (error) {
        console.error('Remini Error:', error);
        await sock.sendMessage(from, { text: '❌ Gagal meningkatkan kualitas foto.' }, { quoted: msg });
    }
}

// ============================================================
// 9. FUNGSI STICKER
// ============================================================

/**
 * Buat Sticker dari Gambar
 */
async function createSticker(imageBuffer, packName = 'SAM BOT', author = 'Sukabyone', sock, from, msg) {
    try {
        await sock.sendMessage(from, { text: '🔄 Membuat sticker...' }, { quoted: msg });
        
        // Resize image ke 512x512
        const stickerBuffer = await sharp(imageBuffer)
            .resize(512, 512, {
                fit: 'contain',
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            })
            .webp({ quality: 80 })
            .toBuffer();
        
        await sock.sendMessage(from, {
            sticker: stickerBuffer
        }, { quoted: msg });
    } catch (error) {
        console.error('Sticker Error:', error);
        await sock.sendMessage(from, { text: '❌ Gagal membuat sticker.' }, { quoted: msg });
    }
}

/**
 * Buat Sticker dengan Teks
 */
async function createTextSticker(text, sock, from, msg) {
    try {
        // Menggunakan API external untuk membuat sticker dengan teks
        const apiUrl = `https://api.ephoto360.com/create-text-sticker?text=${encodeURIComponent(text)}`;
        const response = await axios.get(apiUrl);
        
        if (response.data.url) {
            await sock.sendMessage(from, {
                image: { url: response.data.url },
                caption: `📝 Sticker dengan teks: ${text}`
            }, { quoted: msg });
        }
    } catch (error) {
        console.error('Text Sticker Error:', error);
        await sock.sendMessage(from, { text: '❌ Gagal membuat sticker dengan teks.' }, { quoted: msg });
    }
}

// ============================================================
// 10. FUNGSI GAME
// ============================================================

/**
 * Truth or Dare
 */
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
    
    if (type === 'truth') {
        return getRandom(truths);
    } else {
        return getRandom(dares);
    }
}

/**
 * Tebak Gambar
 */
async function tebakGambar(sock, from, msg) {
    try {
        const games = loadGames();
        const gameId = `tebakgambar_${from}_${Date.now()}`;
        
        // Daftar gambar untuk ditebak
        const gambarList = [
            { image: 'https://example.com/gambar1.jpg', jawaban: 'apel' },
            { image: 'https://example.com/gambar2.jpg', jawaban: 'mobil' },
            // Tambahkan lebih banyak gambar
        ];
        
        const selected = getRandom(gambarList);
        
        games[gameId] = {
            type: 'tebakgambar',
            chat: from,
            jawaban: selected.jawaban.toLowerCase(),
            expired: Date.now() + 60000 // 1 menit
        };
        
        saveGames(games);
        
        await sock.sendMessage(from, {
            image: { url: selected.image },
            caption: '🎮 TEBAK GAMBAR\n\nApa yang ada di gambar ini?\n\nWaktu: 60 detik'
        }, { quoted: msg });
        
        // Timer
        setTimeout(() => {
            const currentGames = loadGames();
            if (currentGames[gameId]) {
                delete currentGames[gameId];
                saveGames(currentGames);
                sock.sendMessage(from, {
                    text: `⏰ Waktu habis! Jawabannya adalah: *${selected.jawaban}*`
                });
            }
        }, 60000);
        
    } catch (error) {
        console.error('Game Error:', error);
    }
}

// ============================================================
// 11. FUNGSI UTILITY
// ============================================================

/**
 * QR Code Generator
 */
async function generateQR(text, sock, from, msg) {
    try {
        const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(text)}`;
        
        await sock.sendMessage(from, {
            image: { url: qrCodeUrl },
            caption: `📱 QR Code untuk: ${text}`
        }, { quoted: msg });
    } catch (error) {
        console.error('QR Code Error:', error);
        await sock.sendMessage(from, { text: '❌ Gagal membuat QR Code.' }, { quoted: msg });
    }
}

/**
 * QR Code Reader
 */
async function readQR(imageBuffer, sock, from, msg) {
    try {
        // Simpan gambar sementara
        const tempFile = path.join(FOLDER, `qr_${Date.now()}.jpg`);
        fs.writeFileSync(tempFile, imageBuffer);
        
        // Menggunakan API untuk membaca QR
        const formData = new FormData();
        formData.append('file', fs.createReadStream(tempFile));
        
        const response = await axios.post('https://api.qrserver.com/v1/read-qr-code/', formData, {
            headers: formData.getHeaders()
        });
        
        const qrData = response.data[0]?.symbol[0]?.data;
        
        if (qrData) {
            await sock.sendMessage(from, { text: `📖 QR Code berisi:\n\n${qrData}` }, { quoted: msg });
        } else {
            await sock.sendMessage(from, { text: '❌ Tidak dapat membaca QR Code.' }, { quoted: msg });
        }
        
        fs.unlinkSync(tempFile);
    } catch (error) {
        console.error('QR Read Error:', error);
        await sock.sendMessage(from, { text: '❌ Gagal membaca QR Code.' }, { quoted: msg });
    }
}

/**
 * Cuaca
 */
async function getWeather(city, sock, from, msg) {
    try {
        const response = await axios.get(`https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=YOUR_API_KEY&units=metric&lang=id`);
        
        const weather = response.data;
        const weatherText = `
🌤️ *CUACA DI ${weather.name.toUpperCase()}*
        
🌡️ Suhu: ${weather.main.temp}°C
📈 Maks: ${weather.main.temp_max}°C
📉 Min: ${weather.main.temp_min}°C
💧 Kelembaban: ${weather.main.humidity}%
💨 Angin: ${weather.wind.speed} m/s
☁️ Kondisi: ${weather.weather[0].description}
        
📍 Lokasi: ${weather.coord.lat}, ${weather.coord.lon}
        `;
        
        await sock.sendMessage(from, { text: weatherText }, { quoted: msg });
    } catch (error) {
        console.error('Weather Error:', error);
        await sock.sendMessage(from, { text: '❌ Gagal mendapatkan informasi cuaca.' }, { quoted: msg });
    }
}

/**
 * Jadwal Sholat
 */
async function getPrayerTime(city, sock, from, msg) {
    try {
        const response = await axios.get(`https://api.aladhan.com/v1/timingsByCity?city=${city}&country=Indonesia&method=8`);
        
        const timings = response.data.data.timings;
        const prayerText = `
🕌 *JADWAL SHOLAT DI ${city.toUpperCase()}*
        
🌄 Subuh: ${timings.Fajr}
🌅 Terbit: ${timings.Sunrise}
☀️ Dzuhur: ${timings.Dhuhr}
🌤️ Ashar: ${timings.Asr}
🌇 Maghrib: ${timings.Maghrib}
🌙 Isya: ${timings.Isha}
        
📅 Tanggal: ${response.data.data.date.hijri.day} ${response.data.data.date.hijri.month.en} ${response.data.data.date.hijri.year}
        `;
        
        await sock.sendMessage(from, { text: prayerText }, { quoted: msg });
    } catch (error) {
        console.error('Prayer Time Error:', error);
        await sock.sendMessage(from, { text: '❌ Gagal mendapatkan jadwal sholat.' }, { quoted: msg });
    }
}

// ============================================================
// 12. FUNGSI MAKER
// ============================================================

/**
 * Logo Maker
 */
async function createLogo(text, style = 'glitch', sock, from, msg) {
    try {
        // Menggunakan API textpro
        const apiUrl = `https://textpro.me/${style}-effect-${Date.now()}`;
        // Implementasi sesuai dengan API yang tersedia
        
        await sock.sendMessage(from, {
            image: { url: apiUrl },
            caption: `🎨 Logo: ${text}`
        }, { quoted: msg });
    } catch (error) {
        console.error('Logo Maker Error:', error);
        await sock.sendMessage(from, { text: '❌ Gagal membuat logo.' }, { quoted: msg });
    }
}

// ============================================================
// 13. FUNGSI ANIME
// ============================================================

/**
 * Waifu Generator
 */
async function getWaifu(sock, from, msg) {
    try {
        const response = await axios.get('https://api.waifu.pics/sfw/waifu');
        const waifuUrl = response.data.url;
        
        await sock.sendMessage(from, {
            image: { url: waifuUrl },
            caption: '🌸 Your waifu~'
        }, { quoted: msg });
    } catch (error) {
        console.error('Waifu Error:', error);
        await sock.sendMessage(from, { text: '❌ Gagal mendapatkan waifu.' }, { quoted: msg });
    }
}

/**
 * Cari Anime
 */
async function searchAnime(query, sock, from, msg) {
    try {
        const response = await axios.get(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=5`);
        
        if (response.data.data.length > 0) {
            let animeText = '🎌 *HASIL PENCARIAN ANIME*\n\n';
            
            response.data.data.forEach((anime, index) => {
                animeText += `*${index + 1}. ${anime.title}*\n`;
                animeText += `📺 Episode: ${anime.episodes || '?'}\n`;
                animeText += `⭐ Score: ${anime.score || '?'}\n`;
                animeText += `📅 Tahun: ${anime.year || '?'}\n`;
                animeText += `🔗 MyAnimeList: ${anime.url}\n\n`;
            });
            
            await sock.sendMessage(from, { text: animeText }, { quoted: msg });
        } else {
            await sock.sendMessage(from, { text: '❌ Anime tidak ditemukan.' }, { quoted: msg });
        }
    } catch (error) {
        console.error('Anime Search Error:', error);
        await sock.sendMessage(from, { text: '❌ Gagal mencari anime.' }, { quoted: msg });
    }
}

// ============================================================
// 14. MAIN BOT CONNECTION & MESSAGE HANDLER
// ============================================================

async function connectToWhatsApp() {
    try {
        // ======================
        // 14.1. INITIALIZATION
        // ======================
        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

        const sock = makeWASocket({
            auth: state,
            version: [2, 3000, 1027934701],
        });

        // ======================
        // 14.2. SETUP SCHEDULERS & HANDLERS
        // ======================
        setupDailyPromo(sock);
        setupWelcomeHandler(sock);
        setupBanHandler(sock);

        // ======================
        // 14.3. CONNECTION HANDLERS
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
        // 14.4. MAIN MESSAGE HANDLER
        // ======================
        sock.ev.on('messages.upsert', async (m) => {
            try {
                const msg = m.messages[0];
                if (!msg.message || msg.key.fromMe) return;

                const isDoc = msg.message?.documentMessage;
                const docCaption = msg.message?.documentMessage?.caption?.toLowerCase() || '';

                const from = msg.key.remoteJid;
                const text = (
                    msg.message?.conversation ||
                    msg.message?.extendedTextMessage?.text ||
                    msg.message?.imageMessage?.caption ||
                    msg.message?.videoMessage?.caption ||
                    ''
                ).trim();

                const textLower = text.toLowerCase();
                const sender = msg.key.participant || from;
                const isGroup = from.endsWith('@g.us');
                const groupId = from;

                // --- UPDATE USER RECORD ---
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

                // --- ANTI BANNED USER ---
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

                // --- ANTI LINK ---
                const groupLinkRegex = /chat.whatsapp.com\/(?:invite\/)?([0-9a-zA-Z]{20,26})/i;
                if (isGroup && groupLinkRegex.test(textLower) && !textLower.startsWith('.join')) {
                    const groupMetadata = await sock.groupMetadata(from);
                    const participants = groupMetadata.participants;
                    const botAdmin = participants.find(p => p.id === (sock.user.id.split(':')[0] + '@s.whatsapp.net'))?.admin;
                    const userAdmin = participants.find(p => p.id === sender)?.admin;

                    if (botAdmin && !userAdmin) {
                        await sock.sendMessage(from, { 
                            text: `⚠️ Link grup terdeteksi! @${sender.split('@')[0]}, kamu akan dikick.`, 
                            mentions: [sender] 
                        });
                        await sock.groupParticipantsUpdate(from, [sender], 'remove');
                        return;
                    }
                }

                // --- CEK AKSES COMMAND ---
                const freeCommands = ['.sewa', '.ping', '.help', '.menu', '.profile', '.profil'];
                const needsRental = !freeCommands.some(freeCmd =>
                    textLower === freeCmd || textLower.startsWith(freeCmd + ' ')
                );

                if (needsRental) {
                    if (!hasAccessForCommand(textLower.split(' ')[0], isGroup, sender, groupId, sock)) {
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
                        return;
                    }
                }

                // ============================================
                // COMMAND HANDLER - MENAMBAHKAN SEMUA FITUR BARU
                // ============================================

                // ---- MENU COMMAND (UPDATE DENGAN SEMUA FITUR) ----
                if (textLower === '.menu' || textLower === '.help') {
                    const menuText = `
*🔥 SAM BOT v3 - PREMIUM 🔥*

*🤖 DOWNLOADER*
• .ytmp3 [url] - Download YouTube MP3
• .ytmp4 [url] - Download YouTube MP4
• .tt [url] - Download TikTok
• .ig [url] - Download Instagram
• .fb [url] - Download Facebook
• .tw [url] - Download Twitter
• .pin [query] - Pinterest image

*🎨 STICKER MAKER*
• .sticker - Buat sticker dari gambar
• .stickerwm [teks] - Sticker dengan watermark
• .stickertext [teks] - Sticker dengan teks
• .stickeranim - Sticker animasi dari GIF

*🤖 AI & TOOLS*
• .ai [pertanyaan] - Chat dengan AI
• .dalle [prompt] - Generate gambar AI
• .remini - Enhance kualitas foto
• .removebg - Hapus background foto
• .qrgen [teks] - Generate QR Code
• .qrread - Baca QR Code dari gambar

*🎮 FUN & GAMES*
• .truth - Truth challenge
• .dare - Dare challenge
• .tebakgambar - Game tebak gambar
• .slot - Slot machine game
• .math - Math quiz game

*📊 GROUP TOOLS*
• .hidetag [pesan] - Tag semua tanpa notif
• .tagall - Tag semua member
• .kick @user - Kick member
• .ban @user - Ban member
• .promote @user - Promote member
• .demote @user - Demote member
• .close/open - Tutup/buka grup
• .setname [nama] - Ubah nama grup
• .setdesc [deskripsi] - Ubah deskripsi
• .ownergc - Cek owner grup
• .leave - Bot keluar grup

*🌐 UTILITIES*
• .weather [kota] - Info cuaca
• .sholat [kota] - Jadwal sholat
• .shortlink [url] - Pendekin link
• .ssweb [url] - Screenshot website
• .translate [teks] - Terjemahkan teks
• .currency [jumlah] [dari] [ke] - Konversi mata uang

*🎭 MAKER & EDITOR*
• .logo [teks] - Buat logo keren
• .textpro [teks] [style] - Text effect
• .phlogo [teks] - Photooxy logo
• .ttp [teks] - Text to picture

*🌸 ANIME & WAIFU*
• .waifu - Dapatkan waifu random
• .neko - Dapatkan neko girl
• .anime [judul] - Cari anime
• .manga [judul] - Cari manga

*👑 OWNER ONLY*
• .grant [scope] [id] [hari] - Beri sewa
• .revoke [id] - Cabut sewa
• .broadcast [pesan] - Broadcast
• .addprem [id] - Tambah premium
• .delprem [id] - Hapus premium
• .update - Update bot

*ℹ️ INFO*
• .sewa - Info penyewaan
• .ceksewa - Cek status sewa
• .profile - Lihat profile
• .ping - Cek latency bot

*📞 CONTACT*
Owner: wa.me/6289528950624
Support: https://t.me/sukabyone

_Bot aktif 24/7 • Made with ❤️ by Sukabyone_
                    `.trim();

                    await sock.sendMessage(from, {
                        text: menuText,
                        contextInfo: {
                            externalAdReply: {
                                title: "SamAl | Premium Bot",
                                body: "Active 24/7 • All Features",
                                thumbnail: fs.existsSync(path.join(FOLDER, 'promo_sewa.jpg')) ? 
                                    fs.readFileSync(path.join(FOLDER, 'promo_sewa.jpg')) : null,
                                sourceUrl: "https://wa.me/6289528950624",
                                mediaType: 1,
                                renderLargerThumbnail: true
                            }
                        }
                    }, { quoted: msg });
                    return;
                }

                // ---- PING COMMAND ----
                if (textLower === '.ping') {
                    const start = Date.now();
                    await sock.sendMessage(from, { text: '🏓 Pong!' });
                    const latency = Date.now() - start;
                    await sock.sendMessage(from, { 
                        text: `⚡ Latency: ${latency}ms\n🕐 Uptime: ${process.uptime().toFixed(2)}s` 
                    });
                    return;
                }

                // ---- YOUTUBE DOWNLOADER ----
                if (textLower.startsWith('.ytmp3 ')) {
                    const url = text.split(' ')[1];
                    if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
                        return sock.sendMessage(from, { 
                            text: '❌ Link YouTube tidak valid!' 
                        }, { quoted: msg });
                    }
                    await youtubeMp3(url, sock, from, msg);
                    return;
                }

                if (textLower.startsWith('.ytmp4 ')) {
                    const url = text.split(' ')[1];
                    if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
                        return sock.sendMessage(from, { 
                            text: '❌ Link YouTube tidak valid!' 
                        }, { quoted: msg });
                    }
                    await youtubeMp4(url, sock, from, msg);
                    return;
                }

                // ---- TIKTOK DOWNLOADER ----
                if (textLower.startsWith('.tt ') || textLower === '.tt' || textLower === '.tiktok') {
                    if (textLower === '.tt' || textLower === '.tiktok') {
                        return sock.sendMessage(from, {
                            text: '❌ Format: .tt [url]\nContoh: .tt https://vt.tiktok.com/abc'
                        }, { quoted: msg });
                    }

                    const url = text.split(' ').slice(1).join(' ');
                    if (!url.includes('tiktok')) {
                        return sock.sendMessage(from, {
                            text: '❌ Link TikTok tidak valid!'
                        }, { quoted: msg });
                    }

                    await sock.sendMessage(from, { text: '⏳ Mengunduh dari TikTok...' }, { quoted: msg });

                    try {
                        const res = await axios.get(`https://tikwm.com/api/?url=${encodeURIComponent(url)}`);
                        if (res.data.code !== 0) throw new Error(res.data.msg);

                        const videoUrl = res.data.data.play;
                        const title = res.data.data.title || 'TikTok Video';
                        const author = res.data.data.author?.unique_id || 'unknown';

                        await sock.sendMessage(from, {
                            video: { url: videoUrl },
                            caption: `✅ TikTok Video Downloaded!\n\n📌 Title: ${title}\n👤 Author: @${author}\n\n_Downloaded by SAM BOT_`
                        }, { quoted: msg });
                    } catch (err) {
                        console.error('TikTok Error:', err);
                        await sock.sendMessage(from, {
                            text: `❌ Gagal mengunduh TikTok: ${err.message}`
                        }, { quoted: msg });
                    }
                    return;
                }

                // ---- INSTAGRAM DOWNLOADER ----
                if (textLower.startsWith('.ig ') || textLower.startsWith('.instagram ')) {
                    const url = text.split(' ').slice(1).join(' ');
                    if (!url.includes('instagram.com')) {
                        return sock.sendMessage(from, { 
                            text: '❌ Link Instagram tidak valid!' 
                        }, { quoted: msg });
                    }
                    await downloadInstagram(url, sock, from, msg);
                    return;
                }

                // ---- FACEBOOK DOWNLOADER ----
                if (textLower.startsWith('.fb ') || textLower.startsWith('.facebook ')) {
                    const url = text.split(' ').slice(1).join(' ');
                    if (!url.includes('facebook.com')) {
                        return sock.sendMessage(from, { 
                            text: '❌ Link Facebook tidak valid!' 
                        }, { quoted: msg });
                    }
                    await downloadFacebook(url, sock, from, msg);
                    return;
                }

                // ---- TWITTER DOWNLOADER ----
                if (textLower.startsWith('.tw ') || textLower.startsWith('.twitter ')) {
                    const url = text.split(' ').slice(1).join(' ');
                    if (!url.includes('twitter.com') && !url.includes('x.com')) {
                        return sock.sendMessage(from, { 
                            text: '❌ Link Twitter tidak valid!' 
                        }, { quoted: msg });
                    }
                    await downloadTwitter(url, sock, from, msg);
                    return;
                }

                // ---- PINTEREST ----
                if (textLower.startsWith('.pin ')) {
                    const query = text.slice(5);
                    try {
                        const res = await axios.get(`https://api.pinterest.com/v3/search/pins/?q=${encodeURIComponent(query)}`);
                        const images = res.data.data || [];
                        
                        if (images.length > 0) {
                            await sock.sendMessage(from, {
                                image: { url: images[0].images.orig.url },
                                caption: `📌 Pinterest: ${query}`
                            }, { quoted: msg });
                        } else {
                            await sock.sendMessage(from, { 
                                text: '❌ Tidak ditemukan gambar untuk pencarian tersebut.' 
                            }, { quoted: msg });
                        }
                    } catch (error) {
                        await sock.sendMessage(from, { 
                            text: '❌ Gagal mencari gambar Pinterest.' 
                        }, { quoted: msg });
                    }
                    return;
                }

                // ---- AI CHAT ----
                if (textLower.startsWith('.ai ')) {
                    const query = text.slice(4);
                    if (!query) {
                        return sock.sendMessage(from, { 
                            text: '❌ Format: .ai [pertanyaan]\nContoh: .ai Apa itu artificial intelligence?' 
                        }, { quoted: msg });
                    }
                    await chatGPT(query, sock, from, msg);
                    return;
                }

                // ---- DALL-E IMAGE GENERATION ----
                if (textLower.startsWith('.dalle ')) {
                    const prompt = text.slice(7);
                    if (!prompt) {
                        return sock.sendMessage(from, { 
                            text: '❌ Format: .dalle [prompt]\nContoh: .dalle kucing astronaut di bulan' 
                        }, { quoted: msg });
                    }
                    await dalleGenerate(prompt, sock, from, msg);
                    return;
                }

                // ---- REMINI ENHANCE ----
                if (textLower === '.remini') {
                    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                    const imageMsg = msg.message?.imageMessage || quotedMsg?.imageMessage;
                    
                    if (!imageMsg) {
                        return sock.sendMessage(from, { 
                            text: '❌ Kirim atau reply foto dengan caption .remini' 
                        }, { quoted: msg });
                    }
                    
                    try {
                        const stream = await downloadContentFromMessage(imageMsg, 'image');
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) {
                            buffer = Buffer.concat([buffer, chunk]);
                        }
                        
                        await reminiEnhance(buffer, sock, from, msg);
                    } catch (error) {
                        await sock.sendMessage(from, { 
                            text: '❌ Gagal meningkatkan kualitas foto.' 
                        }, { quoted: msg });
                    }
                    return;
                }

                // ---- STICKER MAKER ----
                const stickerTriggers = ['.s', '.stiker', '.sticker'];
                const isStickerCmd = stickerTriggers.some(trigger =>
                    textLower === trigger || textLower.startsWith(trigger + ' ')
                );

                if (isStickerCmd) {
                    let imgMsg = msg.message?.imageMessage || 
                                msg.message?.videoMessage ||
                                msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage ||
                                msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage;

                    if (!imgMsg) {
                        return sock.sendMessage(from, {
                            text: '❌ Kirim atau reply gambar/video dengan caption .sticker'
                        }, { quoted: msg });
                    }

                    try {
                        const stream = await downloadContentFromMessage(imgMsg, 'image');
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) {
                            buffer = Buffer.concat([buffer, chunk]);
                        }

                        await createSticker(buffer, 'SAM BOT', 'Sukabyone', sock, from, msg);
                    } catch (error) {
                        await sock.sendMessage(from, {
                            text: '❌ Gagal membuat sticker.'
                        }, { quoted: msg });
                    }
                    return;
                }

                // ---- TRUTH OR DARE ----
                if (textLower === '.truth') {
                    const truth = truthOrDare('truth');
                    await sock.sendMessage(from, {
                        text: `🤔 *TRUTH*\n\n${truth}\n\nJawab dengan jujur ya!`
                    }, { quoted: msg });
                    return;
                }

                if (textLower === '.dare') {
                    const dare = truthOrDare('dare');
                    await sock.sendMessage(from, {
                        text: `😈 *DARE*\n\n${dare}\n\nLakukan dalam 60 detik!`
                    }, { quoted: msg });
                    return;
                }

                // ---- TEBAK GAMBAR ----
                if (textLower === '.tebakgambar') {
                    await tebakGambar(sock, from, msg);
                    return;
                }

                // ---- QR CODE GENERATOR ----
                if (textLower.startsWith('.qrgen ') || textLower.startsWith('.qrcode ')) {
                    const data = text.split(' ').slice(1).join(' ');
                    if (!data) {
                        return sock.sendMessage(from, { 
                            text: '❌ Format: .qrgen [teks/url]\nContoh: .qrgen https://google.com' 
                        }, { quoted: msg });
                    }
                    await generateQR(data, sock, from, msg);
                    return;
                }

                // ---- QR CODE READER ----
                if (textLower === '.qrread') {
                    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                    const imageMsg = msg.message?.imageMessage || quotedMsg?.imageMessage;
                    
                    if (!imageMsg) {
                        return sock.sendMessage(from, { 
                            text: '❌ Kirim atau reply gambar QR Code dengan caption .qrread' 
                        }, { quoted: msg });
                    }
                    
                    try {
                        const stream = await downloadContentFromMessage(imageMsg, 'image');
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) {
                            buffer = Buffer.concat([buffer, chunk]);
                        }
                        
                        await readQR(buffer, sock, from, msg);
                    } catch (error) {
                        await sock.sendMessage(from, { 
                            text: '❌ Gagal membaca QR Code.' 
                        }, { quoted: msg });
                    }
                    return;
                }

                // ---- WEATHER ----
                if (textLower.startsWith('.weather ') || textLower.startsWith('.cuaca ')) {
                    const city = text.split(' ').slice(1).join(' ');
                    if (!city) {
                        return sock.sendMessage(from, { 
                            text: '❌ Format: .weather [kota]\nContoh: .weather Jakarta' 
                        }, { quoted: msg });
                    }
                    await getWeather(city, sock, from, msg);
                    return;
                }

                // ---- SHOLAT TIME ----
                if (textLower.startsWith('.sholat ') || textLower.startsWith('.jadwalsholat ')) {
                    const city = text.split(' ').slice(1).join(' ');
                    if (!city) {
                        return sock.sendMessage(from, { 
                            text: '❌ Format: .sholat [kota]\nContoh: .sholat Jakarta' 
                        }, { quoted: msg });
                    }
                    await getPrayerTime(city, sock, from, msg);
                    return;
                }

                // ---- WAIFU ----
                if (textLower === '.waifu') {
                    await getWaifu(sock, from, msg);
                    return;
                }

                // ---- ANIME SEARCH ----
                if (textLower.startsWith('.anime ')) {
                    const query = text.slice(7);
                    if (!query) {
                        return sock.sendMessage(from, { 
                            text: '❌ Format: .anime [judul]\nContoh: .anime Naruto' 
                        }, { quoted: msg });
                    }
                    await searchAnime(query, sock, from, msg);
                    return;
                }

                // ---- SEWA COMMAND ----
                if (textLower === '.sewa') {
                    const promoText = `🌟 *SISTEM PENYEWAAN SAM BOT v3* 🌟 

✨ *PAKET PREMIUM:*
• Rp 10.000 / 30 hari
• Rp 25.000 / 90 hari  
• Rp 45.000 / 180 hari

✨ *FITUR PREMIUM:*
✅ All Downloader (YT, TikTok, IG, FB, Twitter)
✅ AI Chat & Image Generation
✅ Sticker Maker Premium
✅ Game & Fun Commands
✅ Group Management Tools
✅ Utilities & Tools
✅ Anime & Waifu Features
✅ 24/7 Online Support

📌 *CARA SEWA:*
1. Hubungi Owner di wa.me/6289528950624
2. Pilih paket yang diinginkan
3. Transfer pembayaran
4. Kirim bukti transfer
5. Bot akan diaktivasi dalam 1-5 menit

📞 *KONTAK OWNER:*
• wa.me/6289528950624 (Sam @Sukabyone)
• Telegram: @sukabyone

🕒 *MASA AKTIF:*
Bot aktif 24/7 dengan uptime 99.9%
Support maintenance rutin

💎 *BONUS:*
• Free trial 1 hari untuk testing
• Support setup grup
• Tutorial penggunaan bot

_Jangan ragu untuk bertanya! 😊_`;

                    await sock.sendMessage(from, { text: promoText });
                    return;
                }

                // ---- CEK SEWA COMMAND ----
                if (textLower.startsWith('.ceksewa')) {
                    try {
                        let targetId = null;
                        
                        if (isGroup) {
                            targetId = from;
                        } else {
                            targetId = sender.split('@')[0];
                        }
                        
                        const rental = getRental(targetId);
                        if (!rental) {
                            return sock.sendMessage(from, {
                                text: '❌ Tidak ada sewa aktif untuk akun/grup ini.\nKetik .sewa untuk info penyewaan.'
                            });
                        }
                        
                        const remainingMs = rental.expires - Date.now();
                        const remainingDays = Math.ceil(remainingMs / (1000 * 60 * 60 * 24));
                        
                        const textOut = `📋 *INFO SEWA AKTIF*\n\n` +
                            `👤 Pemilik: ${rental.scope === 'group' ? 'Grup' : 'User'}\n` +
                            `🔑 ID: ${targetId}\n` +
                            `⭐ Tier: ${rental.tier}\n` +
                            `⏳ Sisa Waktu: ${remainingDays} hari\n` +
                            `📅 Kadaluarsa: ${formatDate(rental.expires)}\n` +
                            `👮 Diberikan oleh: ${rental.grantedBy || 'System'}\n\n` +
                            `_Gunakan fitur premium sepuasnya!_`;
                        
                        return sock.sendMessage(from, { text: textOut });
                    } catch (e) {
                        console.log('Ceksewa error:', e);
                        return sock.sendMessage(from, {
                            text: '❌ Error saat mengecek sewa.'
                        });
                    }
                }

                // ---- GRANT/REVOKE (OWNER ONLY) ----
                if (textLower.startsWith('.grant ') || textLower.startsWith('.revoke ')) {
                    if (!isOperator(sender, sock)) {
                        return sock.sendMessage(from, { 
                            text: '🚫 Hanya operator yang boleh menggunakan perintah ini!' 
                        });
                    }
                    
                    const args = text.split(' ');
                    const cmd = args[0];
                    
                    try {
                        if (cmd === '.grant') {
                            if (args.length < 4) {
                                return sock.sendMessage(from, {
                                    text: '❌ Format: .grant [private/group] [id] [hari]\nContoh: .grant private 628123456789 30'
                                });
                            }
                            
                            const scope = args[1];
                            const target = args[2];
                            const days = parseInt(args[3]);
                            
                            if (!['private', 'group'].includes(scope)) {
                                return sock.sendMessage(from, {
                                    text: '❌ Scope harus private atau group!'
                                });
                            }
                            
                            if (isNaN(days) || days <= 0) {
                                return sock.sendMessage(from, {
                                    text: '❌ Jumlah hari harus angka positif!'
                                });
                            }
                            
                            let id = target;
                            if (scope === 'private') {
                                id = id.replace(/[^0-9]/g, '');
                                if (id.startsWith('0')) id = '62' + id.slice(1);
                            }
                            
                            grantRental(scope, id, 'premium', days, sender);
                            await sock.sendMessage(from, {
                                text: `✅ Berhasil memberikan sewa ${scope} untuk ${id} selama ${days} hari!`
                            });
                        }
                        
                        if (cmd === '.revoke') {
                            if (args.length < 2) {
                                return sock.sendMessage(from, {
                                    text: '❌ Format: .revoke [id]\nContoh: .revoke 628123456789'
                                });
                            }
                            
                            const target = args[1];
                            revokeRental(target);
                            await sock.sendMessage(from, {
                                text: `✅ Berhasil mencabut sewa untuk ${target}!`
                            });
                        }
                    } catch (e) {
                        await sock.sendMessage(from, {
                            text: `❌ Error: ${e.message}`
                        });
                    }
                    return;
                }

                // ---- ADD/DEL PREMIUM (OWNER ONLY) ----
                if (textLower.startsWith('.addprem ') || textLower.startsWith('.delprem ')) {
                    if (!isOperator(sender, sock)) {
                        return sock.sendMessage(from, { 
                            text: '🚫 Hanya operator yang boleh menggunakan perintah ini!' 
                        });
                    }
                    
                    const args = text.split(' ');
                    const cmd = args[0];
                    const userId = args[1]?.replace(/[^0-9]/g, '');
                    
                    if (!userId) {
                        return sock.sendMessage(from, {
                            text: '❌ Format: .addprem [userId] atau .delprem [userId]'
                        });
                    }
                    
                    try {
                        if (cmd === '.addprem') {
                            addPremium(userId);
                            await sock.sendMessage(from, {
                                text: `✅ Berhasil menambahkan ${userId} ke user premium!`
                            });
                        } else if (cmd === '.delprem') {
                            removePremium(userId);
                            await sock.sendMessage(from, {
                                text: `✅ Berhasil menghapus ${userId} dari user premium!`
                            });
                        }
                    } catch (e) {
                        await sock.sendMessage(from, {
                            text: `❌ Error: ${e.message}`
                        });
                    }
                    return;
                }

                // ---- BROADCAST (OWNER ONLY) ----
                if (textLower.startsWith('.broadcast ') || textLower.startsWith('.bc ')) {
                    if (!isOperator(sender, sock)) {
                        return sock.sendMessage(from, { 
                            text: '🚫 Hanya operator yang boleh menggunakan perintah ini!' 
                        });
                    }
                    
                    const message = text.split(' ').slice(1).join(' ');
                    if (!message) {
                        return sock.sendMessage(from, {
                            text: '❌ Format: .broadcast [pesan]'
                        });
                    }
                    
                    try {
                        const users = loadUsers();
                        const userList = Object.keys(users);
                        
                        await sock.sendMessage(from, {
                            text: `📢 Memulai broadcast ke ${userList.length} user...`
                        });
                        
                        let success = 0;
                        let failed = 0;
                        
                        for (const userId of userList) {
                            try {
                                const jid = `${userId}@s.whatsapp.net`;
                                await sock.sendMessage(jid, { 
                                    text: `📢 *BROADCAST*\n\n${message}\n\n_Pesan otomatis dari admin_`
                                });
                                success++;
                                await new Promise(resolve => setTimeout(resolve, 1000)); // Delay 1 detik
                            } catch (e) {
                                failed++;
                            }
                        }
                        
                        await sock.sendMessage(from, {
                            text: `📊 *BROADCAST SELESAI*\n\n✅ Sukses: ${success}\n❌ Gagal: ${failed}\n📞 Total: ${userList.length} user`
                        });
                    } catch (e) {
                        await sock.sendMessage(from, {
                            text: `❌ Error broadcast: ${e.message}`
                        });
                    }
                    return;
                }

                // ---- GROUP COMMANDS ----
                if (isGroup) {
                    const groupMetadata = await sock.groupMetadata(from);
                    const participants = groupMetadata.participants;
                    const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                    const botAdmin = participants.find(p => p.id === botNumber)?.admin;
                    const userAdmin = participants.find(p => p.id === sender)?.admin;
                    const isBotAdmin = botAdmin === 'admin' || botAdmin === 'superadmin';
                    const isUserAdmin = userAdmin === 'admin' || userAdmin === 'superadmin';

                    // HIDETAG
                    if (textLower.startsWith('.hidetag ') || textLower === '.hidetag' || textLower === '.h') {
                        if (!isUserAdmin && !isOperator(sender, sock)) {
                            return sock.sendMessage(from, { text: '❌ Hanya admin/operator yang boleh menggunakan perintah ini!' });
                        }
                        
                        const message = text.includes(' ') ? text.split(' ').slice(1).join(' ') : 'Hai semua!';
                        await sock.sendMessage(from, { 
                            text: `${message}\n\n_Tagged by hidden tag_`, 
                            mentions: participants.map(p => p.id) 
                        });
                        return;
                    }

                    // TAGALL
                    if (textLower === '.tagall') {
                        if (!isUserAdmin && !isOperator(sender, sock)) {
                            return sock.sendMessage(from, { text: '❌ Hanya admin/operator yang boleh menggunakan perintah ini!' });
                        }
                        
                        let tagText = '📢 *TAG ALL MEMBERS*\n\n';
                        participants.forEach((p, i) => {
                            tagText += `${i + 1}. @${p.id.split('@')[0]}\n`;
                        });
                        tagText += '\n_Tagged by admin_';
                        
                        await sock.sendMessage(from, { 
                            text: tagText, 
                            mentions: participants.map(p => p.id) 
                        });
                        return;
                    }

                    // KICK
                    if (textLower.startsWith('.kick')) {
                        if (!isUserAdmin || !isBotAdmin) {
                            return sock.sendMessage(from, { 
                                text: '❌ Bot dan user harus admin untuk menggunakan perintah ini!' 
                            });
                        }
                        
                        let targets = [];
                        const ext = msg.message?.extendedTextMessage;
                        
                        if (ext?.contextInfo?.mentionedJid) {
                            targets = ext.contextInfo.mentionedJid;
                        } else if (ext?.contextInfo?.participant) {
                            targets = [ext.contextInfo.participant];
                        }
                        
                        if (targets.length === 0) {
                            return sock.sendMessage(from, {
                                text: '❌ Tag atau reply member yang ingin dikick!'
                            });
                        }
                        
                        try {
                            await sock.groupParticipantsUpdate(from, targets, 'remove');
                            await sock.sendMessage(from, {
                                text: `✅ Berhasil mengkick ${targets.length} member!`,
                                mentions: targets
                            });
                        } catch (e) {
                            await sock.sendMessage(from, {
                                text: `❌ Gagal mengkick: ${e.message}`
                            });
                        }
                        return;
                    }

                    // BAN
                    if (textLower.startsWith('.ban ')) {
                        if (!isUserAdmin || !isBotAdmin) {
                            return sock.sendMessage(from, { 
                                text: '❌ Bot dan user harus admin untuk menggunakan perintah ini!' 
                            });
                        }
                        
                        let target = null;
                        if (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length) {
                            target = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
                        } else if (text.split(' ')[1]) {
                            target = text.split(' ')[1].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                        }
                        
                        if (!target) {
                            return sock.sendMessage(from, {
                                text: '❌ Format: .ban @user atau .ban 628xxx'
                            });
                        }
                        
                        try {
                            // Kick dulu
                            await sock.groupParticipantsUpdate(from, [target], 'remove');
                            
                            // Tambah ke banned list
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
                            await sock.sendMessage(from, {
                                text: `❌ Gagal ban: ${e.message}`
                            });
                        }
                        return;
                    }

                    // PROMOTE/DEMOTE
                    if (textLower.startsWith('.promote') || textLower.startsWith('.demote')) {
                        if (!isUserAdmin || !isBotAdmin) {
                            return sock.sendMessage(from, { 
                                text: '❌ Bot dan user harus admin untuk menggunakan perintah ini!' 
                            });
                        }
                        
                        let targets = [];
                        const ext = msg.message?.extendedTextMessage;
                        
                        if (ext?.contextInfo?.mentionedJid) {
                            targets = ext.contextInfo.mentionedJid;
                        }
                        
                        if (targets.length === 0) {
                            return sock.sendMessage(from, {
                                text: '❌ Tag member yang ingin dipromote/demote!'
                            });
                        }
                        
                        const action = textLower.startsWith('.promote') ? 'promote' : 'demote';
                        
                        try {
                            await sock.groupParticipantsUpdate(from, targets, action);
                            await sock.sendMessage(from, {
                                text: `✅ Berhasil ${action} ${targets.length} member!`,
                                mentions: targets
                            });
                        } catch (e) {
                            await sock.sendMessage(from, {
                                text: `❌ Gagal ${action}: ${e.message}`
                            });
                        }
                        return;
                    }

                    // CLOSE/OPEN GROUP
                    if (textLower === '.close' || textLower === '.open') {
                        if (!isUserAdmin || !isBotAdmin) {
                            return sock.sendMessage(from, { 
                                text: '❌ Bot dan user harus admin untuk menggunakan perintah ini!' 
                            });
                        }
                        
                        const isClose = textLower === '.close';
                        
                        try {
                            await setGroupAnnouncement(sock, from, isClose);
                            await sock.sendMessage(from, {
                                text: `✅ Grup berhasil di${isClose ? 'tutup' : 'buka'}!`
                            });
                        } catch (e) {
                            await sock.sendMessage(from, {
                                text: `❌ Gagal: ${e.message}`
                            });
                        }
                        return;
                    }

                    // SET GROUP NAME
                    if (textLower.startsWith('.setname ')) {
                        if (!isUserAdmin || !isBotAdmin) {
                            return sock.sendMessage(from, { 
                                text: '❌ Bot dan user harus admin untuk menggunakan perintah ini!' 
                            });
                        }
                        
                        const newName = text.slice(9);
                        if (!newName || newName.length > 25) {
                            return sock.sendMessage(from, {
                                text: '❌ Nama grup maksimal 25 karakter!'
                            });
                        }
                        
                        try {
                            await sock.groupUpdateSubject(from, newName);
                            await sock.sendMessage(from, {
                                text: `✅ Nama grup berhasil diubah menjadi: ${newName}`
                            });
                        } catch (e) {
                            await sock.sendMessage(from, {
                                text: `❌ Gagal mengubah nama grup: ${e.message}`
                            });
                        }
                        return;
                    }

                    // SET GROUP DESC
                    if (textLower.startsWith('.setdesc ')) {
                        if (!isUserAdmin || !isBotAdmin) {
                            return sock.sendMessage(from, { 
                                text: '❌ Bot dan user harus admin untuk menggunakan perintah ini!' 
                            });
                        }
                        
                        const newDesc = text.slice(9);
                        if (!newDesc || newDesc.length > 512) {
                            return sock.sendMessage(from, {
                                text: '❌ Deskripsi grup maksimal 512 karakter!'
                            });
                        }
                        
                        try {
                            await sock.groupUpdateDescription(from, newDesc);
                            await sock.sendMessage(from, {
                                text: `✅ Deskripsi grup berhasil diubah!`
                            });
                        } catch (e) {
                            await sock.sendMessage(from, {
                                text: `❌ Gagal mengubah deskripsi: ${e.message}`
                            });
                        }
                        return;
                    }

                    // OWNER GC
                    if (textLower === '.ownergc') {
                        const owner = groupMetadata.owner || groupMetadata.participants.find(p => p.admin === 'superadmin')?.id;
                        if (owner) {
                            await sock.sendMessage(from, {
                                text: `👑 Owner grup ini: @${owner.split('@')[0]}`,
                                mentions: [owner]
                            });
                        } else {
                            await sock.sendMessage(from, { text: '❌ Tidak dapat menemukan owner grup.' });
                        }
                        return;
                    }

                    // LEAVE GROUP
                    if (textLower === '.leave') {
                        if (!isOperator(sender, sock)) {
                            return sock.sendMessage(from, { 
                                text: '❌ Hanya operator yang boleh menggunakan perintah ini!' 
                            });
                        }
                        
                        await sock.sendMessage(from, {
                            text: '👋 Dadah semua! Bot izin keluar dulu ya~'
                        });
                        await sock.groupLeave(from);
                        return;
                    }
                }

                // ---- PROFILE COMMAND ----
                if (textLower === '.profile' || textLower === '.profil') {
                    const ext = msg.message?.extendedTextMessage;
                    let targetJid = sender;
                    
                    if (ext?.contextInfo?.mentionedJid && ext.contextInfo.mentionedJid.length) {
                        targetJid = ext.contextInfo.mentionedJid[0];
                    }
                    
                    try {
                        const users = loadUsers();
                        const id = targetJid.split('@')[0];
                        const user = users[id] || {
                            name: 'Unknown',
                            count: 0,
                            firstSeen: Date.now()
                        };
                        
                        const rental = getRental(id);
                        const isPrem = isPremium(id);
                        
                        let profileText = `👤 *PROFILE USER*\n\n`;
                        profileText += `📛 Nama: ${user.name || 'Unknown'}\n`;
                        profileText += `📞 Nomor: ${id}\n`;
                        profileText += `📊 Total Chat: ${user.count || 0}\n`;
                        profileText += `📅 Bergabung: ${formatDate(user.firstSeen)}\n`;
                        profileText += `⭐ Status: ${isPrem ? 'Premium ✅' : (rental ? 'Sewa Aktif ✅' : 'Free User')}\n`;
                        
                        if (rental) {
                            const remainingMs = rental.expires - Date.now();
                            profileText += `⏳ Sisa Sewa: ${formatDuration(remainingMs)}\n`;
                        }
                        
                        await sock.sendMessage(from, { 
                            text: profileText,
                            mentions: targetJid ? [targetJid] : []
                        });
                    } catch (e) {
                        await sock.sendMessage(from, { 
                            text: '❌ Gagal mendapatkan profile.' 
                        });
                    }
                    return;
                }

                // ---- UPDATE COMMAND ----
                if (textLower === '.update') {
                    if (!isOperator(sender, sock)) {
                        return sock.sendMessage(from, { 
                            text: '🚫 Hanya operator yang boleh menggunakan perintah ini!' 
                        });
                    }
                    
                    await sock.sendMessage(from, {
                        text: '🔄 Memulai update bot...\nMohon tunggu beberapa saat.'
                    });
                    
                    exec('git pull && npm install', async (error, stdout, stderr) => {
                        if (error) {
                            console.error(`Update error: ${error}`);
                            return sock.sendMessage(from, {
                                text: `❌ Update gagal:\n${error.message}`
                            });
                        }
                        
                        let output = `✅ Update berhasil!\n\n`;
                        if (stdout) output += `Output:\n${stdout}\n`;
                        if (stderr) output += `Error:\n${stderr}\n`;
                        
                        await sock.sendMessage(from, { text: output });
                        
                        // Restart bot setelah 3 detik
                        setTimeout(() => {
                            process.exit(0);
                        }, 3000);
                    });
                    return;
                }

            } catch (e) {
                console.error('Message handler error:', e);
                try {
                    await sock.sendMessage(from, { 
                        text: '❌ Terjadi error pada sistem. Silakan coba lagi nanti.' 
                    });
                } catch (sendError) {
                    console.error('Failed to send error message:', sendError);
                }
            }
        });

    } catch (error) {
        console.error('Failed to connect:', error);
        setTimeout(connectToWhatsApp, 5000);
    }
}

// ============================================================
// 15. START BOT
// ============================================================

connectToWhatsApp();

// Handle process exit
process.on('SIGINT', () => {
    console.log('\nBot shutting down...');
    process.exit(0);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});