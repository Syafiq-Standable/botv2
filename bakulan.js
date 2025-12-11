const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const ORDERS_DB = path.join(DATA_DIR, 'orders.json');
const STATS_DB = path.join(DATA_DIR, 'stats.json');
const OPERATORS_DB = path.join(__dirname, 'data', 'operators.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const OWNERS_DB = path.join(__dirname, 'data', 'owners.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ===============================
// OWNER MANAGEMENT COMMANDS
// ===============================

// Show owner list (owner only)
async function showOwners(sock, from, msg) {
    const check = checkOwner(sock, from, msg);
    if (!check.allowed) return sock.sendMessage(from, { text: check.message });

    const owners = loadOwners();
    const ownerCount = owners.length;

    let message = `👑 *DAFTAR OWNER* (${ownerCount} orang)\n\n`;

    if (ownerCount === 0) {
        message += 'Belum ada owner yang terdaftar.\n';
        message += 'Tambahkan dengan: `.addowner 6281234567890`';
    } else {
        owners.forEach((owner, index) => {
            const formattedNumber = owner.startsWith('62') ?
                `+${owner}` : owner.startsWith('0') ?
                    `+62${owner.substring(1)}` : owner;
            message += `${index + 1}. ${formattedNumber}\n`;
        });
    }

    message += '\n━━━━━━━━━━━━━━━━━━━━\n';
    message += '📋 *PERINTAH OWNER:*\n';
    message += '• `.addowner 628xxx` ➜ Tambah owner\n';
    message += '• `.delowner 628xxx` ➜ Hapus owner\n';
    message += '• `.isowner 628xxx` ➜ Cek status owner';

    return sock.sendMessage(from, { text: message });
}

// Add owner (owner only)
async function addOwner(sock, from, text, msg) {
    const check = checkOwner(sock, from, msg);
    if (!check.allowed) return sock.sendMessage(from, { text: check.message });

    const match = text.match(/\.addowner\s+(\d+)/i);
    if (!match) {
        return sock.sendMessage(from, {
            text: 'Format: `.addowner 6281234567890`\nContoh: `.addowner 6281234567890`'
        });
    }

    const newOwner = match[1].trim();
    let owners = loadOwners();

    // Format nomor (pastikan 62)
    let formattedOwner = newOwner;
    if (formattedOwner.startsWith('0')) {
        formattedOwner = '62' + formattedOwner.substring(1);
    } else if (!formattedOwner.startsWith('62')) {
        formattedOwner = '62' + formattedOwner;
    }

    // Cek jika sudah ada
    if (owners.includes(formattedOwner)) {
        return sock.sendMessage(from, {
            text: `ℹ️ Nomor ${formattedOwner} sudah terdaftar sebagai owner.`
        });
    }

    owners.push(formattedOwner);

    try {
        fs.writeFileSync(OWNERS_DB, JSON.stringify(owners, null, 2));

        // Also add to operators if not already there
        const operators = loadOperators();
        if (!operators.includes(formattedOwner)) {
            operators.push(formattedOwner);
            fs.writeFileSync(OPERATORS_DB, JSON.stringify(operators, null, 2));
        }

        return sock.sendMessage(from, {
            text: `✅ *OWNER DITAMBAHKAN!*\n\n` +
                `📱 Nomor: ${formattedOwner}\n` +
                `👥 Total owner: ${owners.length}\n\n` +
                `Owner baru juga otomatis menjadi operator.`
        });
    } catch (e) {
        console.error('Error adding owner:', e);
        return sock.sendMessage(from, {
            text: `❌ Gagal menambahkan owner: ${e.message}`
        });
    }
}

// Delete owner (owner only)
async function deleteOwner(sock, from, text, msg) {
    const check = checkOwner(sock, from, msg);
    if (!check.allowed) return sock.sendMessage(from, { text: check.message });

    const match = text.match(/\.delowner\s+(\d+)/i);
    if (!match) {
        return sock.sendMessage(from, {
            text: 'Format: `.delowner 6281234567890`\nContoh: `.delowner 6281234567890`'
        });
    }

    const targetOwner = match[1].trim();
    let owners = loadOwners();

    // Format nomor
    let formattedOwner = targetOwner;
    if (formattedOwner.startsWith('0')) {
        formattedOwner = '62' + formattedOwner.substring(1);
    } else if (!formattedOwner.startsWith('62')) {
        formattedOwner = '62' + formattedOwner;
    }

    // Cek jika ada
    const index = owners.indexOf(formattedOwner);
    if (index === -1) {
        return sock.sendMessage(from, {
            text: `❌ Nomor ${formattedOwner} tidak ditemukan dalam daftar owner.`
        });
    }

    // Prevent removing last owner
    if (owners.length <= 1) {
        return sock.sendMessage(from, {
            text: '⚠️ Tidak dapat menghapus owner terakhir!'
        });
    }

    const removedOwner = owners.splice(index, 1)[0];

    try {
        fs.writeFileSync(OWNERS_DB, JSON.stringify(owners, null, 2));

        return sock.sendMessage(from, {
            text: `🗑️ *OWNER DIHAPUS!*\n\n` +
                `📱 Nomor: ${removedOwner}\n` +
                `👥 Total owner: ${owners.length}\n\n` +
                `Owner ini tidak lagi memiliki akses super admin.`
        });
    } catch (e) {
        console.error('Error deleting owner:', e);
        return sock.sendMessage(from, {
            text: `❌ Gagal menghapus owner: ${e.message}`
        });
    }
}

// Check owner status
async function checkOwnerStatus(sock, from, text, msg) {
    const match = text.match(/\.isowner(?:\s+(\d+))?/i);
    const targetNumber = match ? match[1] : null;

    // Untuk cek diri sendiri
    if (!targetNumber) {
        const sender = msg?.key?.participant || from;
        const isOwn = isOwner(sender, sock);

        return sock.sendMessage(from, {
            text: `🔍 *STATUS OWNER*\n\n` +
                `👤 Anda: ${sender.split('@')[0]}\n` +
                `👑 Status: ${isOwn ? '✅ OWNER' : '❌ BUKAN OWNER'}\n\n` +
                `${isOwn ?
                    'Anda memiliki akses penuh ke semua fitur termasuk manajemen owner dan operator.' :
                    'Hanya owner yang dapat mengelola sistem secara penuh.'}`
        });
    }

    // Untuk cek orang lain, perlu owner
    const check = checkOwner(sock, from, msg);
    if (!check.allowed) return sock.sendMessage(from, { text: check.message });

    // Format nomor
    let formattedOwner = targetNumber.trim();
    if (formattedOwner.startsWith('0')) {
        formattedOwner = '62' + formattedOwner.substring(1);
    } else if (!formattedOwner.startsWith('62')) {
        formattedOwner = '62' + formattedOwner;
    }

    const testJid = `${formattedOwner}@s.whatsapp.net`;
    const isOwn = isOwner(testJid, sock);
    const owners = loadOwners();

    return sock.sendMessage(from, {
        text: `🔍 *STATUS OWNER*\n\n` +
            `📱 Nomor: ${formattedOwner}\n` +
            `👑 Status: ${isOwn ? '✅ OWNER' : '❌ BUKAN OWNER'}\n` +
            `📋 Dalam database: ${owners.includes(formattedOwner) ? '✅ Ya' : '❌ Tidak'}\n\n` +
            `Total owner: ${owners.length}`
    });
}

// ===============================
// OPERATOR MANAGEMENT COMMANDS
// ===============================

// Show operator list (owner or operator)
async function showOperators(sock, from, msg) {
    const check = checkOperator(sock, from, msg);
    if (!check.allowed) return sock.sendMessage(from, { text: check.message });

    const operators = loadOperators();
    const owners = loadOwners();
    const operatorCount = operators.length;
    const ownerCount = owners.length;

    let message = `👷 *DAFTAR OPERATOR* (${operatorCount} orang)\n\n`;

    if (operatorCount === 0) {
        message += 'Belum ada operator yang terdaftar.\n';
        message += 'Tambahkan dengan: `.addop 6281234567890`';
    } else {
        operators.forEach((op, index) => {
            const formattedNumber = op.startsWith('62') ?
                `+${op}` : op.startsWith('0') ?
                    `+62${op.substring(1)}` : op;
            const isOwn = owners.includes(op);
            message += `${index + 1}. ${formattedNumber} ${isOwn ? '👑' : ''}\n`;
        });
    }

    message += `\n👑 Owner: ${ownerCount} orang\n`;
    message += `👷 Operator non-owner: ${operatorCount - ownerCount} orang\n`;

    message += '\n━━━━━━━━━━━━━━━━━━━━\n';
    message += '📋 *PERINTAH OPERATOR:*\n';
    message += '• `.addop 628xxx` ➜ Tambah operator\n';
    message += '• `.delop 628xxx` ➜ Hapus operator\n';
    message += '• `.isop` ➜ Cek status Anda\n';
    message += '• `.isop 628xxx` ➜ Cek operator lain\n\n';

    message += '👑 *PERINTAH OWNER ONLY:*\n';
    message += '• `.owners` ➜ Lihat daftar owner\n';
    message += '• `.addowner 628xxx` ➜ Tambah owner\n';
    message += '• `.delowner 628xxx` ➜ Hapus owner';

    return sock.sendMessage(from, { text: message });
}

// Add operator (owner only)
async function addOperator(sock, from, text, msg) {
    const check = checkOwner(sock, from, msg);
    if (!check.allowed) return sock.sendMessage(from, { text: check.message });

    const match = text.match(/\.addop\s+(\d+)/i);
    if (!match) {
        return sock.sendMessage(from, {
            text: 'Format: `.addop 6281234567890`\nContoh: `.addop 6281234567890`'
        });
    }

    const newOp = match[1].trim();
    let operators = loadOperators();

    // Format nomor (pastikan 62)
    let formattedOp = newOp;
    if (formattedOp.startsWith('0')) {
        formattedOp = '62' + formattedOp.substring(1);
    } else if (!formattedOp.startsWith('62')) {
        formattedOp = '62' + formattedOp;
    }

    // Cek jika sudah ada
    if (operators.includes(formattedOp)) {
        return sock.sendMessage(from, {
            text: `ℹ️ Nomor ${formattedOp} sudah terdaftar sebagai operator.`
        });
    }

    operators.push(formattedOp);

    try {
        fs.writeFileSync(OPERATORS_DB, JSON.stringify(operators, null, 2));

        return sock.sendMessage(from, {
            text: `✅ *OPERATOR DITAMBAHKAN!*\n\n` +
                `📱 Nomor: ${formattedOp}\n` +
                `👥 Total operator: ${operators.length}\n\n` +
                `Operator baru dapat menggunakan semua fitur bakulan kecuali manajemen owner.`
        });
    } catch (e) {
        console.error('Error adding operator:', e);
        return sock.sendMessage(from, {
            text: `❌ Gagal menambahkan operator: ${e.message}`
        });
    }
}

// Delete operator (owner only)
async function deleteOperator(sock, from, text, msg) {
    const check = checkOwner(sock, from, msg);
    if (!check.allowed) return sock.sendMessage(from, { text: check.message });

    const match = text.match(/\.delop\s+(\d+)/i);
    if (!match) {
        return sock.sendMessage(from, {
            text: 'Format: `.delop 6281234567890`\nContoh: `.delop 6281234567890`'
        });
    }

    const targetOp = match[1].trim();
    let operators = loadOperators();
    let owners = loadOwners();

    // Format nomor
    let formattedOp = targetOp;
    if (formattedOp.startsWith('0')) {
        formattedOp = '62' + formattedOp.substring(1);
    } else if (!formattedOp.startsWith('62')) {
        formattedOp = '62' + formattedOp;
    }

    // Cek jika ada
    const index = operators.indexOf(formattedOp);
    if (index === -1) {
        return sock.sendMessage(from, {
            text: `❌ Nomor ${formattedOp} tidak ditemukan dalam daftar operator.`
        });
    }

    // Prevent removing owners from operators
    if (owners.includes(formattedOp)) {
        return sock.sendMessage(from, {
            text: `⚠️ Tidak dapat menghapus owner dari daftar operator!\nGunakan \`.delowner\` untuk menghapus owner.`
        });
    }

    const removedOp = operators.splice(index, 1)[0];

    try {
        fs.writeFileSync(OPERATORS_DB, JSON.stringify(operators, null, 2));

        return sock.sendMessage(from, {
            text: `🗑️ *OPERATOR DIHAPUS!*\n\n` +
                `📱 Nomor: ${removedOp}\n` +
                `👥 Total operator: ${operators.length}\n\n` +
                `Operator ini tidak lagi dapat mengakses sistem bakulan.`
        });
    } catch (e) {
        console.error('Error deleting operator:', e);
        return sock.sendMessage(from, {
            text: `❌ Gagal menghapus operator: ${e.message}`
        });
    }
}

// Check operator status
async function checkOperatorStatus(sock, from, text, msg) {
    const match = text.match(/\.isop(?:\s+(\d+))?/i);
    const targetNumber = match ? match[1] : null;

    // Untuk cek diri sendiri
    if (!targetNumber) {
        const sender = msg?.key?.participant || from;
        const isOwn = isOwner(sender, sock);
        const isOp = isOperator(sender, sock);

        return sock.sendMessage(from, {
            text: `🔍 *STATUS ANDA*\n\n` +
                `👤 Anda: ${sender.split('@')[0]}\n` +
                `👑 Owner: ${isOwn ? '✅ YA' : '❌ TIDAK'}\n` +
                `👷 Operator: ${isOp ? '✅ YA' : '❌ TIDAK'}\n\n` +
                `${isOwn ?
                    'Anda memiliki akses penuh ke semua fitur termasuk manajemen owner dan operator.' :
                    isOp ?
                        'Anda dapat menggunakan semua fitur bakulan kecuali manajemen owner.' :
                        'Anda tidak memiliki akses ke sistem bakulan.\nHubungi admin untuk mendapatkan akses.'}`
        });
    }

    // Untuk cek orang lain, perlu operator
    const check = checkOperator(sock, from, msg);
    if (!check.allowed) return sock.sendMessage(from, { text: check.message });

    // Format nomor
    let formattedOp = targetNumber.trim();
    if (formattedOp.startsWith('0')) {
        formattedOp = '62' + formattedOp.substring(1);
    } else if (!formattedOp.startsWith('62')) {
        formattedOp = '62' + formattedOp;
    }

    const testJid = `${formattedOp}@s.whatsapp.net`;
    const isOwn = isOwner(testJid, sock);
    const isOp = isOperator(testJid, sock);
    const operators = loadOperators();
    const owners = loadOwners();

    return sock.sendMessage(from, {
        text: `🔍 *STATUS OPERATOR*\n\n` +
            `📱 Nomor: ${formattedOp}\n` +
            `👑 Owner: ${isOwn ? '✅ YA' : '❌ TIDAK'}\n` +
            `👷 Operator: ${isOp ? '✅ YA' : '❌ TIDAK'}\n` +
            `📋 Dalam database: ${operators.includes(formattedOp) ? '✅ Ya' : '❌ Tidak'}\n\n` +
            `Total operator: ${operators.length}\n` +
            `Total owner: ${owners.length}`
    });
}

// =============================
//  DATABASE FUNCTIONS
// =============================

const loadOrders = () => {
    try {
        const data = fs.readFileSync(ORDERS_DB, 'utf8');
        return JSON.parse(data);
    } catch {
        return {};
    }
};

const saveOrders = (data) => {
    try {
        // Create backup before saving
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFile = path.join(BACKUP_DIR, `orders_backup_${timestamp}.json`);
        if (fs.existsSync(ORDERS_DB)) {
            fs.copyFileSync(ORDERS_DB, backupFile);
        }

        fs.writeFileSync(ORDERS_DB, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error('❌ Gagal save orders:', e.message);
        return false;
    }
};

const loadStats = () => {
    try {
        const data = fs.readFileSync(STATS_DB, 'utf8');
        return JSON.parse(data);
    } catch {
        return {
            total_orders: 0,
            total_revenue: 0,
            monthly_stats: {},
            product_stats: {},
            method_stats: {}
        };
    }
};

const saveStats = (stats) => {
    try {
        fs.writeFileSync(STATS_DB, JSON.stringify(stats, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error('❌ Gagal save stats:', e.message);
        return false;
    }
};

// =============================
//  UTILITY FUNCTIONS
// =============================

const generateOrderId = (prefix = "ORD") => {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 5).toUpperCase();
    return `${prefix}${timestamp.slice(-4)}${random}`;
};

const formatCurrency = (amount) => {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0
    }).format(amount);
};

const formatDate = (date = new Date(), format = 'id-ID') => {
    if (!(date instanceof Date)) date = new Date(date);
    return date.toLocaleDateString(format, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
};

const parseDate = (dateStr) => {
    // Support multiple date formats
    const formats = [
        'YYYY-MM-DD',
        'DD/MM/YYYY',
        'MM-DD-YYYY'
    ];

    for (const format of formats) {
        try {
            // Basic parsing logic
            if (format === 'YYYY-MM-DD' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                return new Date(dateStr + 'T00:00:00');
            }
            if (format === 'DD/MM/YYYY' && /^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
                const [day, month, year] = dateStr.split('/');
                return new Date(`${year}-${month}-${day}T00:00:00`);
            }
        } catch (e) {
            continue;
        }
    }
    return new Date();
};

const validatePhone = (phone) => {
    // Clean phone number
    const clean = phone.replace(/[^0-9]/g, '');

    // Indonesian phone validation
    if (clean.startsWith('0')) {
        return '62' + clean.substring(1);
    } else if (clean.startsWith('62')) {
        return clean;
    } else if (clean.startsWith('8')) {
        return '62' + clean;
    }
    return clean;
};

// =============================
//  STATISTICS FUNCTIONS
// =============================

const updateStats = (order, action = 'add') => {
    const stats = loadStats();
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM

    if (action === 'add') {
        stats.total_orders++;
        stats.total_revenue += order.nominal || 0;

        // Monthly stats
        if (!stats.monthly_stats[month]) {
            stats.monthly_stats[month] = { orders: 0, revenue: 0 };
        }
        stats.monthly_stats[month].orders++;
        stats.monthly_stats[month].revenue += order.nominal || 0;

        // Product stats (extract product from catatan if available)
        const product = order.produk || order.catatan?.split(' ')[0] || 'lainnya';
        if (!stats.product_stats[product]) stats.product_stats[product] = 0;
        stats.product_stats[product]++;

        // Payment method stats
        if (order.metode) {
            if (!stats.method_stats[order.metode]) stats.method_stats[order.metode] = 0;
            stats.method_stats[order.metode]++;
        }
    } else if (action === 'remove' && order) {
        stats.total_orders = Math.max(0, stats.total_orders - 1);
        stats.total_revenue = Math.max(0, stats.total_revenue - (order.nominal || 0));
    }

    saveStats(stats);
};

// ===============================
// COMMAND FUNCTIONS (TANPA OBJEK COMMANDS)
// ===============================

// Show operator list (admin only)
async function showOperators(sock, from, msg) {
    const check = checkOperator(sock, from, msg);
    if (!check.allowed) return sock.sendMessage(from, { text: check.message });

    const operators = loadOperators();
    const operatorCount = operators.length;

    let message = `👑 *DAFTAR OPERATOR* (${operatorCount} orang)\n\n`;

    if (operatorCount === 0) {
        message += 'Belum ada operator yang terdaftar.\n';
        message += 'Tambahkan dengan: `.addop 6281234567890`';
    } else {
        operators.forEach((op, index) => {
            const formattedNumber = op.startsWith('62') ?
                `+${op}` : op.startsWith('0') ?
                    `+62${op.substring(1)}` : op;
            message += `${index + 1}. ${formattedNumber}\n`;
        });
    }

    message += '\n━━━━━━━━━━━━━━━━━━━━\n';
    message += '📋 *PERINTAH OPERATOR:*\n';
    message += '• `.addop 628xxx` ➜ Tambah operator\n';
    message += '• `.delop 628xxx` ➜ Hapus operator\n';
    message += '• `.isop 628xxx` ➜ Cek status operator';

    return sock.sendMessage(from, { text: message });
}

// Add operator (admin only)
async function addOperator(sock, from, text, msg) {
    const check = checkOperator(sock, from, msg);
    if (!check.allowed) return sock.sendMessage(from, { text: check.message });

    const match = text.match(/\.addop\s+(\d+)/i);
    if (!match) {
        return sock.sendMessage(from, {
            text: 'Format: `.addop 6281234567890`\nContoh: `.addop 6281234567890`'
        });
    }

    const newOp = match[1].trim();
    let operators = loadOperators();

    // Format nomor (pastikan 62)
    let formattedOp = newOp;
    if (formattedOp.startsWith('0')) {
        formattedOp = '62' + formattedOp.substring(1);
    } else if (!formattedOp.startsWith('62')) {
        formattedOp = '62' + formattedOp;
    }

    // Cek jika sudah ada
    if (operators.includes(formattedOp)) {
        return sock.sendMessage(from, {
            text: `ℹ️ Nomor ${formattedOp} sudah terdaftar sebagai operator.`
        });
    }

    operators.push(formattedOp);

    try {
        fs.writeFileSync(OPERATORS_DB, JSON.stringify(operators, null, 2));

        // Test if new operator can access
        const testJid = `${formattedOp}@s.whatsapp.net`;
        const canAccess = isOperator(testJid, sock);

        return sock.sendMessage(from, {
            text: `✅ *OPERATOR DITAMBAHKAN!*\n\n` +
                `📱 Nomor: ${formattedOp}\n` +
                `🔐 Status: ${canAccess ? '✅ Dapat akses' : '❌ Gagal verifikasi'}\n` +
                `👥 Total operator: ${operators.length}\n\n` +
                `Operator baru dapat langsung menggunakan semua fitur bakulan.`
        });
    } catch (e) {
        console.error('Error adding operator:', e);
        return sock.sendMessage(from, {
            text: `❌ Gagal menambahkan operator: ${e.message}`
        });
    }
}

// Delete operator (admin only)
async function deleteOperator(sock, from, text, msg) {
    const check = checkOperator(sock, from, msg);
    if (!check.allowed) return sock.sendMessage(from, { text: check.message });

    const match = text.match(/\.delop\s+(\d+)/i);
    if (!match) {
        return sock.sendMessage(from, {
            text: 'Format: `.delop 6281234567890`\nContoh: `.delop 6281234567890`'
        });
    }

    const targetOp = match[1].trim();
    let operators = loadOperators();

    // Format nomor
    let formattedOp = targetOp;
    if (formattedOp.startsWith('0')) {
        formattedOp = '62' + formattedOp.substring(1);
    } else if (!formattedOp.startsWith('62')) {
        formattedOp = '62' + formattedOp;
    }

    // Cek jika ada
    const index = operators.indexOf(formattedOp);
    if (index === -1) {
        return sock.sendMessage(from, {
            text: `❌ Nomor ${formattedOp} tidak ditemukan dalam daftar operator.`
        });
    }

    // Prevent removing last operator
    if (operators.length <= 1) {
        return sock.sendMessage(from, {
            text: '⚠️ Tidak dapat menghapus operator terakhir!'
        });
    }

    const removedOp = operators.splice(index, 1)[0];

    try {
        fs.writeFileSync(OPERATORS_DB, JSON.stringify(operators, null, 2));

        return sock.sendMessage(from, {
            text: `🗑️ *OPERATOR DIHAPUS!*\n\n` +
                `📱 Nomor: ${removedOp}\n` +
                `👥 Total operator: ${operators.length}\n\n` +
                `Operator ini tidak lagi dapat mengakses sistem bakulan.`
        });
    } catch (e) {
        console.error('Error deleting operator:', e);
        return sock.sendMessage(from, {
            text: `❌ Gagal menghapus operator: ${e.message}`
        });
    }
}

// Check operator status
async function checkOperatorStatus(sock, from, text, msg) {
    const match = text.match(/\.isop(?:\s+(\d+))?/i);
    const targetNumber = match ? match[1] : null;

    // Untuk cek diri sendiri, tidak perlu operator
    if (!targetNumber) {
        const sender = msg?.key?.participant || from;
        const isOp = isOperator(sender, sock);

        return sock.sendMessage(from, {
            text: `🔍 *STATUS OPERATOR*\n\n` +
                `👤 Anda: ${sender.split('@')[0]}\n` +
                `🔐 Status: ${isOp ? '✅ TERDAFTAR' : '❌ BUKAN OPERATOR'}\n\n` +
                `${isOp ?
                    'Anda dapat menggunakan semua fitur bakulan.' :
                    'Hanya operator yang dapat mengakses sistem bakulan.\nHubungi admin untuk mendapatkan akses.'}`
        });
    }

    // Untuk cek orang lain, perlu operator
    const check = checkOperator(sock, from, msg);
    if (!check.allowed) return sock.sendMessage(from, { text: check.message });

    // Format nomor
    let formattedOp = targetNumber.trim();
    if (formattedOp.startsWith('0')) {
        formattedOp = '62' + formattedOp.substring(1);
    } else if (!formattedOp.startsWith('62')) {
        formattedOp = '62' + formattedOp;
    }

    const testJid = `${formattedOp}@s.whatsapp.net`;
    const isOp = isOperator(testJid, sock);
    const operators = loadOperators();

    return sock.sendMessage(from, {
        text: `🔍 *STATUS OPERATOR*\n\n` +
            `📱 Nomor: ${formattedOp}\n` +
            `🔐 Status: ${isOp ? '✅ TERDAFTAR' : '❌ BUKAN OPERATOR'}\n` +
            `📋 Dalam database: ${operators.includes(formattedOp) ? '✅ Ya' : '❌ Tidak'}\n\n` +
            `Total operator: ${operators.length}`
    });
}

// ENHANCED MENU SYSTEM (Operator Only)
async function jualMenu(sock, from, msg) {
    const check = checkOperator(sock, from, msg);
    if (!check.allowed) return sock.sendMessage(from, { text: check.message });

    const stats = loadStats();
    const menu = `
📦 *BAKULAN SYSTEM PRO* 📦
🔐 *Operator Mode Only*

📊 *STATISTIK SISTEM:*
• Total Order: ${stats.total_orders}
• Total Revenue: ${formatCurrency(stats.total_revenue)}
• Bulan Ini: ${formatCurrency(stats.monthly_stats[new Date().toISOString().slice(0, 7)]?.revenue || 0)}

━━━━━━━━━━━━━━━━━━━━
⚡ *PERINTAH ORDER:*
• \`.order|nama|nominal|metode|nohp|produk\`
  ➜ Tambah order baru
• \`.orderplus|nama|nominal|metode|nohp|produk|catatan|status\`
  ➜ Order dengan detail lengkap

🔍 *PERINTAH LIHAT:*
• \`.orders\` ➜ Semua order (paginated)
• \`.order|ID\` ➜ Detail order spesifik
• \`.search|kata_kunci\` ➜ Cari order
• \`.today\` ➜ Order hari ini
• \`.pending\` ➜ Order belum selesai

⚙️ *PERINTAH UBAH:*
• \`.done|ID\` ➜ Tandai selesai
• \`.edit|ID|field|value\` ➜ Edit field
• \`.status|ID|status_baru\` ➜ Ubah status

🗑️ *PERINTAH HAPUS:*
• \`.delete|ID\` ➜ Hapus order
• \`.cancel|ID\` ➜ Batalkan order

📈 *PERINTAH ANALYTICS:*
• \`.stats\` ➜ Statistik lengkap
• \`.report|YYYY-MM\` ➜ Laporan bulanan
• \`.top\` ➜ Produk terlaris
• \`.chart\` ➜ Chart sederhana

👑 *PERINTAH OPERATOR:*
• \`.operators\` ➜ Daftar operator
• \`.addop 628xxx\` ➜ Tambah operator
• \`.delop 628xxx\` ➜ Hapus operator
• \`.isop\` ➜ Cek status Anda
• \`.isop 628xxx\` ➜ Cek operator lain

💾 *PERINTAH SYSTEM:*
• \`.backup\` ➜ Buat backup data
• \`.export\` ➜ Export data ke CSV
• \`.cleanup\` ➜ Bersihkan data lama

━━━━━━━━━━━━━━━━━━━━
📌 *STATUS ORDER:*
• \`pending\` - Menunggu pembayaran
• \`paid\` - Sudah bayar
• \`process\` - Sedang diproses
• \`completed\` - Selesai
• \`cancelled\` - Dibatalkan
• \`refunded\` - Refund

📞 *KONTAK SUPPORT:*
Ada masalah? Hubungi admin utama!
    `.trim();

    return sock.sendMessage(from, { text: menu });
}

// ENHANCED ADD ORDER
async function addOrder(sock, from, text, msg) {
    const check = checkOperator(sock, from, msg);
    if (!check.allowed) return sock.sendMessage(from, { text: check.message });

    const parts = text.split("|").map(p => p.trim());

    if (parts.length < 6) {
        return sock.sendMessage(from, {
            text: `📋 *FORMAT ORDER*\n\n` +
                `Gunakan: \`.order|nama|nominal|metode|nohp|produk\`\n` +
                `Contoh: \`.order|Budi|50000|Dana|08123456789|Topup ML\`\n\n` +
                `Untuk detail lengkap:\n` +
                `\`.orderplus|nama|nominal|metode|nohp|produk|catatan|status\``
        });
    }

    const [, nama, nominalStr, metode, nohp, produk] = parts;
    const catatan = parts[6] || '';
    const status = parts[7] || 'pending';

    // Validate inputs
    const nominal = parseInt(nominalStr);
    if (!nama || nama.length < 2) {
        return sock.sendMessage(from, { text: '❌ Nama harus minimal 2 karakter' });
    }

    if (isNaN(nominal) || nominal < 1000) {
        return sock.sendMessage(from, { text: '❌ Nominal minimal Rp 1.000' });
    }

    const validatedPhone = validatePhone(nohp);
    if (validatedPhone.length < 10) {
        return sock.sendMessage(from, { text: '❌ Nomor HP tidak valid' });
    }

    // Generate order
    const orderId = generateOrderId();
    const timestamp = new Date().toISOString();

    const order = {
        id: orderId,
        nama,
        nominal,
        metode: metode.toLowerCase(),
        nohp: validatedPhone,
        produk,
        catatan,
        status,
        timestamp,
        created_at: timestamp,
        updated_at: timestamp,
        created_by: from,
        history: [{
            action: 'created',
            timestamp,
            by: from,
            note: 'Order dibuat'
        }]
    };

    // Save to database
    const orders = loadOrders();
    orders[orderId] = order;

    if (saveOrders(orders)) {
        updateStats(order, 'add');

        // Send confirmation
        const message = `
✅ *ORDER BERHASIL DICATAT!*

📋 *DETAIL ORDER:*
🆔 ID: \`${orderId}\`
👤 Nama: ${nama}
💰 Nominal: ${formatCurrency(nominal)}
📱 No. HP: ${validatedPhone}
🏷️ Produk: ${produk}
💳 Metode: ${metode}
📝 Status: ${status}
📅 Waktu: ${formatDate(timestamp)}
${catatan ? `📌 Catatan: ${catatan}\n` : ''}
━━━━━━━━━━━━━━━━━━━━
*PERINTAH LANJUTAN:*
• \`.order ${orderId}\` ➜ Lihat detail
• \`.done ${orderId}\` ➜ Tandai selesai
• \`.edit ${orderId}|field|value\` ➜ Edit data
        `.trim();

        return sock.sendMessage(from, { text: message });
    } else {
        return sock.sendMessage(from, { text: '❌ Gagal menyimpan order' });
    }
}

// ENHANCED VIEW ORDERS (PAGINATED)
async function viewOrders(sock, from, text, msg) {
    const check = checkOperator(sock, from, msg);
    if (!check.allowed) return sock.sendMessage(from, { text: check.message });

    const orders = loadOrders();
    const orderList = Object.entries(orders).map(([id, order]) => ({ id, ...order }));

    if (orderList.length === 0) {
        return sock.sendMessage(from, { text: '📭 Tidak ada order yang tercatat.' });
    }

    // Parse optional page number
    const pageMatch = text.match(/page\s+(\d+)/i);
    const page = pageMatch ? parseInt(pageMatch[1]) : 1;
    const pageSize = 10;
    const totalPages = Math.ceil(orderList.length / pageSize);

    // Sort by latest first
    orderList.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Get current page
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const pageOrders = orderList.slice(start, end);

    // Build message
    let message = `📋 *DAFTAR ORDER* (${orderList.length} total)\n`;
    message += `Halaman ${page} dari ${totalPages}\n\n`;

    const statusIcons = {
        'pending': '⏳',
        'paid': '💳',
        'process': '🔄',
        'completed': '✅',
        'cancelled': '❌',
        'refunded': '💸'
    };

    pageOrders.forEach((order, index) => {
        const icon = statusIcons[order.status] || '📝';
        message += `${start + index + 1}. ${icon} *${order.id}*\n`;
        message += `   👤 ${order.nama} | ${formatCurrency(order.nominal)}\n`;
        message += `   🏷️ ${order.produk || 'Tanpa produk'}\n`;
        message += `   📅 ${formatDate(order.timestamp)}\n`;
        message += `   ─────────────────\n`;
    });

    if (totalPages > 1) {
        message += `\n📄 Navigasi: \`.orders page 2\` (halaman berikutnya)`;
    }

    return sock.sendMessage(from, { text: message });
}

// VIEW SINGLE ORDER
async function viewOrder(sock, from, text, msg) {
    const check = checkOperator(sock, from, msg);
    if (!check.allowed) return sock.sendMessage(from, { text: check.message });

    const match = text.match(/\.order\s+(\w+)/i);
    if (!match) {
        return sock.sendMessage(from, { text: 'Gunakan: `.order ID`\nContoh: `.order ORDABC123`' });
    }

    const orderId = match[1].toUpperCase();
    const orders = loadOrders();
    const order = orders[orderId];

    if (!order) {
        // Try to find similar orders
        const similar = Object.keys(orders).filter(id =>
            id.includes(orderId) || orderId.includes(id)
        );

        let reply = `❌ Order \`${orderId}\` tidak ditemukan.`;
        if (similar.length > 0) {
            reply += `\n\nMungkin maksud Anda:\n${similar.slice(0, 5).map(id => `• \`${id}\` - ${orders[id].nama}`).join('\n')}`;
        }
        return sock.sendMessage(from, { text: reply });
    }

    const statusIcons = {
        'pending': '⏳ Menunggu',
        'paid': '💳 Dibayar',
        'process': '🔄 Diproses',
        'completed': '✅ Selesai',
        'cancelled': '❌ Dibatalkan',
        'refunded': '💸 Refund'
    };

    const message = `
📄 *DETAIL ORDER*

🆔 ID: \`${order.id}\`
👤 Nama: ${order.nama}
📱 No. HP: ${order.nohp}
💰 Nominal: ${formatCurrency(order.nominal)}
🏷️ Produk: ${order.produk || '-'}
💳 Metode: ${order.metode || '-'}
📝 Status: ${statusIcons[order.status] || order.status}
📅 Dibuat: ${formatDate(order.created_at)}
🔄 Diupdate: ${formatDate(order.updated_at)}
${order.catatan ? `📌 Catatan: ${order.catatan}\n` : ''}
━━━━━━━━━━━━━━━━━━━━
*HISTORY:*
${order.history ? order.history.slice(-3).map(h =>
        `• ${formatDate(h.timestamp)}: ${h.action}${h.note ? ` (${h.note})` : ''}`
    ).join('\n') : 'Tidak ada history'}

━━━━━━━━━━━━━━━━━━━━
*PERINTAH:*
• \`.done ${order.id}\` ➜ Tandai selesai
• \`.edit ${order.id}|field|value\` ➜ Edit
• \`.status ${order.id}|status_baru\` ➜ Ubah status
• \`.delete ${order.id}\` ➜ Hapus
    `.trim();

    return sock.sendMessage(from, { text: message });
}

// ENHANCED MARK DONE (with history)
async function markDone(sock, from, text, msg) {
    const check = checkOperator(sock, from, msg);
    if (!check.allowed) return sock.sendMessage(from, { text: check.message });

    const match = text.match(/\.done\s+(\w+)/i);
    if (!match) {
        return sock.sendMessage(from, { text: 'Gunakan: `.done ID`\nContoh: `.done ORDABC123`' });
    }

    const orderId = match[1].toUpperCase();
    const orders = loadOrders();
    const order = orders[orderId];

    if (!order) {
        // Fuzzy search for similar IDs
        const allIds = Object.keys(orders);
        const similar = allIds.filter(id =>
            id.toLowerCase().includes(orderId.toLowerCase()) ||
            orderId.toLowerCase().includes(id.toLowerCase())
        );

        let reply = `❌ Order \`${orderId}\` tidak ditemukan.`;
        if (similar.length > 0) {
            reply += `\n\nOrder yang tersedia:\n${similar.slice(0, 5).map(id =>
                `• \`${id}\` - ${orders[id].nama} (${orders[id].status})`
            ).join('\n')}`;
        } else if (allIds.length > 0) {
            reply += `\n\nOrder aktif:\n${allIds.slice(0, 5).map(id =>
                `• \`${id}\` - ${orders[id].nama}`
            ).join('\n')}`;
            if (allIds.length > 5) reply += `\n...dan ${allIds.length - 5} lainnya`;
        }
        return sock.sendMessage(from, { text: reply });
    }

    // Check current status
    if (order.status === 'completed') {
        return sock.sendMessage(from, {
            text: `ℹ️ Order \`${orderId}\` sudah selesai sejak ${formatDate(order.updated_at)}`
        });
    }

    // Update order
    const oldStatus = order.status;
    order.status = 'completed';
    order.updated_at = new Date().toISOString();

    // Add to history
    if (!order.history) order.history = [];
    order.history.push({
        action: 'status_change',
        timestamp: order.updated_at,
        by: from,
        note: `${oldStatus} → completed`,
        details: { old_status: oldStatus, new_status: 'completed' }
    });

    orders[orderId] = order;

    if (saveOrders(orders)) {
        const message = `
✅ *ORDER SELESAI!*

🆔 \`${orderId}\`
👤 ${order.nama}
💰 ${formatCurrency(order.nominal)}
🏷️ ${order.produk || '-'}
📅 Selesai: ${formatDate(order.updated_at)}

📊 Status: ${oldStatus} → ✅ *COMPLETED*

━━━━━━━━━━━━━━━━━━━━
*OPSI LAINNYA:*
• \`.order ${orderId}\` ➜ Lihat detail lengkap
• \`.stats\` ➜ Lihat statistik
• \`.today\` ➜ Order hari ini
        `.trim();

        return sock.sendMessage(from, { text: message });
    } else {
        return sock.sendMessage(from, { text: '❌ Gagal menyimpan perubahan' });
    }
}

