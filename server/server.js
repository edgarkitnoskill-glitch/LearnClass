const express = require("express");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

// ===============================
// PostgreSQL
// ===============================

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : false
});

// Datenbank testen
pool.connect()
    .then(client => {
        console.log("PostgreSQL verbunden!");
        client.release();
    })
    .catch(err => {
        console.error("PostgreSQL-Verbindung fehlgeschlagen:", err);
    });


// ===============================
// Express
// ===============================

app.use(express.json());
app.use(express.static(path.join(__dirname, "..")));


// ===============================
// Tabellen erstellen
// ===============================

async function createTables() {
    try {

        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS classes (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                code TEXT UNIQUE NOT NULL,
                owner_email TEXT NOT NULL
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS class_members (
                id SERIAL PRIMARY KEY,
                class_id INTEGER NOT NULL,
                email TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'Schüler',
                UNIQUE(class_id, email)
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS exercises (
                id SERIAL PRIMARY KEY,
                class_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                created_by TEXT NOT NULL
            )
        `);

        console.log("Datenbanktabellen sind bereit!");

    } catch (error) {
        console.error("Fehler beim Erstellen der Tabellen:", error);
    }
}

createTables();


// ===============================
// Startseite
// ===============================

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "..", "index.html"));
});


// ===============================
// Registrierung
// ===============================

app.post("/register", async (req, res) => {

    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({
            message: "E-Mail und Passwort erforderlich!"
        });
    }

    if (password.length < 8) {
        return res.status(400).json({
            message: "Passwort muss mindestens 8 Zeichen haben!"
        });
    }

    try {

        const hash = await bcrypt.hash(password, 12);

        await pool.query(
            `
            INSERT INTO users (email, password)
            VALUES ($1, $2)
            `,
            [email, hash]
        );

        res.json({
            message: "Konto erfolgreich erstellt!"
        });

    } catch (error) {

        console.error(error);

        if (error.code === "23505") {
            return res.status(400).json({
                message: "E-Mail ist bereits registriert!"
            });
        }

        res.status(500).json({
            message: "Serverfehler!"
        });
    }
});


// ===============================
// Login
// ===============================

app.post("/login", async (req, res) => {

    const { email, password } = req.body;

    try {

        const result = await pool.query(
            `
            SELECT *
            FROM users
            WHERE email = $1
            `,
            [email]
        );

        const user = result.rows[0];

        if (!user) {
            return res.status(401).json({
                message: "E-Mail oder Passwort falsch!"
            });
        }

        const richtig = await bcrypt.compare(
            password,
            user.password
        );

        if (!richtig) {
            return res.status(401).json({
                message: "E-Mail oder Passwort falsch!"
            });
        }

        res.json({
            message: "Login erfolgreich!",
            email: user.email
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: "Datenbankfehler!"
        });
    }
});


// ===============================
// Klassencode
// ===============================

function erstelleKlassencode() {

    return crypto
        .randomBytes(4)
        .toString("hex")
        .toUpperCase()
        .substring(0, 6);
}


// ===============================
// Klasse erstellen
// ===============================

app.post("/classes/create", async (req, res) => {

    const { name, email } = req.body;

    if (!name || !email) {
        return res.status(400).json({
            message: "Klassenname und E-Mail erforderlich!"
        });
    }

    try {

        let code;

        // Sicherstellen, dass der Klassencode einzigartig ist
        while (true) {

            code = erstelleKlassencode();

            const check = await pool.query(
                `
                SELECT id
                FROM classes
                WHERE code = $1
                `,
                [code]
            );

            if (check.rows.length === 0) {
                break;
            }
        }

        const result = await pool.query(
            `
            INSERT INTO classes
            (name, code, owner_email)
            VALUES ($1, $2, $3)
            RETURNING id
            `,
            [name, code, email]
        );

        const classId = result.rows[0].id;

        await pool.query(
            `
            INSERT INTO class_members
            (class_id, email, role)
            VALUES ($1, $2, $3)
            ON CONFLICT (class_id, email) DO NOTHING
            `,
            [classId, email, "Besitzer"]
        );

        res.json({
            message: "Klasse erfolgreich erstellt!",
            class: {
                id: classId,
                name: name,
                code: code,
                role: "Besitzer"
            }
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: "Klasse konnte nicht erstellt werden!"
        });
    }
});


// ===============================
// Klasse beitreten
// ===============================

app.post("/classes/join", async (req, res) => {

    const { code, email } = req.body;

    try {

        const result = await pool.query(
            `
            SELECT *
            FROM classes
            WHERE code = $1
            `,
            [code.trim().toUpperCase()]
        );

        const klasse = result.rows[0];

        if (!klasse) {
            return res.status(404).json({
                message: "Klasse nicht gefunden!"
            });
        }

        await pool.query(
            `
            INSERT INTO class_members
            (class_id, email, role)
            VALUES ($1, $2, $3)
            ON CONFLICT (class_id, email) DO NOTHING
            `,
            [klasse.id, email, "Schüler"]
        );

        res.json({
            message: "Klasse erfolgreich beigetreten!",
            class: klasse
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: "Beitreten nicht möglich!"
        });
    }
});


// ===============================
// Klassen eines Accounts laden
// ===============================

app.get("/classes/by-email/:email", async (req, res) => {

    const email = req.params.email;

    try {

        const result = await pool.query(
            `
            SELECT DISTINCT
                classes.id,
                classes.name,
                classes.code,
                COALESCE(class_members.role, 'Besitzer') AS role
            FROM classes
            LEFT JOIN class_members
                ON classes.id = class_members.class_id
            WHERE classes.owner_email = $1
               OR class_members.email = $2
            ORDER BY classes.id DESC
            `,
            [email, email]
        );

        res.json(result.rows);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: "Klassen konnten nicht geladen werden!"
        });
    }
});


// ===============================
// Mitglieder laden
// ===============================

app.get("/classes/:id/members", async (req, res) => {

    const classId = req.params.id;

    try {

        const result = await pool.query(
            `
            SELECT email, role
            FROM class_members
            WHERE class_id = $1
            `,
            [classId]
        );

        res.json(result.rows);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: "Mitglieder konnten nicht geladen werden!"
        });
    }
});


// ===============================
// Einzelne Klasse laden
// ===============================

app.get("/classes/:id", async (req, res) => {

    const classId = req.params.id;
    const email = req.query.email;

    try {

        const result = await pool.query(
            `
            SELECT
                classes.id,
                classes.name,
                classes.code,
                class_members.role
            FROM classes
            INNER JOIN class_members
                ON classes.id = class_members.class_id
            WHERE classes.id = $1
              AND class_members.email = $2
            `,
            [classId, email]
        );

        const klasse = result.rows[0];

        if (!klasse) {
            return res.status(403).json({
                message: "Du bist kein Mitglied dieser Klasse!"
            });
        }

        res.json(klasse);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: "Datenbankfehler!"
        });
    }
});


// ===============================
// Übungen laden
// ===============================

app.get("/classes/:id/exercises", async (req, res) => {

    const classId = req.params.id;

    try {

        const result = await pool.query(
            `
            SELECT
                id,
                title,
                description,
                created_by
            FROM exercises
            WHERE class_id = $1
            ORDER BY id DESC
            `,
            [classId]
        );

        res.json(result.rows);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: "Übungen konnten nicht geladen werden!"
        });
    }
});


// ===============================
// Übung erstellen
// ===============================

app.post("/classes/:id/exercises", async (req, res) => {

    const classId = req.params.id;
    const { title, description, email } = req.body;

    if (!title || !email) {
        return res.status(400).json({
            message: "Titel und E-Mail erforderlich!"
        });
    }

    try {

        const memberResult = await pool.query(
            `
            SELECT role
            FROM class_members
            WHERE class_id = $1
              AND email = $2
            `,
            [classId, email]
        );

        const member = memberResult.rows[0];

        if (
            !member ||
            (member.role !== "Besitzer" &&
             member.role !== "Lehrer")
        ) {
            return res.status(403).json({
                message: "Du hast keine Berechtigung!"
            });
        }

        const result = await pool.query(
            `
            INSERT INTO exercises
            (class_id, title, description, created_by)
            VALUES ($1, $2, $3, $4)
            RETURNING id
            `,
            [
                classId,
                title,
                description || "",
                email
            ]
        );

        res.json({
            message: "Übung erfolgreich erstellt!",
            id: result.rows[0].id
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: "Übung konnte nicht erstellt werden!"
        });
    }
});


// ===============================
// Rolle eines Mitglieds ändern
// ===============================

app.put("/classes/:id/members/role", async (req, res) => {

    const classId = req.params.id;

    const {
        ownerEmail,
        memberEmail,
        role
    } = req.body;

    if (!ownerEmail || !memberEmail || !role) {
        return res.status(400).json({
            message: "Angaben fehlen!"
        });
    }

    if (!["Schüler", "Lehrer"].includes(role)) {
        return res.status(400).json({
            message: "Ungültige Rolle!"
        });
    }

    try {

        const ownerResult = await pool.query(
            `
            SELECT role
            FROM class_members
            WHERE class_id = $1
              AND email = $2
            `,
            [classId, ownerEmail]
        );

        const owner = ownerResult.rows[0];

        if (!owner || owner.role !== "Besitzer") {
            return res.status(403).json({
                message: "Nur der Besitzer darf Rollen ändern!"
            });
        }

        await pool.query(
            `
            UPDATE class_members
            SET role = $1
            WHERE class_id = $2
              AND email = $3
            `,
            [role, classId, memberEmail]
        );

        res.json({
            message: "Rolle geändert!"
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: "Rolle konnte nicht geändert werden!"
        });
    }
});


// ===============================
// Mitglied entfernen
// ===============================

app.delete("/classes/:id/members/:email", async (req, res) => {

    const classId = req.params.id;
    const memberEmail = req.params.email;
    const ownerEmail = req.query.ownerEmail;

    try {

        const ownerResult = await pool.query(
            `
            SELECT role
            FROM class_members
            WHERE class_id = $1
              AND email = $2
            `,
            [classId, ownerEmail]
        );

        const owner = ownerResult.rows[0];

        if (!owner || owner.role !== "Besitzer") {
            return res.status(403).json({
                message: "Nur der Besitzer darf Mitglieder entfernen!"
            });
        }

        await pool.query(
            `
            DELETE FROM class_members
            WHERE class_id = $1
              AND email = $2
            `,
            [classId, memberEmail]
        );

        res.json({
            message: "Mitglied entfernt!"
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: "Mitglied konnte nicht entfernt werden!"
        });
    }
});


// ===============================
// Server starten
// ===============================

app.listen(PORT, () => {
    console.log(
        `LearnClass läuft auf Port ${PORT}`
    );
});
