const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const bakulan = require('./bakulan');

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        version: [2, 3000, 1027934701] // versi stabil biar gak error aneh
    });

    // ====================== SISTEM BAN PER GRUP ======================
    const BANNED_DB = path.join(__dirname, 'data', 'banned.json');
    const loadBans = () => {
        try {
            if (!fs.existsSync(BANNED_DB)) return {};
            return JSON.parse(fs.readFileSync(BANNED_DB, 'utf8'));
        } catch (e) {
            console.log('Load bans error:', e.message);
            return {};
        }
    };

    const saveBans = (data) => {
        try {
            fs.mkdirSync(path.dirname(BANNED_DB), { recursive: true });
            fs.writeFileSync(BANNED_DB, JSON.stringify(data, null, 2));
        } catch (e) {
            console.log('Save bans error:', e.message);
        }
    };

    // Auto kick banned user pas join grup (DI LUAR messages.upsert)
    sock.ev.on('group-participants.update', async (update) => {
        const { id, participants, action } = update;
        if (action !== 'add') return;

        const bans = loadBans();
        if (!bans[id]) return;

        const toKick = participants.filter(p => bans[id].includes(p));
        if (toKick.length > 0) {
            await sock.groupParticipantsUpdate(id, toKick, 'remove');
            for (const p of toKick) {
                await sock.sendMessage(id, { text: `@${p.split('@')[0]} dibanned dari grup ini!`, mentions: [p] });
            }
        }
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

    // Operators DB (editable)
    const OPERATORS_DB = path.join(__dirname, 'data', 'operators.json');

    const loadOperators = () => {
        try {
            if (!fs.existsSync(OPERATORS_DB)) return [];
            const raw = fs.readFileSync(OPERATORS_DB, 'utf8');
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            console.log('Operators DB load error:', e.message);
            return [];
        }
    };

    // Check operator robustly: accept numeric id or full JID appearance
    const isOperator = (fullJid) => {
        if (!fullJid) return false;
        try {
            const list = loadOperators();
            const numeric = fullJid.split('@')[0];

            // Allow bot's own account to act as operator as well
            try {
                const myId = (sock?.user && (sock.user.id || sock.user.jid)) || null;
                if (myId) {
                    if (fullJid.includes(myId) || fullJid.endsWith(`${myId}@s.whatsapp.net`)) return true;
                }
            } catch (e) {
                // ignore
            }

            for (const op of list) {
                if (!op) continue;
                if (String(op) === numeric) return true;
                if (fullJid.includes(String(op))) return true;
                if (fullJid.endsWith(`${op}@s.whatsapp.net`) || fullJid.endsWith(`${op}@c.us`) || fullJid.endsWith(`${op}@g.us`)) return true;
            }
        } catch (e) {
            console.log('isOperator check error:', e.message);
            return false;
        }
        return false;
    };

    const grantRental = (scope, id, tier, days, grantedBy) => {
        const rentals = loadRentals();
        const key = id;
        const expires = Date.now() + (Number(days) || 0) * 24 * 60 * 60 * 1000;
        rentals[key] = { scope, tier, expires, grantedBy, grantedAt: Date.now(), notified3days: false, notified1day: false, notifiedExpired: false };
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
            revokeRental(id);
            return null;
        }
        return r;
    };

    // Scheduler: remind tenants when their rental is nearing expiration
    const scheduleRentalReminders = () => {
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
                            r.notifiedExpired = true; changed = true;
                        }
                        continue;
                    }
                    if (remaining <= 24 * 3600 * 1000 && !r.notified1day) {
                        const target = r.scope === 'group' ? key : `${key}@s.whatsapp.net`;
                        const text = `📢 Pengingat: masa sewa akan berakhir dalam kurang dari 24 jam (${formatDuration(remaining)}). Silakan perpanjang.`;
                        try { await sock.sendMessage(target, { text }); } catch (e) { }
                        r.notified1day = true; changed = true;
                    } else if (remaining <= 3 * 24 * 3600 * 1000 && !r.notified3days) {
                        const target = r.scope === 'group' ? key : `${key}@s.whatsapp.net`;
                        const text = `📢 Pengingat: masa sewa akan berakhir dalam ${Math.ceil(remaining / (24 * 3600 * 1000))} hari (${formatDuration(remaining)}).`;
                        try { await sock.sendMessage(target, { text }); } catch (e) { }
                        r.notified3days = true; changed = true;
                    }
                }
                if (changed) saveRentals(rentals);
            } catch (e) {
                console.log('rental scheduler error:', e.message);
            }
        }, HOUR);
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

                await updateUserRecord(msg);

                if (text.toLowerCase() === '.menu' || text.toLowerCase() === '.help') {
                    await sock.sendMessage(from, { text: `*𝐒𝐚𝐦𝐀𝐥 | รักและรักคุณจริงๆ* 🔥\n\n✦ .menu / .help → tampilkan menu ini\n✦ .tagall → tag semua member\n✦ .hidetag [pesan] → tag tersembunyi\n✦ .tt [link] → download TikTok\n✦ .stiker / reply .stiker → membuat stiker dari foto\n✦ .ping → cek bot aktif dan delay\n✦ .promote @user → jadikan admin (hanya admin yang bisa pakai)\n✦ .demote @user → cabut admin (hanya admin yang bisa pakai)\n✦ .opengroup → buka grup supaya semua bisa chat (hanya admin)\n✦ .closegroup → tutup grup supaya hanya admin yang bisa chat (hanya admin)\n\nberminat untuk sewa?\nowner: wa.me/6289528950624 - Sam @Sukabyone` });
                    return;
                }

                if (text.toLowerCase() === '.ping') {
                    const msgTs = msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : Date.now();
                    const latencyMs = Date.now() - msgTs;
                    await sock.sendMessage(from, { text: `haloo, bot aktif dengan "${latencyMs}"ms` });
                    return;
                }

                if (text.toLowerCase() === '.profile' || text.toLowerCase() === '.profil') {
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

                if (text.toLowerCase() === '.closegroup' || text.toLowerCase() === '.opengroup') {
                    if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'Perintah ini hanya untuk grup.' });
                    const group = await sock.groupMetadata(from);
                    const sender = msg.key.participant || msg.key.remoteJid;
                    const isSenderAdmin = group.participants.some(p => p.id === sender && (p.admin === 'admin' || p.admin === 'superadmin' || p.isAdmin || p.isSuperAdmin));
                    if (!isSenderAdmin) return sock.sendMessage(from, { text: 'Hanya admin grup yang bisa menggunakan perintah ini.' });
                    const fullSender = msg.key.participant || msg.key.remoteJid;
                    if (!hasAccessForCommand(text.split(' ')[0], true, fullSender, from)) return sock.sendMessage(from, { text: 'Fitur ini membutuhkan paket sewa. Ketik .sewa untuk info.' });

                    try {
                        if (text.toLowerCase() === '.closegroup') {
                            await setGroupAnnouncement(from, true);
                            await sock.sendMessage(from, { text: 'Sukses! Grup ditutup — hanya admin yang bisa mengirim pesan sekarang.' });
                        } else {
                            await setGroupAnnouncement(from, false);
                            await sock.sendMessage(from, { text: 'Sukses! Grup dibuka — semua anggota bisa mengirim pesan sekarang.' });
                        }
                    } catch (err) {
                        console.log('Group control error:', err.message);
                        await sock.sendMessage(from, { text: `Gagal mengubah setelan grup: ${err.message}` });
                    }
                    return;
                }

                if (text.toLowerCase().startsWith('.promote') || text.toLowerCase().startsWith('.demote')) {
                    if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'Perintah ini hanya untuk grup.' });
                    const group = await sock.groupMetadata(from);
                    const sender = msg.key.participant || msg.key.remoteJid;
                    const isSenderAdmin = group.participants.some(p => p.id === sender && (p.admin === 'admin' || p.admin === 'superadmin' || p.isAdmin || p.isSuperAdmin));
                    if (!isSenderAdmin) return sock.sendMessage(from, { text: 'Hanya admin grup yang bisa menggunakan perintah ini.' });
                    const fullSenderProm = msg.key.participant || msg.key.remoteJid;
                    if (!hasAccessForCommand(text.split(' ')[0], true, fullSenderProm, from)) return sock.sendMessage(from, { text: 'Fitur ini membutuhkan paket sewa. Ketik .sewa untuk info.' });

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

                if (text.toLowerCase().startsWith('.hidetag ')) {
                    if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'bisa dipake nyaa cuma di group' });
                    const fullSender = msg.key.participant || msg.key.remoteJid;
                    if (!hasAccessForCommand('.hidetag', true, fullSender, from)) return sock.sendMessage(from, { text: 'Fitur ini hanya tersedia untuk grup yang menyewa bot. Ketik .sewa untuk info.' });
                    const pesan = text.slice(10);
                    const group = await sock.groupMetadata(from);
                    await sock.sendMessage(from, { text: pesan ? pesan : '‎', mentions: group.participants.map(a => a.id) });
                    return;
                }

                if (text.toLowerCase().startsWith('.tt ') || text.toLowerCase().startsWith('.tiktok ')) {
                    const url = text.split(' ').slice(1).join(' ');
                    if (!url.includes('tiktok')) return sock.sendMessage(from, { text: 'link TikTok manaaaa? gini nih contohnya: .tt https://vt.tiktok.com/abc' });

                    await sock.sendMessage(from, { text: 'Sabar yaaa, lagi diprosess... ⏳' });
                    try {
                        const fullSenderForTt = msg.key.participant || msg.key.remoteJid;
                        const isGroup = from.endsWith('@g.us');
                        const groupId = from;
                        if (!hasAccessForCommand('.tt', isGroup, fullSenderForTt, groupId)) {
                            return sock.sendMessage(from, { text: 'Fitur ini hanya tersedia untuk akun/grup yang menyewa bot. Ketik .sewa untuk info.' });
                        }
                        const res = await axios.get(`https://tikwm.com/api/?url=${url}`);
                        if (res.data.code !== 0) throw new Error('API error: ' + res.data.msg);
                        
                        const videoUrl = res.data.data.play;
                        const title = res.data.data.title || 'TikTok Video Gacor';
                        const author = res.data.data.author.unique_id || 'unknown';

                        await sock.sendMessage(from, { 
                            video: { url: videoUrl }, 
                            caption: `*𝐒𝐚𝐦𝐀𝐥 | รักและรักคุณจริงๆ* ✅\n\n👤 Akun: @${author}\n📝 ${title}\n\donee, VT HD siap jadi SW — No Watermark! 🔥\nOriginal: ${url}` 
                        });
                    } catch (err) {
                        console.log('TikWM Error:', err.message);
                        await sock.sendMessage(from, { text: `yaahhh gagalll😭\nError: ${err.message}\ncoba link lain atau tunggu bentar.` });
                    }
                    return;
                }

                if (text.toLowerCase() === '.sewa') {
                    const ops = loadOperators();
                    const opText = ops && ops.length ? ops.join(', ') : '6289528950624 - Sam @Sukabyone';
                    const promo = `🌟 *Sistem Penyewaan Bot* 🌟 \n 𝐒𝐚𝐦𝐀𝐥 | รักและรักคุณจริงๆ \n\n` +
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
                    await sock.sendMessage(from, { text: promo });
                    return;
                }

                if (text.toLowerCase().startsWith('.grant ') || text.toLowerCase().startsWith('.revoke ')) {
                    const fullSender = msg.key.participant || msg.key.remoteJid;
                    if (!isOperator(fullSender)) return sock.sendMessage(from, { text: 'Hanya operator yang bisa menjalankan perintah ini.' });

                    const parts = text.trim().split(/\s+/);
                    const cmd = parts[0].toLowerCase();
                    try {
                        if (cmd === '.grant') {
                            const scope = parts[1];
                            if (!scope) return sock.sendMessage(from, { text: 'Format .grant: .grant <private|group> ...' });

                            if (scope === 'private') {
                                const targetRaw = parts[2];
                                const days = Number(parts[3]);
                                if (!targetRaw || !days) return sock.sendMessage(from, { text: 'Format: .grant private <id_user> <days>' });
                                let id = targetRaw.replace(/[^0-9]/g, '');
                                if (id.startsWith('0')) id = id.replace(/^0/, '62');
                                grantRental('private', id, 'rented', days, fullSender);
                                await sock.sendMessage(from, { text: `Sukses: diberikan akses sewa untuk ${id} selama ${days} hari.` });
                            } else if (scope === 'group') {
                                let days = null;
                                let groupId = null;
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
                    if (msg.message?.imageMessage && (msg.message.imageMessage.caption || '').toLowerCase().includes('.stiker') || text.toLowerCase().includes('.sticker') || text.toLowerCase().includes('.s')) {
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
                        const stream = await downloadContentFromMessage(imgMsg, 'image');
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) {
                            buffer = Buffer.concat([buffer, chunk]);
                        }

                        const sharp = require('sharp');
                        const stickerBuffer = await sharp(buffer)
                            .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                            .webp({ quality: 80 })
                            .toBuffer();

                        await sock.sendMessage(from, { sticker: stickerBuffer });

                    } catch (err) {
                        console.log('Stiker Sharp error:', err.message);
                        await sock.sendMessage(from, { text: 'Yahhhh gagall, fotonya terlalu HD kayanya deh 😭\nCoba foto yang lebih kecil (max 1MB) atau format JPG/PNG.' });
                    }
                    return;
                }

                // CEKIDGROUP — tunjukkan ID grup
                if (text.toLowerCase() === '.cekidgroup') {
                    if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'Perintah ini hanya untuk grup.' });
                    const meta = await sock.groupMetadata(from);
                    const gid = from;
                    const title = meta?.subject || 'Group';
                    await sock.sendMessage(from, { text: `Group: ${title}\nID: ${gid}` });
                    return;
                }

                // JOIN — gabung ke grup lewat link: .join https://chat.whatsapp.com/XXXXXXXX
                if (text.toLowerCase().startsWith('.join ')) {
                    const parts = text.split(/\s+/);
                    const link = parts[1];
                    if (!link || !link.includes('chat.whatsapp.com')) return sock.sendMessage(from, { text: 'Format: .join <link chat.whatsapp.com/...>' });
                    const code = link.split('chat.whatsapp.com/')[1];
                    if (!code) return sock.sendMessage(from, { text: 'Link invalid.' });
                    try {
                        await sock.groupAcceptInvite(code);
                        await sock.sendMessage(from, { text: 'Berhasil join grup via link!' });
                    } catch (e) {
                        console.log('join error:', e.message);
                        await sock.sendMessage(from, { text: `Gagal join: ${e.message}` });
                    }
                    return;
                }

                // KICK — keluarkan member via mention/reply
                if (text.toLowerCase().startsWith('.kick')) {
                    if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'Perintah ini hanya untuk grup.' });
                    const group = await sock.groupMetadata(from);
                    const sender = msg.key.participant || msg.key.remoteJid;
                    const isSenderAdmin = group.participants.some(p => p.id === sender && (p.admin === 'admin' || p.admin === 'superadmin' || p.isAdmin || p.isSuperAdmin));
                    if (!isSenderAdmin) return sock.sendMessage(from, { text: 'Hanya admin grup yang bisa menggunakan perintah ini.' });
                    const fullSender = msg.key.participant || msg.key.remoteJid;
                    if (!hasAccessForCommand('.kick', true, fullSender, from)) return sock.sendMessage(from, { text: 'Fitur ini membutuhkan paket sewa. Ketik .sewa untuk info.' });

                    let targets = [];
                    const ext = msg.message?.extendedTextMessage;
                    if (ext?.contextInfo?.mentionedJid && ext.contextInfo.mentionedJid.length) {
                        targets = ext.contextInfo.mentionedJid;
                    } else if (ext?.contextInfo?.participant) {
                        targets = [ext.contextInfo.participant];
                    }
                    if (!targets.length) return sock.sendMessage(from, { text: 'Tandai (mention) atau reply ke pengguna yang ingin dikick.' });
                    try {
                        await sock.groupParticipantsUpdate(from, targets, 'remove');
                        await sock.sendMessage(from, { text: `Sukses mengeluarkan: ${targets.map(t => '@' + t.split('@')[0]).join(', ')}`, mentions: targets });
                    } catch (e) {
                        console.log('kick error:', e.message);
                        await sock.sendMessage(from, { text: `Gagal kick: ${e.message}` });
                    }
                    return;
                }

                // CEKSEWA — cek status sewa untuk group atau private
                if (text.toLowerCase().startsWith('.ceksewa')) {
                    try {
                        const parts = text.trim().split(/\s+/);
                        // formats supported:
                        // .ceksewa group <groupId>
                        // .ceksewa private <@mention|id>
                        // .ceksewa <id>  (auto-detect private)
                        // .ceksewa (inside group -> checks that group)

                        const arg1 = parts[1];
                        const arg2 = parts[2];
                        const ext = msg.message?.extendedTextMessage;

                        let scope = null;
                        let target = null;

                        if (!arg1) {
                            // no args: if in group, check that group; else check sender
                            if (from && from.endsWith('@g.us')) {
                                scope = 'group';
                                target = from;
                            } else {
                                scope = 'private';
                                target = (msg.key.participant || msg.key.remoteJid).split('@')[0];
                            }
                        } else if (arg1.toLowerCase() === 'group') {
                            scope = 'group';
                            target = arg2 || (from.endsWith('@g.us') ? from : null);
                        } else if (arg1.toLowerCase() === 'private') {
                            scope = 'private';
                            target = arg2 || null;
                        } else {
                            // could be direct id or mention
                            if (arg1.includes('@') || (ext?.contextInfo?.mentionedJid && ext.contextInfo.mentionedJid.length)) {
                                // if mention present, use
                                if (ext?.contextInfo?.mentionedJid && ext.contextInfo.mentionedJid.length) {
                                    scope = 'private';
                                    target = ext.contextInfo.mentionedJid[0];
                                } else {
                                    // direct jid passed
                                    if (arg1.includes('@')) {
                                        // group or user jid
                                        if (arg1.endsWith('@g.us')) {
                                            scope = 'group';
                                            target = arg1;
                                        } else {
                                            scope = 'private';
                                            target = arg1.split('@')[0];
                                        }
                                    } else {
                                        // numeric id passed, treat as private
                                        scope = 'private';
                                        target = arg1;
                                    }
                                }
                            } else {
                                // numeric or string without @ -> assume private id
                                scope = 'private';
                                target = arg1;
                            }
                        }

                        if (!scope || !target) return sock.sendMessage(from, { text: 'Format: .ceksewa group <groupId> atau .ceksewa private <@mention|idUser> atau jalankan di grup tanpa argumen untuk cek grup.' });

                        // normalize target key used by getRental
                        let key = target;
                        if (scope === 'private') {
                            if (typeof key === 'string' && key.includes('@')) key = key.split('@')[0];
                            key = String(key).replace(/[^0-9]/g, '');
                            if (key.startsWith('0')) key = '62' + key.slice(1);
                        }

                        const rental = getRental(key);
                        if (!rental) {
                            return sock.sendMessage(from, { text: `Tidak ada sewa aktif untuk ${scope} ${target}` });
                        }

                        const remainingMs = rental.expires - Date.now();
                        const textOut = `📌 Info Sewa (${scope})\n` +
                            `Target: ${target}\n` +
                            `Kadaluarsa: ${formatDate(rental.expires)} (${formatDuration(remainingMs)})\n` +
                            `Diberikan oleh: ${rental.grantedBy || 'unknown'}`;

                        return sock.sendMessage(from, { text: textOut });
                    } catch (e) {
                        console.log('ceksewa error:', e.message);
                        return sock.sendMessage(from, { text: 'Terjadi error saat memeriksa sewa: ' + e.message });
                    }
                }

                // STIKER — 100% JADI & GAK "Cannot view sticker information" LAGI
                // Error handling for the event handler
            }
        } catch (e) {
            console.log('messages.upsert error:', e.message);
        }
    });
}

connectToWhatsApp();