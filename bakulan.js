    // ===============================
    // SCHEDULER PENGINGAT ORDER BELUM SELESAI
    // ===============================
    startOrderReminderScheduler(sock) {
        const MS = 60 * 1000; // cek tiap 1 menit
        setInterval(() => {
            const orders = loadOrders();
            const now = new Date();
            for (const o of Object.values(orders)) {
                if (o.status !== 'belum' || !o.timestamp) continue;
                // Parse waktu order
                let orderDate = null;
                try {
                    // Format: "10/12/2025, 14.30"
                    const [tgl, jam] = o.timestamp.split(',');
                    const [d, m, y] = tgl.trim().split('/');
                    const [h, min] = jam.trim().split('.');
                    orderDate = new Date(`${y}-${m}-${d}T${h.padStart(2,'0')}:${min.padStart(2,'0')}:00+07:00`);
                } catch (e) { continue; }
                if (!orderDate) continue;
                const msSinceOrder = now - orderDate;
                const ms1d = 24*60*60*1000, ms12h = 12*60*60*1000, ms6h = 6*60*60*1000, ms1h = 60*60*1000, ms30m = 30*60*1000;
                const flags = o.reminderFlags || { d1:false, h12:false, h6:false, h1:false, m30:false };
                // -1 hari (23-24 jam)
                if (!flags.d1 && msSinceOrder >= ms1d - ms1h && msSinceOrder < ms1d) {
                    sock.sendMessage(sock.user.id, { text: `⏰ Order *${o.nama}* (ID: ${o.id}) belum selesai > 1 hari!` });
                    flags.d1 = true;
                }
                // 12 jam
                if (!flags.h12 && msSinceOrder >= ms12h && msSinceOrder < ms12h + MS) {
                    sock.sendMessage(sock.user.id, { text: `⏰ Order *${o.nama}* (ID: ${o.id}) belum selesai > 12 jam!` });
                    flags.h12 = true;
                }
                // 6 jam
                if (!flags.h6 && msSinceOrder >= ms6h && msSinceOrder < ms6h + MS) {
                    sock.sendMessage(sock.user.id, { text: `⏰ Order *${o.nama}* (ID: ${o.id}) belum selesai > 6 jam!` });
                    flags.h6 = true;
                }
                // 1 jam
                if (!flags.h1 && msSinceOrder >= ms1h && msSinceOrder < ms1h + MS) {
                    sock.sendMessage(sock.user.id, { text: `⏰ Order *${o.nama}* (ID: ${o.id}) belum selesai > 1 jam!` });
                    flags.h1 = true;
                }
                // 30 menit
                if (!flags.m30 && msSinceOrder >= ms30m && msSinceOrder < ms30m + MS) {
                    sock.sendMessage(sock.user.id, { text: `⏰ Order *${o.nama}* (ID: ${o.id}) belum selesai > 30 menit!` });
                    flags.m30 = true;
                }
                o.reminderFlags = flags;
            }
            saveOrders(orders);
        }, MS);
    },
// =============================
//  BAKULAN SYSTEM (Order Manager) — versi PIPE |
// =============================

const fs = require('fs');
const path = require('path');

const ORDERS_DB = path.join(__dirname, 'data', 'orders.json');

// Ensure folder exists
try {
    const dir = path.join(__dirname, 'data');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
} catch (e) {
    console.log("Gagal membuat folder data:", e.message);
}

// Load Orders
const loadOrders = () => {
    try {
        if (!fs.existsSync(ORDERS_DB)) return {};
        return JSON.parse(fs.readFileSync(ORDERS_DB, 'utf8'));
    } catch {
        return {}; // auto repair kalau file corrupt
    }
};

// Save Orders
const saveOrders = (data) => {
    fs.writeFileSync(ORDERS_DB, JSON.stringify(data, null, 2), 'utf8');
};

