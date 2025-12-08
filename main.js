const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        version: [2, 3000, 1027934701] // versi stabil biar gak error aneh
    });

    // Helper: set group announcement mode with fallbacks for different Baileys versions
    const setGroupAnnouncement = async (jid, announce) => {
        const mode = announce ? 'announcement' : 'not_announcement';
        if (typeof sock.groupSettingChange === 'function') {
            return sock.groupSettingChange(jid, mode);
        }
        if (typeof sock.groupSettingUpdate === 'function') {
            return sock.groupSettingUpdate(jid, mode);
        }
        if (typeof sock.groupUpdate === 'function') {
            // best-effort fallback; some implementations accept an object
            try {
                return sock.groupUpdate(jid, { announce });
            } catch (e) {
                // fallthrough to error below
            }
        }
        throw new Error('group setting change not supported by this Baileys version');
    };

    // Users DB path
    const USERS_DB = path.join(__dirname, 'data', 'users.json');
    // Ensure data directory exists
    try {
        const dir = path.dirname(USERS_DB);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
        console.log('Could not ensure data directory:', e.message);
    }

    const loadUsers = () => {
        try {
            if (!fs.existsSync(USERS_DB)) return {};
            const raw = fs.readFileSync(USERS_DB, 'utf8');
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            console.log('Users DB load error:', e.message);
            return {};
        }
    };

    // Rentals DB (sewa) path
    const RENTALS_DB = path.join(__dirname, 'data', 'rentals.json');

    const loadRentals = () => {
        try {
            if (!fs.existsSync(RENTALS_DB)) return {};
            const raw = fs.readFileSync(RENTALS_DB, 'utf8');
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            console.log('Rentals DB load error:', e.message);
            return {};
        }
    };

    const saveRentals = (r) => {
        try {
            fs.writeFileSync(RENTALS_DB, JSON.stringify(r, null, 2), 'utf8');
        } catch (e) {
            console.log('Rentals DB save error:', e.message);
        }
    };

    const OPERATOR_ID = '233255529889864';

    // Check operator robustly: accept numeric id or full JID appearance
    const isOperator = (fullJid) => {
        if (!fullJid) return false;
        try {
            const numeric = fullJid.split('@')[0];
            if (numeric === OPERATOR_ID) return true;
            if (fullJid.includes(OPERATOR_ID)) return true;
            // also accept variants with @s.whatsapp.net
            if (fullJid.endsWith(`${OPERATOR_ID}@s.whatsapp.net`) || fullJid.endsWith(`${OPERATOR_ID}@c.us`) || fullJid.endsWith(`${OPERATOR_ID}@g.us`)) return true;
        } catch (e) {
            return false;
        }
        return false;
    };

    const grantRental = (scope, id, tier, days, grantedBy) => {
        const rentals = loadRentals();
        const key = id;
        const expires = Date.now() + (Number(days) || 0) * 24 * 60 * 60 * 1000;
        rentals[key] = { scope, tier, expires, grantedBy, grantedAt: Date.now() };
        saveRentals(rentals);
        return rentals[key];
    };

    const revokeRental = (id) => {
        const rentals = loadRentals();
        if (rentals[id]) delete rentals[id];
        saveRentals(rentals);
    };

    const getRental = (id) => {
        const rentals = loadRentals();
        const r = rentals[id];
        if (!r) return null;
        if (r.expires && Date.now() > r.expires) {
            // expired
            revokeRental(id);
            return null;
        }
        return r;
    };

    const hasAccessForCommand = (command, isGroup, senderFullJid, groupId) => {
        // operator always allowed
        if (isOperator(senderFullJid)) return true;
        const cmd = command.toLowerCase();
        // always allow .sewa so non-rented users can see how to rent
        if (cmd === '.sewa') return true;
        // check rental: if group context, check group rental; otherwise check private rental for sender
        if (isGroup) {
            const rental = getRental(groupId);
            return !!rental;
        } else {
            const senderId = (senderFullJid || '').split('@')[0];
            const rental = getRental(senderId);
            return !!rental;
        }
    };

    const saveUsers = (users) => {
        try {
            fs.writeFileSync(USERS_DB, JSON.stringify(users, null, 2), 'utf8');
        } catch (e) {
            console.log('Users DB save error:', e.message);
        }
    };

    const updateUserRecord = async (msg) => {
        try {
            const userJid = msg.key.participant || msg.key.remoteJid;
            if (!userJid) return;
            const users = loadUsers();
            const id = userJid.split('@')[0];
            const now = Date.now();
            if (!users[id]) {
                users[id] = {
                    jid: userJid,
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
            console.log('updateUserRecord error:', e.message);
        }
    };

    const formatDate = (ts) => {
        try {
            const d = new Date(Number(ts));
            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const yyyy = d.getFullYear();
            return `${dd}-${mm}-${yyyy}`;
        } catch (e) {
            return 'Unknown';
        }
    };

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) qrcode.generate(qr, { small: true });
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('SAM BOT NYALA GACOR BANGET BROOO 🔥🔥🔥');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.key.fromMe && m.type === 'notify') {
                const from = msg.key.remoteJid;
                const text = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || '').trim();

                // Update user record (count, name, firstSeen)
                await updateUserRecord(msg);

                // MENU / HELP
                if (text.toLowerCase() === '.menu' || text.toLowerCase() === '.help') {
                    await sock.sendMessage(from, { text: `*𝐒𝐚𝐦𝐀𝐥 | รักและรักคุณจริงๆ* 🔥\n\n✦ .menu / .help → tampilkan menu ini\n✦ .tagall → tag semua member\n✦ .hidetag [pesan] → tag tersembunyi\n✦ .tt [link] → download TikTok\n✦ .stiker / reply .stiker → membuat stiker dari foto\n✦ .ping → cek bot aktif dan delay\n✦ .promote @user → jadikan admin (hanya admin yang bisa pakai)\n✦ .demote @user → cabut admin (hanya admin yang bisa pakai)\n✦ .opengroup → buka grup supaya semua bisa chat (hanya admin)\n✦ .closegroup → tutup grup supaya hanya admin yang bisa chat (hanya admin)\n\nberminat untuk sewa?\nowner: wa.me/6289528950624 - Sam @Sukabyone` });
                    return;
                }

                            // PING — cek apakah bot aktif dan tampilkan latency
                            if (text.toLowerCase() === '.ping') {
                                const msgTs = msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : Date.now();
                                const LatencyMs = Date.now() - msgTs;
                                const LatencySec = (latencyMs / 1000).toFixed(2);
                                await sock.sendMessage(from, { text: `haloo, bot aktif dengan "${LatencySec}"ms` });
                                return;
                            }

                    // PROFILE — tampilkan profil pengguna (nama, WA id, total penggunaan, bergabung sejak)
                if (text.toLowerCase() === '.profile' || text.toLowerCase() === '.profil') {
                        // target via mention or reply, default = sender
                        const ext = msg.message?.extendedTextMessage;
                        let targetJid = null;
                        if (ext?.contextInfo?.mentionedJid && ext.contextInfo.mentionedJid.length) {
                            targetJid = ext.contextInfo.mentionedJid[0];
                        } else if (ext?.contextInfo?.participant) {
                            targetJid = ext.contextInfo.participant;
                        } else {
                            targetJid = msg.key.participant || msg.key.remoteJid;
                        }

                        const users = loadUsers();
                        const id = (targetJid || msg.key.remoteJid).split('@')[0];
                        const record = users[id] || { jid: targetJid || msg.key.remoteJid, name: msg.pushName || 'Unknown', firstSeen: null, count: 0 };
                        const name = record.name || 'Unknown';
                        const waId = id;
                        const count = record.count || 0;
                        const firstSeen = record.firstSeen ? formatDate(record.firstSeen) : 'Unknown';

                        const profileText = `*-- [ PROFILE KAMU ] --*\n👤 Nama: ${name}\n📞 NO. HP: ${waId}\n📊 Total Penggunaan: ${count} chat\nTerus gunakan bot ini ya! 😉`;

                        const mentions = targetJid ? [targetJid] : [];
                        await sock.sendMessage(from, { text: profileText, mentions });
                        return;
                    }

                    // GROUP CONTROL — buka / tutup grup (hanya admin)
                if (text.toLowerCase() === '.closegroup' || text.toLowerCase() === '.opengroup') {
                        if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'Perintah ini hanya untuk grup.' });
                        const group = await sock.groupMetadata(from);
                        const sender = msg.key.participant || msg.key.remoteJid;
                        const isSenderAdmin = group.participants.some(p => p.id === sender && (p.admin === 'admin' || p.admin === 'superadmin' || p.isAdmin || p.isSuperAdmin));
                        if (!isSenderAdmin) return sock.sendMessage(from, { text: 'Hanya admin grup yang bisa menggunakan perintah ini.' });
                        // check rental: group must have active rental
                        const fullSender = msg.key.participant || msg.key.remoteJid;
                        if (!hasAccessForCommand(text.split(' ')[0], true, fullSender, from)) return sock.sendMessage(from, { text: 'Fitur ini membutuhkan paket sewa. Ketik .sewa untuk info.' });

                        try {
                            if (text.toLowerCase() === '.closegroup') {
                                // announcement => only admins can send messages
                                await setGroupAnnouncement(from, true);
                                await sock.sendMessage(from, { text: 'Sukses! Grup ditutup — hanya admin yang bisa mengirim pesan sekarang.' });
                            } else {
                                // not_announcement => all participants can send messages
                                await setGroupAnnouncement(from, false);
                                await sock.sendMessage(from, { text: 'Sukses! Grup dibuka — semua anggota bisa mengirim pesan sekarang.' });
                            }
                        } catch (err) {
                            console.log('Group control error:', err.message);
                            await sock.sendMessage(from, { text: `Gagal mengubah setelan grup: ${err.message}` });
                        }
                        return;
                    }

                    // PROMOTE / DEMOTE — jadikan atau cabut admin (via mention atau reply)
                if (text.toLowerCase().startsWith('.promote') || text.toLowerCase().startsWith('.demote')) {
                    if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'Perintah ini hanya untuk grup.' });
                    const group = await sock.groupMetadata(from);
                    const sender = msg.key.participant || msg.key.remoteJid;
                    const isSenderAdmin = group.participants.some(p => p.id === sender && (p.admin === 'admin' || p.admin === 'superadmin' || p.isAdmin || p.isSuperAdmin));
                    if (!isSenderAdmin) return sock.sendMessage(from, { text: 'Hanya admin grup yang bisa menggunakan perintah ini.' });
                    // check rental: group must have active rental
                    const fullSenderProm = msg.key.participant || msg.key.remoteJid;
                    if (!hasAccessForCommand(text.split(' ')[0], true, fullSenderProm, from)) return sock.sendMessage(from, { text: 'Fitur ini membutuhkan paket sewa. Ketik .sewa untuk info.' });

                        // Dapatkan target: mention atau reply
                        let targets = [];
                        const ext = msg.message?.extendedTextMessage;
                        if (ext?.contextInfo?.mentionedJid && ext.contextInfo.mentionedJid.length) {
                            targets = ext.contextInfo.mentionedJid;
                        } else if (ext?.contextInfo?.participant) {
                            targets = [ext.contextInfo.participant];
                        }

                        if (!targets.length) {
                            return sock.sendMessage(from, { text: 'Tandai (mention) atau reply ke pengguna yang ingin di-promote/demote.\nContoh: .promote @user' });
                        }

                        try {
                            const action = text.toLowerCase().startsWith('.promote') ? 'promote' : 'demote';
                            await sock.groupParticipantsUpdate(from, targets, action);
                            const mentionText = targets.map(jid => `@${jid.split('@')[0]}`).join(', ');
                            await sock.sendMessage(from, { text: `Sukses melakukan ${action} untuk ${mentionText}`, mentions: targets });
                        } catch (err) {
                            console.log('Promote/Demote error:', err.message);
                            await sock.sendMessage(from, { text: `Gagal mengubah status admin: ${err.message}` });
                        }
                        return;
                    }

                // TAGALL — BENERAN TAG SEMUA MEMBER (bukan cuma @everyone)
                if (text.toLowerCase() === '.tagall') {
                    if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'Di grup aja yaaa' });
                    const fullSender = msg.key.participant || msg.key.remoteJid;
                    if (!hasAccessForCommand('.tagall', true, fullSender, from)) return sock.sendMessage(from, { text: 'Fitur ini hanya tersedia untuk grup yang menyewa bot. Ketik .sewa untuk info.' });
                    const group = await sock.groupMetadata(from);
                    let teks = '┌──「 TAG ALL 」\n';
                    for (let mem of group.participants) {
                        teks += `├ @${mem.id.split('@')[0]}\n`;
                    }
                    teks += `└────`;
                    await sock.sendMessage(from, { text: teks, mentions: group.participants.map(a => a.id) });
                    return;
                }

                // HIDETAG — TAG SEMUA TAPI DISEMBUNYIKAN, GANTI PESAN
                if (text.toLowerCase().startsWith('.hidetag ')) {
                    if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'bisa dipake nyaa cuma di group' });
                    const fullSender = msg.key.participant || msg.key.remoteJid;
                    if (!hasAccessForCommand('.hidetag', true, fullSender, from)) return sock.sendMessage(from, { text: 'Fitur ini hanya tersedia untuk grup yang menyewa bot. Ketik .sewa untuk info.' });
                    const pesan = text.slice(10);
                    const group = await sock.groupMetadata(from);
                    await sock.sendMessage(from, { text: pesan ? pesan : '‎', mentions: group.participants.map(a => a.id) });
                    return;
                }

                // Fungsi SSSTik Downloader (Free, No Key)
