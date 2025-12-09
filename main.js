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
            // expired
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
                            try { await sock.sendMessage(target, { text }); } catch (e) {}
                            r.notifiedExpired = true; changed = true;
                        }
                        continue;
                    }
                    if (remaining <= 24 * 3600 * 1000 && !r.notified1day) {
                        const target = r.scope === 'group' ? key : `${key}@s.whatsapp.net`;
                        const text = `📢 Pengingat: masa sewa akan berakhir dalam kurang dari 24 jam (${formatDuration(remaining)}). Silakan perpanjang.`;
                        try { await sock.sendMessage(target, { text }); } catch (e) {}
                        r.notified1day = true; changed = true;
                    } else if (remaining <= 3 * 24 * 3600 * 1000 && !r.notified3days) {
                        const target = r.scope === 'group' ? key : `${key}@s.whatsapp.net`;
                        const text = `📢 Pengingat: masa sewa akan berakhir dalam ${Math.ceil(remaining / (24 * 3600 * 1000))} hari (${formatDuration(remaining)}).`;
                        try { await sock.sendMessage(target, { text }); } catch (e) {}
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
            // start rental reminder scheduler when connection is open
            try {
                scheduleRentalReminders();
            } catch (e) {
                console.log('Failed to start rental scheduler:', e.message);
            }
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
                    const tick = Date.now() - msgTs;
                    await sock.sendMessage(from, { text: `haloo, bot aktif dengan "${tick}"ms` });
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
                    let teks = 'TAG SEMUA ORANG!\n';
                    for (let mem of group.participants) {
                        teks += ` @${mem.id.split('@')[0]}\n`;
                    }
                    teks += ` \nBERHASIL TAG SEMUA ORANG ✅`;
                    await sock.sendMessage(from, { text: teks, mentions: group.participants.map(a => a.id) });
                    return;
                }

                // HIDETAG — TAG SEMUA TAPI DISEMBUNYIKAN, GANTI PESAN
if (text.toLowerCase().startsWith('.hidetag ') || text.toLowerCase().startsWith('.h ')) {
    if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'bisa dipake nyaa cuma di group' });

    const fullSender = msg.key.participant || msg.key.remoteJid;
    if (!hasAccessForCommand('.hidetag', true, fullSender, from)) return sock.sendMessage(from, { text: 'Fitur ini hanya tersedia untuk grup yang menyewa bot. Ketik .sewa untuk info.' });

    // Tentukan panjang potongan (slice length) berdasarkan command yang dipakai
    let sliceLength;
    if (text.toLowerCase().startsWith('.hidetag ')) {
        sliceLength = 9; // Untuk '.hidetag ' (9 karakter)
    } else if (text.toLowerCase().startsWith('.h ')) {
        sliceLength = 3; // Untuk '.h ' (3 karakter)
    } else {
        // Ini sebenarnya gak akan kena karena sudah dicek di 'if' awal, tapi buat jaga-jaga
        return;
    }

    const pesan = text.slice(sliceLength).trim(); // Potong teks dan hapus spasi di awal/akhir
    
    // Gunakan pesan atau karakter kosong jika pesan kosong
    const messageToSend = pesan ? pesan : '‎'; 
    
    const group = await sock.groupMetadata(from);
    await sock.sendMessage(from, { 
        text: messageToSend, 
        mentions: group.participants.map(a => a.id) 
    });
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
    if (!url.includes('tiktok')) return sock.sendMessage(from, { text: 'link TikTok-nya SALAAHHHHH!\n gini nih contoh yang bener: .tt https://vt.tiktok.com/abc' });

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
            caption: `*𝐒𝐚𝐦𝐀𝐥 | รักและรักคุณจริงๆ* ✅\n\n👤 Akun: @${author}\n📝 ${title}\n\nVT HD siap jadi SW — No Watermark! 🔥\nOriginal: ${url}`
        });
    } catch (err) {
        console.log('TikWM Error:', err.message);  // Buat debug di terminal
        await sock.sendMessage(from, { text: `yaahhh gagalll😭\nError: ${err.message}\ncoba link lain atau tunggu bentar.` });
    }
    return;
}

                // SEWA — promotional info and how to rent
if (text.toLowerCase() === '.sewa') {
    // loadOperators() masih dipanggil, tapi tidak perlu pakai opText lagi
    const ops = loadOperators();
    
    // Baris di bawah ini TIDAK PERLU lagi:
    // const opText = ops && ops.length ? ops.join(', ') : '6289528950624 - Sam @Sukabyone'; 
    
    const promo = `🌟 *Sistem Penyewaan Bot* 🌟 \n 𝐒𝐚𝐦𝐀𝐥 | รักและรักคุณจริงๆ \n\n` +
        `✨ *Sistem sewa sederhana:*\n` +
        `• *Sewa = Bisa menggunakan semua fitur bot*\n` +
        `• *Tidak sewa = Tidak bisa menggunakan sama seka   li*\n\n` +
        `📌 Cara penyewaan:\n` +
        `• Hubungi kontak Owner / Admin di bawah \n` +
        `• Chat Admin dan katakan bahwa ingin menyewa bot. \n _contoh: "Saya ingin menyewa bot selama 30 hari"_ \n\n` +
        `💰 *Harga Sewa:*\n` +
        `• Rp 10.000 untuk 30 hari (1 bulan)\n` +
        `• Rp 25.000 untuk 90 hari (3 bulan)\n` +
        `• Rp 45.000 untuk 180 hari (6 bulan)\n\n` +
        `📞 *Kontak Owner / Admin:*\n` +
        // Gunakan list 'ops' yang sudah di-map, dengan fallback jika list ops kosong:
        (ops && ops.length ? ops.map(op => `• wa.me/${op} - Sam @Sukabyone`).join('\n') : `• wa.me/6289528950624 - Sam @Sukabyone (Default)`)+ `\n\n` +
        `Terima kasih! ✨`;
    await sock.sendMessage(from, { text: promo });
    return;
}

                   // OPERATOR COMMAND: .grant & .revoke (FIXED 100% NO SYNTAX ERROR)
                if (text.toLowerCase().startsWith('.grant ') || text.toLowerCase().startsWith('.revoke ')) {
                    if (!isOperator(msg.key.participant || msg.key.remoteJid)) {
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
                                return sock.sendMessage(from, { text: 'Format: .grant private/group <id/grup> <hari>' });
                            }

                            let id = scope === 'private' ? target.replace(/[^0-9]/g, '') : (from.endsWith('@g.us') ? from : target);
                            if (id.startsWith('0')) id = '62' + id.slice(1);

                            grantRental(scope, id, 'premium', days, msg.key.participant || msg.key.remoteJid);
                            sock.sendMessage(from, { text: `✅ ${scope.toUpperCase()} ${id} berhasil disewa ${days} hari!` });
                        }

                        if (cmd === '.revoke') {
                            const target = args[1] || from;
                            revokeRental(target.includes('@') ? target : target.replace(/[^0-9]/g, ''));
                            sock.sendMessage(from, { text: '❌ Rental berhasil dicabut!' });
                        }
                    } catch (e) {
                        sock.sendMessage(from, { text: 'Error: ' + e.message });
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

                    // get targets
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
                                // if mention present, use that
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
                            `Tier: ${rental.tier || 'standard'}\n` +
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