// SEARCH ORDERS
async function searchOrders(sock, from, text, msg) {
    const check = checkOperator(sock, from, msg);
    if (!check.allowed) return sock.sendMessage(from, { text: check.message });

    const match = text.match(/\.search\s+(.+)/i);
    if (!match) {
        return sock.sendMessage(from, {
            text: 'Gunakan: `.search kata_kunci`\nContoh: `.search Budi` atau `.search 50000`'
        });
    }

    const query = match[1].toLowerCase();
    const orders = loadOrders();
    const results = [];

    // Search in all fields
    for (const [id, order] of Object.entries(orders)) {
        if (
            id.toLowerCase().includes(query) ||
            order.nama.toLowerCase().includes(query) ||
            order.nohp.includes(query) ||
            order.produk?.toLowerCase().includes(query) ||
            order.catatan?.toLowerCase().includes(query) ||
            order.metode?.toLowerCase().includes(query) ||
            order.nominal.toString().includes(query)
        ) {
            results.push({ id, ...order });
        }
    }

    if (results.length === 0) {
        return sock.sendMessage(from, {
            text: `🔍 Tidak ditemukan order dengan kata kunci "${query}"`
        });
    }

    // Sort by relevance (exact matches first)
    results.sort((a, b) => {
        const aScore = a.nama.toLowerCase() === query ? 100 :
            a.id.toLowerCase() === query ? 90 : 0;
        const bScore = b.nama.toLowerCase() === query ? 100 :
            b.id.toLowerCase() === query ? 90 : 0;
        return bScore - aScore;
    });

    let message = `🔍 *HASIL PENCARIAN* (${results.length} ditemukan)\n\n`;

    results.slice(0, 10).forEach((order, index) => {
        const statusIcon = {
            'pending': '⏳', 'paid': '💳', 'process': '🔄',
            'completed': '✅', 'cancelled': '❌', 'refunded': '💸'
        }[order.status] || '📝';

        message += `${index + 1}. ${statusIcon} *${order.id}*\n`;
        message += `   👤 ${order.nama} | ${formatCurrency(order.nominal)}\n`;
        message += `   📱 ${order.nohp.slice(-4)} | ${order.status}\n`;
        message += `   🏷️ ${order.produk || '-'}\n`;
        if (order.catatan) message += `   📝 ${order.catatan.slice(0, 30)}${order.catatan.length > 30 ? '...' : ''}\n`;
        message += `   ─────────────────\n`;
    });

    if (results.length > 10) {
        message += `\n📄 Menampilkan 10 dari ${results.length} hasil. Gunakan filter yang lebih spesifik.`;
    }

    message += `\n\n💡 *Tips:* Gunakan \`.order ID\` untuk melihat detail lengkap`;

    return sock.sendMessage(from, { text: message });
}