// Generate unique ID
const generateOrderId = (nama = "usr") => {
    const clean = String(nama || "usr").replace(/[^a-zA-Z]/g, "").toLowerCase();
    const prefix = clean.slice(0, 3) || "usr";
    const random = Math.floor(100 + Math.random() * 900);
    return prefix + random;
};

// Timestamp
const nowTime = () => {
    const n = new Date();
    return n.toLocaleString("id-ID", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });
};

module.exports = {

    // ===============================
    // MENU JUALAN (PAKE PIPE)
    // ===============================
    async jualMenu(sock, from) {
        const menu =
`📦 *MENU SISTEM ORDER (PEMBAGI |)*

• .ordermasuk|nana|nominal|metode|nohp|catatan
  ➜ Input order baru

• .cekorder
  ➜ Lihat semua order

• .done|nana
  ➜ Tandai order selesai (semua order dengan nama tsb)

• .editorder|ID|field|value
  ➜ Edit field tertentu

• .hapusorder|ID
  ➜ Hapus order

• .refund|ID
  ➜ Tandai sebagai refund

• .rekapbulan|YYYY-MM
  ➜ Rekap pemasukan bulanan (contoh: .rekapbulan|2025-12)`;

        return sock.sendMessage(from, { text: menu });
    },

    // ===============================
    // ADD ORDER (PAKE PIPE)
    // ===============================
    async addOrder(sock, from, text) {
        const p = text.split("|").map(x => x.trim());

        if (p.length < 6) {
            return sock.sendMessage(from, { 
                text: "Format: .ordermasuk|nama|nominal|metode|nohp|catatan"
            });
        }

        const nama = p[1];
        const nominal = Number(p[2]);
        const metode = p[3];
        const nohp = p[4].replace(/[^0-9]/g, "");
        const last4 = nohp.slice(-4);
        const catatan = p[5] || "-";

        if (!nama || isNaN(nominal) || nominal <= 0) {
            return sock.sendMessage(from, { text: "Nama tidak boleh kosong dan nominal harus angka valid." });
        }

        const orders = loadOrders();
        const id = generateOrderId(nama);

        orders[id] = {
            id,
            nama,
            nominal,
            metode,
            nohp,
            last4,
            catatan,
            status: "belum",
            timestamp: nowTime()
        };

        saveOrders(orders);

        return sock.sendMessage(from, {
            text:
`🟢 ORDER MASUK!  
ID: ${id}
Nama: ${nama}
Nominal: Rp${nominal.toLocaleString('id-ID')}
Metode: ${metode}
HP Akhir: ${last4}
Catatan: ${catatan}
Status: belum
Tanggal: ${orders[id].timestamp}`
        });
    },

    // ===============================
    // CEK ORDER
    // ===============================
    async cekOrder(sock, from) {
        const orders = loadOrders();
            const belum = Object.values(orders).filter(o => o.status === 'belum');
            if (belum.length === 0)
                return sock.sendMessage(from, { text: "Tidak ada order yang belum selesai." });

            let out = "📦 *ORDER BELUM SELESAI*\n\n";

            for (const o of belum) {
            out += 
`ID: ${o.id}
Nama: ${o.nama}
Nominal: Rp${o.nominal.toLocaleString('id-ID')}
Metode: ${o.metode}
HP: ****${o.last4}
Status: ${o.status}
Tanggal: ${o.timestamp}
Catatan: ${o.catatan}
`;
        }

        return sock.sendMessage(from, { text: out });
    },

    // ===============================
    // DONE ORDER (by nama)
    // ===============================
    async markDone(sock, from, text) {
        const p = text.split("|");
        if (p.length < 2) return sock.sendMessage(from, { text: "Format: .done|ID" });

        const id = p[1].trim();
        const orders = loadOrders();

        if (!orders[id]) {
            return sock.sendMessage(from, { text: `ID "${id}" tidak ditemukan.` });
        }
        orders[id].status = "selesai";
        saveOrders(orders);
        return sock.sendMessage(from, { text: `✨ Order dengan ID *${id}* ditandai SELESAI` });
    },

    // ===============================
    // EDIT ORDER (PAKE PIPE)
    // ===============================
    async editOrder(sock, from, text) {
        const p = text.split("|").map(x => x.trim());

        if (p.length < 4)
            return sock.sendMessage(from, { text: "Format: .editorder|ID|field|value" });

        const id = p[1];
        const field = p[2].toLowerCase();
        let value = p.slice(3).join("|"); // agar value bisa mengandung pipe |

        const orders = loadOrders();
        if (!orders[id])
            return sock.sendMessage(from, { text: `ID ${id} tidak ditemukan.` });

        if (field === "nominal") value = Number(value);
        if (field === "nohp") {
            value = value.replace(/[^0-9]/g, "");
            orders[id].last4 = value.slice(-4);
        }

        if (field in orders[id]) {
            orders[id][field] = value;
            saveOrders(orders);
            return sock.sendMessage(from, { text: `✔ Order ${id} berhasil diperbarui (${field} → ${value})` });
        } else {
            return sock.sendMessage(from, { text: `Field ${field} tidak valid.` });
        }
    },

    // ===============================
    // DELETE ORDER
    // ===============================
    async deleteOrder(sock, from, text) {
        const p = text.split("|");
        if (p.length < 2)
            return sock.sendMessage(from, { text: "Format: .hapusorder|ID" });

        const id = p[1];
        const orders = loadOrders();

        if (!orders[id])
            return sock.sendMessage(from, { text: `ID ${id} tidak ditemukan.` });

        delete orders[id];
        saveOrders(orders);

        return sock.sendMessage(from, { text: `🗑 Order ${id} dihapus.` });
    },

    // ===============================
    // REFUND ORDER
    // ===============================
    async refundOrder(sock, from, text) {
        const p = text.split("|");
        if (p.length < 2)
            return sock.sendMessage(from, { text: "Format: .refund|ID" });

        const id = p[1];
        const orders = loadOrders();

        if (!orders[id])
            return sock.sendMessage(from, { text: `ID ${id} tidak ditemukan.` });

        orders[id].status = "refund";
        saveOrders(orders);

        return sock.sendMessage(from, { text: `💸 Order ${id} ditandai REFUND.` });
    },

    // ===============================
    // REKAP BULANAN (PAKE PIPE)
    // ===============================
    async rekap(sock, from, text) {
        const p = text.split("|");
        if (p.length < 2)
            return sock.sendMessage(from, { text: "Format: .rekap|YYYY-MM (contoh: .rekap|2025-12)" });

        const periode = p[1].trim();
        const match = periode.match(/^(\d{4})-(\d{2})$/);
        if (!match)
            return sock.sendMessage(from, { text: "Format salah! Gunakan YYYY-MM, contoh: 2025-12" });

        const [, yr, mn] = match;

        const orders = loadOrders();
        let total = 0;
        let detail = "";
        let count = 0;

        for (const o of Object.values(orders)) {
            try {
                const datePart = o.timestamp.split(",")[0].trim(); // "10/12/2025"
                const [d, m, y] = datePart.split("/");

                const orderMonth = m.padStart(2, "0");
                const orderYear = y;

                if (orderYear === yr && orderMonth === mn) {
                    if (o.status !== "refund") {
                        total += o.nominal;
                    }
                    detail += `• ${o.nama} – Rp${o.nominal.toLocaleString('id-ID')} (${o.status})\n`;
                    count++;
                }
            } catch (e) {
                continue;
            }
        }

        const teksTotal = total > 0 ? `Rp${total.toLocaleString('id-ID')}` : "0";

        return sock.sendMessage(from, {
            text: `📊 *REKAP BULAN ${mn}/${yr}*

Total pemasukan: *${teksTotal}* (${count} transaksi)

Detail:
${detail || "Tidak ada transaksi pada periode ini."}`
        });
    },
};
