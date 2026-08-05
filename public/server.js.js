const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Database Setup
const dbFile = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbFile, (err) => {
    if (err) console.error('Database opening error: ', err.message);
    else console.log('Connected to SQLite database.');
});

// Initialize Tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        role TEXT DEFAULT 'vendor'
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_name TEXT,
        contact_number TEXT,
        email TEXT,
        category TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS submission_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        submission_id INTEGER,
        item_name TEXT,
        quantity REAL,
        unit_price REAL,
        total_price REAL,
        FOREIGN KEY(submission_id) REFERENCES submissions(id)
    )`);
    
    // Create default admin if not exists
    db.get(`SELECT * FROM users WHERE username = 'admin'`, (err, row) => {
        if (!row) {
            db.run(`INSERT INTO users (username, password, role) VALUES ('admin', 'admin123', 'admin')`);
        }
    });
});

// --- API Endpoints ---

// User Registration / Login Mock
app.post('/api/auth', (req, res) => {
    const { username, password, action } = req.body;
    if (action === 'register') {
        db.run(`INSERT INTO users (username, password, role) VALUES (?, ?, 'vendor')`, [username, password], function(err) {
            if (err) return res.status(400).json({ error: 'Username already exists' });
            res.json({ success: true, userId: this.lastID, role: 'vendor' });
        });
    } else {
        db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, [username, password], (err, user) => {
            if (err || !user) return res.status(401).json({ error: 'Invalid credentials' });
            res.json({ success: true, username: user.username, role: user.role });
        });
    }
});

// Submit Vendor Form & Items
app.post('/api/submissions', (req, res) => {
    const { store_name, contact_number, email, category, items } = req.body;
    
    db.run(`INSERT INTO submissions (store_name, contact_number, email, category) VALUES (?, ?, ?, ?)`,
        [store_name, contact_number, email, category], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            
            const submissionId = this.lastID;
            const stmt = db.prepare(`INSERT INTO submission_items (submission_id, item_name, quantity, unit_price, total_price) VALUES (?, ?, ?, ?, ?)`);
            
            items.forEach(item => {
                const total = item.quantity * item.unit_price;
                stmt.run(submissionId, item.item_name, item.quantity, item.unit_price, total);
            });
            stmt.finalize();
            
            res.json({ success: true, message: 'Submission saved successfully' });
        }
    );
});

// Admin Dashboard: Fetch Submissions & Analytics (Min/Max Pricing)
app.get('/api/admin/analytics', (req, res) => {
    db.all(`SELECT * FROM submissions ORDER BY created_at DESC`, [], (err, submissions) => {
        if (err) return res.status(500).json({ error: err.message });

        db.all(`
            si.item_name, si.unit_price, s.store_name 
            FROM submission_items si 
            JOIN submissions s ON si.submission_id = s.id
        `, [], (err, items) => {
            if (err) return res.status(500).json({ error: err.message });

            // Calculate Min and Max per item name across competitors
            const priceAnalysis = {};
            items.forEach(i => {
                const name = i.item_name.trim().toLowerCase();
                if (!priceAnalysis[name]) {
                    priceAnalysis[name] = { 
                        item_name: i.item_name, 
                        min_price: i.unit_price, 
                        min_store: i.store_name, 
                        max_price: i.unit_price, 
                        max_store: i.store_name 
                    };
                } else {
                    if (i.unit_price < priceAnalysis[name].min_price) {
                        priceAnalysis[name].min_price = i.unit_price;
                        priceAnalysis[name].min_store = i.store_name;
                    }
                    if (i.unit_price > priceAnalysis[name].max_price) {
                        priceAnalysis[name].max_price = i.unit_price;
                        priceAnalysis[name].max_store = i.store_name;
                    }
                }
            });

            res.json({
                submissions,
                analytics: Object.values(priceAnalysis)
            });
        });
    });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));