// VIEW TODAY'S ORDERS
async function todayOrders(sock, from, msg) {
    const check = checkOperator(sock, from, msg);
    if (!check.allowed) return sock.sendMessage(from, { text: check.message });

    const orders = loadOrders();
    const today = new Date().toISOString().split('T')[0];
    const todayOrders = [];

    for (const [id, order] of Object.entries(orders)) {
        const orderDate = new Date(order.timestamp).toISOString().split('T')[0];
        if (orderDate === today) {
            todayOrders.push({ id, ...order });
        }
    }

    if (todayOrders.length === 0) {
        return sock.sendMessage(from, {
            text: `📅 Tidak ada order hari ini (${formatDate(new Date(), 'id-ID').split(',')[0]})`
        });
    }

    // Calculate totals
    const totalRevenue = todayOrders.reduce((sum, order) => sum + order.nominal, 0);
    const byStatus = {};
    todayOrders.forEach(order => {
        byStatus[order.status] = (byStatus[order.status] || 0) + 1;
    });

    let message = `📅 *ORDER HARI INI* (${formatDate(new Date(), 'id-ID').split(',')[0]})\n\n`;
    message += `📊 *STATISTIK:*\n`;
    message += `• Total Order: ${todayOrders.length}\n`;
    message += `• Total Revenue: ${formatCurrency(totalRevenue)}\n`;
    message += `• Status:\n`;
    Object.entries(byStatus).forEach(([status, count]) => {
        const icon = {
            'pending': '⏳', 'paid': '💳', 'process': '🔄',
            'completed': '✅', 'cancelled': '❌', 'refunded': '💸'
        }[status] || '📝';
        message += `  ${icon} ${status}: ${count}\n`;
    });

    message += `\n📋 *DAFTAR ORDER:*\n`;
    todayOrders.forEach((order, index) => {
        const icon = {
            'pending': '⏳', 'paid': '💳', 'process': '🔄',
            'completed': '✅', 'cancelled': '❌', 'refunded': '💸'
        }[order.status] || '📝';

        message += `${index + 1}. ${icon} *${order.id}*\n`;
        message += `   👤 ${order.nama} | ${formatCurrency(order.nominal)}\n`;
        message += `   🏷️ ${order.produk || '-'}\n`;
        message += `   ─────────────────\n`;
    });

    return sock.sendMessage(from, { text: message });
}