const getSsStikUrl = async (url) => {
    try {
        // Step 1: GET homepage buat ambil token 'tt'
        const homeRes = await axios.get('https://ssstik.io/en');
        const ttToken = homeRes.data.match(/tt:\'([\w\d]+)\'/)[1];  // Extract token

        // Step 2: POST ke endpoint
        const postRes = await axios.post('https://ssstik.io/abc?url=dl', {
            id: url,
            locale: 'en',
            tt: ttToken
        }, {
            headers: {
                'hx-current-url': 'https://ssstik.io/en',
                'hx-request': 'true',
                'hx-target': 'target',
                'hx-trigger': '_gcaptcha_pt',
                'origin': 'https://ssstik.io',
                'pragma': 'no-cache',
                'referer': 'https://ssstik.io/en',
                'content-type': 'application/x-www-form-urlencoded'
            }
        });

        // Parse HTML response buat dapet video URL (no WM)
        const videoMatch = postRes.data.match(/hdsrc="([^"]+)"/);
        return videoMatch ? videoMatch[1] : null;
    } catch (err) {
        throw new Error('SSSTik error: ' + err.message);
    }
};

// Di event messages.upsert, ganti handler TikTok jadi ini:
if (text.toLowerCase().startsWith('.tt ') || text.toLowerCase().startsWith('.tiktok ')) {
    const url = text.split(' ').slice(1).join(' ');
    if (!url.includes('tiktok')) return sock.sendMessage(from, { text: 'link TikTok manaaaa? gini nih contohnya: .tt https://vt.tiktok.com/abc' });

    await sock.sendMessage(from, { text: 'Sabar yaaa, lagi diprosess... ⏳' });
    try {
        // check access: rental required (single-tier)
        const fullSenderForTt = msg.key.participant || msg.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        const groupId = from;
        if (!hasAccessForCommand('.tt', isGroup, fullSenderForTt, groupId)) {
            return sock.sendMessage(from, { text: 'Fitur ini hanya tersedia untuk akun/grup yang menyewa bot. Ketik .sewa untuk info.' });
        }
        const res = await axios.get(`https://tikwm.com/api/?url=${url}`);
        if (res.data.code !== 0) throw new Error('API error: ' + res.data.msg);
        
        const videoUrl = res.data.data.play;  // URL video no watermark HD
        const title = res.data.data.title || 'TikTok Video Gacor';
        const author = res.data.data.author.unique_id || 'unknown';

        await sock.sendMessage(from, { 
            video: { url: videoUrl }, 
            caption: `*𝐒𝐚𝐦𝐀𝐥 | รักและรักคุณจริงๆ* ✅\n\n👤 Akun: @${author}\n📝 ${title}\n\donee, VT HD siap jadi SW — No Watermark! 🔥\nOriginal: ${url}` 
        });
    } catch (err) {
        console.log('TikWM Error:', err.message);  // Buat debug di terminal
        await sock.sendMessage(from, { text: `yaahhh gagalll😭\nError: ${err.message}\ncoba link lain atau tunggu bentar.` });
    }
    return;
}

                // SEWA — promotional info and how to rent
                if (text.toLowerCase() === '.sewa') {
                    const promo = `🌟 *SEWA BOT - Informasi* 🌟\n\n` +
                        `✨ *Sistem sewa sekarang sederhana:*\n` +
                        `• *Sewa = Bisa menggunakan semua fitur bot*\n` +
                        `• *Tidak sewa = Tidak bisa menggunakan perintah yang diawali titik (.)*\n\n` +
                        `📌 Cara penyewaan:\n` +
                        `• Private: berikan ID pengguna (nomor tanpa @) ke operator, contoh: .grant private 62812xxxxxxx 30\n` +
                        `• Group: jalankan perintah .grant group 30 oleh operator di dalam grup atau mention grup\n\n` +
                        `📞 Hubungi Operator untuk proses & harga: ID operator: ${OPERATOR_ID}\n` +
                        `Contoh perintah operator:\n` +
                        `• .grant private <id_user> <days>\n` +
                        `• .grant group <days>  (jalankan di grup atau sebutkan group id)\n\n` +
                        `Terima kasih! ✨`;
                    await sock.sendMessage(from, { text: promo });
                    return;
                }

                // OPERATOR: grant/revoke rentals
                if (text.toLowerCase().startsWith('.grant ') || text.toLowerCase().startsWith('.revoke ')) {
                if (text.toLowerCase().startsWith('.grant ') || text.toLowerCase().startsWith('.revoke ')) {
                    const fullSender = msg.key.participant || msg.key.remoteJid;
                    if (!isOperator(fullSender)) return sock.sendMessage(from, { text: 'Hanya operator yang bisa menjalankan perintah ini.' });

                    const parts = text.trim().split(/\s+/);
                    const cmd = parts[0].toLowerCase();
                    try {
                        if (cmd === '.grant') {
                            // Grant formats:
                            // .grant private <id_user> <days>
                            // .grant group <days>  (if run inside group) OR .grant group <groupId> <days>
                            const scope = parts[1];
                            if (!scope) return sock.sendMessage(from, { text: 'Format .grant: .grant <private|group> ...' });

                            if (scope === 'private') {
                                const targetRaw = parts[2];
                                const days = Number(parts[3]);
                                if (!targetRaw || !days) return sock.sendMessage(from, { text: 'Format: .grant private <id_user> <days>' });
                                // normalize id_user (strip non-digits, remove leading +)
                                let id = targetRaw.replace(/[^0-9]/g, '');
                                if (id.startsWith('0')) id = id.replace(/^0/, '62');
                                grantRental('private', id, 'rented', days, fullSender);
                                await sock.sendMessage(from, { text: `Sukses: diberikan akses sewa untuk ${id} selama ${days} hari.` });
                            } else if (scope === 'group') {
                                let days = null;
                                let groupId = null;
                                // if run inside group and parts[2] is days
                                if (from.endsWith('@g.us') && parts[2] && /^\d+$/.test(parts[2])) {
                                    days = Number(parts[2]);
                                    groupId = from;
                                } else if (parts[2] && parts[3] && /^\d+$/.test(parts[3])) {
                                    groupId = parts[2];
                                    days = Number(parts[3]);
                                }
                                if (!groupId || !days) return sock.sendMessage(from, { text: 'Format: .grant group <days> (jalankan di grup) atau .grant group <groupId> <days>' });
                                grantRental('group', groupId, 'rented', days, fullSender);
                                await sock.sendMessage(from, { text: `Sukses: diberikan akses sewa untuk grup ${groupId} selama ${days} hari.` });
                            } else {
                                return sock.sendMessage(from, { text: 'Scope tidak dikenal. Gunakan "private" atau "group".' });
                            }
                        } else {
                            // .revoke <private|group> <id?>
                            const scope = parts[1];
                            if (!scope) return sock.sendMessage(from, { text: 'Format .revoke: .revoke <private|group> <id?>' });
                            if (scope === 'private') {
                                const targetRaw = parts[2];
                                if (!targetRaw) return sock.sendMessage(from, { text: 'Format: .revoke private <id_user>' });
                                let id = targetRaw.replace(/[^0-9]/g, '');
                                if (id.startsWith('0')) id = id.replace(/^0/, '62');
                                revokeRental(id);
                                await sock.sendMessage(from, { text: `Sukses: rental untuk ${id} dicabut.` });
                            } else if (scope === 'group') {
                                let groupId = null;
                                if (from.endsWith('@g.us') && !parts[2]) groupId = from;
                                else if (parts[2]) groupId = parts[2];
                                if (!groupId) return sock.sendMessage(from, { text: 'Format: .revoke group <groupId> (atau jalankan di grup tanpa argumen)' });
                                revokeRental(groupId);
                                await sock.sendMessage(from, { text: `Sukses: rental untuk grup ${groupId} dicabut.` });
                            } else {
                                return sock.sendMessage(from, { text: 'Scope tidak dikenal. Gunakan "private" atau "group".' });
                            }
                        }
                    } catch (e) {
                        console.log('grant/revoke error:', e.message);
                        await sock.sendMessage(from, { text: `Gagal menjalankan perintah: ${e.message}` });
                    }
                    return;
                }

                // STIKER — 100% JADI & GAK "Cannot view sticker information" LAGI
                if (text.toLowerCase().includes('.stiker') || text.toLowerCase().includes('.sticker') || text.toLowerCase().includes('.s')) {
                    let imgMsg = null;

                    // Cara 1: Kirim gambar + caption !stiker langsung
                    if (msg.message?.imageMessage && (msg.message.imageMessage.caption || '').toLowerCase().includes('.stiker')) {
                        imgMsg = msg.message.imageMessage;
                    }
                    // Cara 2: Reply gambar + !stiker
                    else if (msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage) {
                        imgMsg = msg.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage;
                    }

                    if (!imgMsg) {
                        return sock.sendMessage(from, { text: 'Cara pakai:\n• Kirim foto + caption *.stiker*\n• Atau reply foto + ketik *.stiker*\n\nSupport JPG/PNG/GIF kecil!' });
                    }

                    await sock.sendMessage(from, { text: 'Sabar yaaa, lagi ku buat stikernyaaa... 🔥' });

                    try {
                        // Download buffer gambar
                        const stream = await downloadContentFromMessage(imgMsg, 'image');
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) {
                            buffer = Buffer.concat([buffer, chunk]);
                        }

                        // Convert ke WebP stiker pake Sharp (resize 512x512, quality 80)
                        const sharp = require('sharp');
                        const stickerBuffer = await sharp(buffer)
                            .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                            .webp({ quality: 80 })
                            .toBuffer();

                        // Kirim stiker final
                        await sock.sendMessage(from, {
                            sticker: stickerBuffer
                        }, {
                            packname: "𝐒𝐚𝐦𝐀𝐥 | รักและรักคุณจริงๆ",
                            author: "Owner Ganteng",
                            categories: ['👍', '❤️']
                        });

                    } catch (err) {
                        console.log('Stiker Sharp error:', err.message);
                        await sock.sendMessage(from, { text: 'Yahhhh gagall, fotonya terlalu HD kayanya deh 😭\nCoba foto yang lebih kecil (max 1MB) atau format JPG/PNG.' });
                    }
                    return;
                }
            }
        } catch (err) {
            console.log('Error tapi bot tetep hidup:', err.message);
        }
    });
}

connectToWhatsApp();