// VIEW PENDING ORDERS
async function pendingOrders(sock, from, msg) {
    const check = checkOperator(sock, from, msg);
    if (!check.allowed) return sock.sendMessage(from, { text: check.message });

    const orders = loadOrders();
    const pending = Object.entries(orders)
        .filter(([_, order]) => ['pending', 'paid', 'process'].includes(order.status))
        .map(([id, order]) => ({ id, ...order }));

    if (pending.length === 0) {
        return sock.sendMessage(from, {
            text: '🎉 Tidak ada order yang pending! Semua order sudah selesai.'
        });
    }

    let message = `⏳ *ORDER PENDING* (${pending.length} order)\n\n`;

    pending.forEach((order, index) => {
        const statusIcon = {
            'pending': '⏳ Menunggu Bayar',
            'paid': '💳 Sudah Bayar',
            'process': '🔄 Diproses'
        }[order.status];

        message += `${index + 1}. *${order.id}*\n`;
        message += `   👤 ${order.nama}\n`;
        message += `   💰 ${formatCurrency(order.nominal)}\n`;
        message += `   📱 ${order.nohp.slice(-4)}\n`;
        message += `   🏷️ ${order.produk || '-'}\n`;
        message += `   ${statusIcon}\n`;
        message += `   📅 ${formatDate(order.timestamp)}\n`;
        message += `   ─────────────────\n`;
    });

    message += `\n💡 *Tindakan:*\n`;
    message += `Gunakan \`.done ID\` untuk menandai selesai\n`;
    message += `Gunakan \`.order ID\` untuk melihat detail`;

    return sock.sendMessage(from, { text: message });
}

// ADVANCED STATISTICS
async function showStats(sock, from, msg) {
    const check = checkOperator(sock, from, msg);
    if (!check.allowed) return sock.sendMessage(from, { text: check.message });

    const stats = loadStats();
    const orders = loadOrders();

    const today = new Date().toISOString().split('T')[0];
    const todayOrders = Object.values(orders).filter(order =>
        new Date(order.timestamp).toISOString().split('T')[0] === today
    );
    const todayRevenue = todayOrders.reduce((sum, order) => sum + order.nominal, 0);

    // Calculate status distribution
    const statusCount = {};
    Object.values(orders).forEach(order => {
        statusCount[order.status] = (statusCount[order.status] || 0) + 1;
    });

    // Top products
    const topProducts = Object.entries(stats.product_stats || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    // Monthly revenue (last 6 months)
    const months = Object.entries(stats.monthly_stats || {})
        .sort((a, b) => b[0].localeCompare(a[0]))
        .slice(0, 6);

    const message = `
📊 *SISTEM STATISTIK BAKULAN*

━━━━━━━━━━━━━━━━━━━━
📈 *OVERVIEW:*
• Total Order: ${stats.total_orders}
• Total Revenue: ${formatCurrency(stats.total_revenue)}
• Order Hari Ini: ${todayOrders.length} (${formatCurrency(todayRevenue)})

━━━━━━━━━━━━━━━━━━━━
📅 *DISTRIBUSI STATUS:*
${Object.entries(statusCount).map(([status, count]) => {
        const icon = {
            'pending': '⏳', 'paid': '💳', 'process': '🔄',
            'completed': '✅', 'cancelled': '❌', 'refunded': '💸'
        }[status] || '📝';
        const percent = ((count / stats.total_orders) * 100).toFixed(1);
        return `• ${icon} ${status}: ${count} (${percent}%)`;
    }).join('\n')}

━━━━━━━━━━━━━━━━━━━━
🏆 *PRODUK TERLARIS:*
${topProducts.length > 0 ? topProducts.map(([product, count]) =>
        `• ${product}: ${count} order`
    ).join('\n') : 'Belum ada data produk'}

━━━━━━━━━━━━━━━━━━━━
📅 *REVENUE 6 BULAN TERAKHIR:*
${months.length > 0 ? months.map(([month, data]) => {
        const [year, mon] = month.split('-');
        return `• ${mon}/${year}: ${formatCurrency(data.revenue)} (${data.orders} order)`;
    }).join('\n') : 'Belum ada data bulanan'}

━━━━━━━━━━━━━━━━━━━━
💳 *METODE PEMBAYARAN:*
${Object.entries(stats.method_stats || {}).map(([method, count]) =>
        `• ${method}: ${count}`
    ).join('\n') || 'Belum ada data metode'}

━━━━━━━━━━━━━━━━━━━━
💡 *PERINTAH LAINNYA:*
• \`.report YYYY-MM\` ➜ Laporan bulanan
• \`.top\` ➜ Detail produk terlaris
• \`.chart\` ➜ Chart visual
    `.trim();

    return sock.sendMessage(from, { text: message });
}

// MONTHLY REPORT
async function monthlyReport(sock, from, text, msg) {
    const check = checkOperator(sock, from, msg);
    if (!check.allowed) return sock.sendMessage(from, { text: check.message });

    const match = text.match(/\.report\s+(\d{4}-\d{2})/i);
    const month = match ? match[1] : new Date().toISOString().slice(0, 7);

    const orders = loadOrders();
    const monthOrders = Object.values(orders).filter(order => {
        const orderMonth = new Date(order.timestamp).toISOString().slice(0, 7);
        return orderMonth === month;
    });

    if (monthOrders.length === 0) {
        return sock.sendMessage(from, {
            text: `📭 Tidak ada order pada bulan ${month}`
        });
    }

    // Calculate statistics
    const totalRevenue = monthOrders.reduce((sum, order) => sum + order.nominal, 0);
    const statusCount = {};
    const productRevenue = {};
    const methodCount = {};

    monthOrders.forEach(order => {
        // Status count
        statusCount[order.status] = (statusCount[order.status] || 0) + 1;

        // Product revenue
        const product = order.produk || 'lainnya';
        productRevenue[product] = (productRevenue[product] || 0) + order.nominal;

        // Method count
        if (order.metode) {
            methodCount[order.metode] = (methodCount[order.metode] || 0) + 1;
        }
    });

    // Top products
    const topProducts = Object.entries(productRevenue)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    const [year, mon] = month.split('-');
    const monthName = new Date(`${year}-${mon}-01`).toLocaleDateString('id-ID', { month: 'long' });

    const message = `
📊 *LAPORAN BULANAN: ${monthName} ${year}*

━━━━━━━━━━━━━━━━━━━━
📈 *OVERVIEW:*
• Total Order: ${monthOrders.length}
• Total Revenue: ${formatCurrency(totalRevenue)}
• Rata-rata/Order: ${formatCurrency(totalRevenue / monthOrders.length)}

━━━━━━━━━━━━━━━━━━━━
📋 *DISTRIBUSI STATUS:*
${Object.entries(statusCount).map(([status, count]) => {
        const icon = {
            'pending': '⏳', 'paid': '💳', 'process': '🔄',
            'completed': '✅', 'cancelled': '❌', 'refunded': '💸'
        }[status] || '📝';
        const percent = ((count / monthOrders.length) * 100).toFixed(1);
        return `• ${icon} ${status}: ${count} order (${percent}%)`;
    }).join('\n')}

━━━━━━━━━━━━━━━━━━━━
🏆 *PRODUK TERBAIK:*
${topProducts.map(([product, revenue], index) => {
        const percent = ((revenue / totalRevenue) * 100).toFixed(1);
        const emoji = ['🥇', '🥈', '🥉', '4.', '5.'][index] || '•';
        return `${emoji} ${product}: ${formatCurrency(revenue)} (${percent}%)`;
    }).join('\n')}

━━━━━━━━━━━━━━━━━━━━
💳 *METODE PEMBAYARAN:*
${Object.entries(methodCount).map(([method, count]) =>
        `• ${method}: ${count} order`
    ).join('\n') || 'Tidak ada data metode'}

━━━━━━━━━━━━━━━━━━━━
📅 *ORDER TERBARU:*
${monthOrders
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, 3)
            .map(order => `• ${order.nama}: ${formatCurrency(order.nominal)} (${order.status})`)
            .join('\n')}

━━━━━━━━━━━━━━━━━━━━
💡 *REKOMENDASI:*
${totalRevenue > 0 ?
            `• Fokus pada produk: *${topProducts[0]?.[0] || '-'}\n` +
            `• Tingkatkan konversi dari status "pending"\n` +
            `• Metode populer: ${Object.entries(methodCount).sort((a, b) => b[1] - a[1])[0]?.[0] || '-'}`
            : 'Belum ada data yang cukup untuk rekomendasi'}
    `.trim();

    return sock.sendMessage(from, { text: message });
}

// EXPORT DATA
async function exportData(sock, from, msg) {
    const check = checkOperator(sock, from, msg);
    if (!check.allowed) return sock.sendMessage(from, { text: check.message });

    const orders = loadOrders();
    if (Object.keys(orders).length === 0) {
        return sock.sendMessage(from, { text: '📭 Tidak ada data untuk diexport' });
    }

    // Create CSV content
    let csv = 'ID,Nama,Nominal,Metode,NoHP,Produk,Status,Catatan,Tanggal\n';

    Object.values(orders).forEach(order => {
        const row = [
            `"${order.id}"`,
            `"${order.nama}"`,
            order.nominal,
            `"${order.metode || ''}"`,
            `"${order.nohp || ''}"`,
            `"${order.produk || ''}"`,
            `"${order.status}"`,
            `"${(order.catatan || '').replace(/"/g, '""')}"`,
            `"${order.timestamp}"`
        ];
        csv += row.join(',') + '\n';
    });

    // Save to file
    const exportFile = path.join(DATA_DIR, `export_${Date.now()}.csv`);
    fs.writeFileSync(exportFile, csv, 'utf8');

    // Send file via WhatsApp
    await sock.sendMessage(from, {
        document: { url: `file://${exportFile}` },
        fileName: `bakulan_export_${new Date().toISOString().split('T')[0]}.csv`,
        mimetype: 'text/csv',
        caption: `📤 *EXPORT DATA BAKULAN*\n\n` +
            `Total: ${Object.keys(orders).length} order\n` +
            `Tanggal: ${formatDate(new Date())}\n\n` +
            `File akan terhapus otomatis dalam 24 jam.`
    });

    // Delete file after 1 minute (optional)
    setTimeout(() => {
        try {
            if (fs.existsSync(exportFile)) {
                fs.unlinkSync(exportFile);
                console.log(`🗑️ Deleted export file: ${exportFile}`);
            }
        } catch (e) {
            console.error('Error deleting export file:', e.message);
        }
    }, 60000);

    return true;
}

// SYSTEM CLEANUP
async function systemCleanup(sock, from, msg) {
    const check = checkOperator(sock, from, msg);
    if (!check.allowed) return sock.sendMessage(from, { text: check.message });

    const orders = loadOrders();
    const oldOrders = [];
    const now = new Date();
    const thirtyDaysAgo = new Date(now.setDate(now.getDate() - 30));

    for (const [id, order] of Object.entries(orders)) {
        const orderDate = new Date(order.timestamp);
        if (orderDate < thirtyDaysAgo && order.status === 'completed') {
            oldOrders.push(id);
        }
    }

    if (oldOrders.length === 0) {
        return sock.sendMessage(from, {
            text: '🧹 Tidak ada data lama (>30 hari) yang bisa dibersihkan.'
        });
    }

    // Create archive
    const archive = {};
    oldOrders.forEach(id => {
        archive[id] = orders[id];
        delete orders[id];
    });

    // Save archive
    const archiveFile = path.join(BACKUP_DIR, `archive_${Date.now()}.json`);
    fs.writeFileSync(archiveFile, JSON.stringify(archive, null, 2));

    // Save current orders
    saveOrders(orders);

    return sock.sendMessage(from, {
        text: `🧹 *CLEANUP SELESAI*\n\n` +
            `• Order diarsipkan: ${oldOrders.length}\n` +
            `• Order tersisa: ${Object.keys(orders).length}\n` +
            `• File archive: ${path.basename(archiveFile)}\n\n` +
            `📂 Arsip disimpan di folder backups.`
    });
}

// EDIT ORDER (ENHANCED)
async function editOrder(sock, from, text, msg) {
    const check = checkOperator(sock, from, msg);
    if (!check.allowed) return sock.sendMessage(from, { text: check.message });

    const match = text.match(/\.edit\s+(\w+)\|(\w+)\|(.+)/i);
    if (!match) {
        return sock.sendMessage(from, {
            text: 'Gunakan: `.edit ID|field|value`\n' +
                'Contoh: `.edit ORDABC123|status|completed`\n' +
                'Field yang bisa diedit: nama, nominal, metode, nohp, produk, catatan, status'
        });
    }

    const [, orderId, field, value] = match;
    const allowedFields = ['nama', 'nominal', 'metode', 'nohp', 'produk', 'catatan', 'status'];

    if (!allowedFields.includes(field.toLowerCase())) {
        return sock.sendMessage(from, {
            text: `❌ Field "${field}" tidak valid.\n` +
                `Field yang diperbolehkan: ${allowedFields.join(', ')}`
        });
    }

    const orders = loadOrders();
    const order = orders[orderId.toUpperCase()];

    if (!order) {
        return sock.sendMessage(from, {
            text: `❌ Order \`${orderId}\` tidak ditemukan.`
        });
    }

    const oldValue = order[field];
    let newValue = value;

    // Special handling for each field
    switch (field.toLowerCase()) {
        case 'nominal':
            newValue = parseInt(value);
            if (isNaN(newValue)) {
                return sock.sendMessage(from, { text: '❌ Nominal harus angka' });
            }
            break;

        case 'nohp':
            newValue = validatePhone(value);
            if (newValue.length < 10) {
                return sock.sendMessage(from, { text: '❌ Nomor HP tidak valid' });
            }
            break;

        case 'status':
            if (!['pending', 'paid', 'process', 'completed', 'cancelled', 'refunded'].includes(value.toLowerCase())) {
                return sock.sendMessage(from, {
                    text: '❌ Status tidak valid. Gunakan: pending, paid, process, completed, cancelled, refunded'
                });
            }
            newValue = value.toLowerCase();
            break;
    }

    // Update order
    order[field] = newValue;
    order.updated_at = new Date().toISOString();

    // Add to history
    if (!order.history) order.history = [];
    order.history.push({
        action: 'edit',
        timestamp: order.updated_at,
        by: from,
        note: `${field}: ${oldValue} → ${newValue}`,
        details: { field, old_value: oldValue, new_value: newValue }
    });

    orders[orderId.toUpperCase()] = order;

    if (saveOrders(orders)) {
        return sock.sendMessage(from, {
            text: `✅ *ORDER DIPERBARUI*\n\n` +
                `🆔 \`${orderId}\`\n` +
                `👤 ${order.nama}\n` +
                `📝 *${field.toUpperCase()}:* ${oldValue} → ${newValue}\n` +
                `📅 Diupdate: ${formatDate(order.updated_at)}\n\n` +
                `Gunakan \`.order ${orderId}\` untuk melihat detail lengkap.`
        });
    } else {
        return sock.sendMessage(from, { text: '❌ Gagal menyimpan perubahan' });
    }
}

// CHANGE STATUS ONLY
async function changeStatus(sock, from, text, msg) {
    const check = checkOperator(sock, from, msg);
    if (!check.allowed) return sock.sendMessage(from, { text: check.message });

    const match = text.match(/\.status\s+(\w+)\|(\w+)/i);
    if (!match) {
        return sock.sendMessage(from, {
            text: 'Gunakan: `.status ID|status_baru`\n' +
                'Contoh: `.status ORDABC123|completed`\n' +
                'Status: pending, paid, process, completed, cancelled, refunded'
        });
    }

    const [, orderId, newStatus] = match;
    const validStatuses = ['pending', 'paid', 'process', 'completed', 'cancelled', 'refunded'];

    if (!validStatuses.includes(newStatus.toLowerCase())) {
        return sock.sendMessage(from, {
            text: `❌ Status "${newStatus}" tidak valid.\n` +
                `Status yang diperbolehkan: ${validStatuses.join(', ')}`
        });
    }

    const orders = loadOrders();
    const order = orders[orderId.toUpperCase()];

    if (!order) {
        return sock.sendMessage(from, {
            text: `❌ Order \`${orderId}\` tidak ditemukan.`
        });
    }

    const oldStatus = order.status;
    if (oldStatus === newStatus) {
        return sock.sendMessage(from, {
            text: `ℹ️ Order sudah berstatus "${newStatus}"`
        });
    }

    // Update order
    order.status = newStatus.toLowerCase();
    order.updated_at = new Date().toISOString();

    // Add to history
    if (!order.history) order.history = [];
    order.history.push({
        action: 'status_change',
        timestamp: order.updated_at,
        by: from,
        note: `${oldStatus} → ${newStatus}`,
        details: { old_status: oldStatus, new_status: newStatus }
    });

    orders[orderId.toUpperCase()] = order;

    if (saveOrders(orders)) {
        const statusIcons = {
            'pending': '⏳', 'paid': '💳', 'process': '🔄',
            'completed': '✅', 'cancelled': '❌', 'refunded': '💸'
        };

        const oldIcon = statusIcons[oldStatus] || '📝';
        const newIcon = statusIcons[newStatus] || '📝';

        return sock.sendMessage(from, {
            text: `🔄 *STATUS DIUBAH*\n\n` +
                `🆔 \`${orderId}\`\n` +
                `👤 ${order.nama}\n` +
                `💰 ${formatCurrency(order.nominal)}\n` +
                `📊 Status: ${oldIcon} ${oldStatus} → ${newIcon} *${newStatus}*\n` +
                `📅 Diupdate: ${formatDate(order.updated_at)}\n\n` +
                `Gunakan \`.order ${orderId}\` untuk melihat detail lengkap.`
        });
    } else {
        return sock.sendMessage(from, { text: '❌ Gagal mengubah status' });
    }
}

// DELETE ORDER COMMAND (rename karena bentrok)
async function deleteOrderCommand(sock, from, text, msg) {
    const check = checkOperator(sock, from, msg);
    if (!check.allowed) return sock.sendMessage(from, { text: check.message });

    const match = text.match(/\.delete\s+(\w+)/i);
    if (!match) {
        return sock.sendMessage(from, {
            text: 'Gunakan: `.delete ID`\nContoh: `.delete ORDABC123`'
        });
    }

    const orderId = match[1].toUpperCase();
    const orders = loadOrders();
    const order = orders[orderId];

    if (!order) {
        return sock.sendMessage(from, {
            text: `❌ Order \`${orderId}\` tidak ditemukan.`
        });
    }

    // Archive before deleting
    const archiveFile = path.join(BACKUP_DIR, `deleted_${orderId}_${Date.now()}.json`);
    fs.writeFileSync(archiveFile, JSON.stringify(order, null, 2));

    // Delete from active orders
    delete orders[orderId];

    if (saveOrders(orders)) {
        updateStats(order, 'remove');

        return sock.sendMessage(from, {
            text: `🗑️ *ORDER DIHAPUS*\n\n` +
                `🆔 \`${orderId}\`\n` +
                `👤 ${order.nama}\n` +
                `💰 ${formatCurrency(order.nominal)}\n` +
                `🏷️ ${order.produk || '-'}\n` +
                `📅 Dihapus: ${formatDate(new Date())}\n\n` +
                `📂 Data diarsipkan di: ${path.basename(archiveFile)}`
        });
    } else {
        return sock.sendMessage(from, { text: '❌ Gagal menghapus order' });
    }
}

// SHOW TOP PRODUCTS
async function showTopProducts(sock, from, msg) {
    const check = checkOperator(sock, from, msg);
    if (!check.allowed) return sock.sendMessage(from, { text: check.message });

    const stats = loadStats();
    const productStats = stats.product_stats || {};

    if (Object.keys(productStats).length === 0) {
        return sock.sendMessage(from, {
            text: '📭 Belum ada data produk'
        });
    }

    const sortedProducts = Object.entries(productStats)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    const orders = loadOrders();
    const productRevenue = {};

    // Calculate revenue per product
    Object.values(orders).forEach(order => {
        const product = order.produk || 'lainnya';
        productRevenue[product] = (productRevenue[product] || 0) + order.nominal;
    });

    const message = `
🏆 *PRODUK TERLARIS*

━━━━━━━━━━━━━━━━━━━━
${sortedProducts.map(([product, count], index) => {
        const emoji = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'][index] || '•';
        const revenue = productRevenue[product] || 0;
        const avg = revenue / count;
        return `${emoji} *${product}*\n` +
            `   📊 Order: ${count}\n` +
            `   💰 Revenue: ${formatCurrency(revenue)}\n` +
            `   📈 Rata-rata: ${formatCurrency(avg)}\n` +
            `   ─────────────────`;
    }).join('\n')}

━━━━━━━━━━━━━━━━━━━━
💡 *REKOMENDASI:*
${sortedProducts.length > 0 ?
            `1. Fokus promosi pada: *${sortedProducts[0][0]}*\n` +
            `2. Tingkatkan stok untuk: *${sortedProducts[1]?.[0] || sortedProducts[0][0]}*\n` +
            `3. Buat bundle dengan: *${sortedProducts[2]?.[0] || sortedProducts[0][0]}*`
            : 'Belum ada data yang cukup'}
    `.trim();

    return sock.sendMessage(from, { text: message });
}

// SIMPLE CHART (TEXT-BASED)
async function showChart(sock, from, msg) {
    const check = checkOperator(sock, from, msg);
    if (!check.allowed) return sock.sendMessage(from, { text: check.message });

    const stats = loadStats();
    const monthlyStats = stats.monthly_stats || {};

    if (Object.keys(monthlyStats).length === 0) {
        return sock.sendMessage(from, {
            text: '📭 Belum ada data untuk ditampilkan dalam chart'
        });
    }

    // Get last 6 months
    const months = Object.entries(monthlyStats)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(-6);

    if (months.length === 0) {
        return sock.sendMessage(from, { text: '📭 Tidak ada data bulanan' });
    }

    // Find max revenue for scaling
    const maxRevenue = Math.max(...months.map(([_, data]) => data.revenue || 0));
    const scale = maxRevenue > 0 ? 20 / maxRevenue : 1;

    let message = `📊 *CHART REVENUE 6 BULAN TERAKHIR*\n\n`;

    months.forEach(([month, data]) => {
        const [year, mon] = month.split('-');
        const monthName = new Date(`${year}-${mon}-01`).toLocaleDateString('id-ID', { month: 'short' });
        const barLength = Math.round((data.revenue || 0) * scale);
        const bar = '█'.repeat(Math.max(1, barLength));

        message += `${monthName} ${year} | ${bar} ${formatCurrency(data.revenue || 0)}\n`;
    });

    message += `\n📈 *KETERANGAN:*\n`;
    message += `• Setiap "█" ≈ ${formatCurrency(maxRevenue / 20)}\n`;
    message += `• Total periode: ${formatCurrency(months.reduce((sum, [_, data]) => sum + (data.revenue || 0), 0))}\n`;
    message += `• Rata-rata/bulan: ${formatCurrency(months.reduce((sum, [_, data]) => sum + (data.revenue || 0), 0) / months.length)}\n`;

    message += `\n💡 *TREND:*\n`;
    if (months.length >= 2) {
        const last = months[months.length - 1][1].revenue || 0;
        const secondLast = months[months.length - 2][1].revenue || 0;
        const trend = last > secondLast ? '📈 Naik' : last < secondLast ? '📉 Turun' : '➡️ Stabil';
        const percentage = secondLast > 0 ? ((last - secondLast) / secondLast * 100).toFixed(1) : 0;

        message += `${trend} ${percentage > 0 ? '+' : ''}${percentage}% dari bulan sebelumnya`;
    }

    return sock.sendMessage(from, { text: message });
}

// OWNER COMMANDS
async function showOwners(sock, from, msg) {
    const check = checkOwner(sock, from, msg);
    if (!check.allowed) return sock.sendMessage(from, { text: check.message });

    const owners = loadOwners();
    const ownerCount = owners.length;

    let message = `👑 *DAFTAR OWNER* (${ownerCount} orang)\n\n`;

    if (ownerCount === 0) {
        message += 'Belum ada owner yang terdaftar.\n';
        message += 'Tambahkan dengan: `.addowner 6281234567890`';
    } else {
        owners.forEach((owner, index) => {
            const formattedNumber = owner.startsWith('62') ?
                `+${owner}` : owner.startsWith('0') ?
                    `+62${owner.substring(1)}` : owner;
            message += `${index + 1}. ${formattedNumber}\n`;
        });
    }

    return sock.sendMessage(from, { text: message });
}

async function addOwner(sock, from, text, msg) {
    const check = checkOwner(sock, from, msg);
    if (!check.allowed) return sock.sendMessage(from, { text: check.message });

    const match = text.match(/\.addowner\s+(\d+)/i);
    if (!match) {
        return sock.sendMessage(from, {
            text: 'Format: `.addowner 6281234567890`\nContoh: `.addowner 6281234567890`'
        });
    }

    const newOwner = match[1].trim();
    let owners = loadOwners();

    // Format nomor (pastikan 62)
    let formattedOwner = newOwner;
    if (formattedOwner.startsWith('0')) {
        formattedOwner = '62' + formattedOwner.substring(1);
    } else if (!formattedOwner.startsWith('62')) {
        formattedOwner = '62' + formattedOwner;
    }

    // Cek jika sudah ada
    if (owners.includes(formattedOwner)) {
        return sock.sendMessage(from, {
            text: `ℹ️ Nomor ${formattedOwner} sudah terdaftar sebagai owner.`
        });
    }

    owners.push(formattedOwner);

    try {
        fs.writeFileSync(OWNERS_DB, JSON.stringify(owners, null, 2));
        return sock.sendMessage(from, {
            text: `✅ *OWNER DITAMBAHKAN!*\n\n` +
                `📱 Nomor: ${formattedOwner}\n` +
                `👥 Total owner: ${owners.length}`
        });
    } catch (e) {
        console.error('Error adding owner:', e);
        return sock.sendMessage(from, {
            text: `❌ Gagal menambahkan owner: ${e.message}`
        });
    }
}

// ===============================
// EKSPOR SEMUA FUNGSI
// ===============================
module.exports = {
    // Core functions
    isOwner,
    isOperator,
    checkOwner,
    checkOperator,

    // Database functions
    loadOrders,
    saveOrders,
    loadStats,
    saveStats,
    loadOperators,
    loadOwners,

    // Utility functions
    generateOrderId,
    formatCurrency,
    formatDate,
    validatePhone,
    updateStats,

    // Command functions
    showOperators,
    addOperator,
    deleteOperator,
    checkOperatorStatus,
    jualMenu,
    addOrder,
    viewOrders,
    viewOrder,
    markDone,
    searchOrders,
    todayOrders,
    pendingOrders,
    showStats,
    monthlyReport,
    exportData,
    systemCleanup,
    editOrder,
    changeStatus,
    deleteOrderCommand, // nama diubah
    showTopProducts,
    showChart,
    showOwners,
    addOwner
};