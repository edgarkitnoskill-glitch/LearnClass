const express = require("express");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const sqlite3 = require("sqlite3").verbose();

const app = express();

const PORT = process.env.PORT || 3000;

// Datenbank öffnen
const db = new sqlite3.Database(
    path.join(__dirname, "learnclass.db")
);

app.use(express.json());

// Website bereitstellen
app.use(express.static(path.join(__dirname, "..")));

// Tabellen erstellen
db.serialize(() => {

    // Benutzer
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL
        )
    `);

    // Klassen
    db.run(`
        CREATE TABLE IF NOT EXISTS classes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            code TEXT UNIQUE NOT NULL,
            owner_email TEXT NOT NULL
        )
    `);

    // Mitglieder einer Klasse
    db.run(`
        CREATE TABLE IF NOT EXISTS class_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            class_id INTEGER NOT NULL,
            email TEXT NOT NULL,
            UNIQUE(class_id, email)
        )
    `);

});

// Startseite
app.get("/", (req, res) => {
    res.sendFile(
        path.join(__dirname, "..", "index.html")
    );
});

// Registrierung
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

        const hashedPassword = await bcrypt.hash(password, 12);

        db.run(
            "INSERT INTO users (email, password) VALUES (?, ?)",
            [email, hashedPassword],
            function(err) {

                if (err) {
                    return res.status(400).json({
                        message: "E-Mail ist bereits registriert!"
                    });
                }

                res.json({
                    message: "Konto erfolgreich erstellt! 🎓"
                });

            }
        );

    } catch (error) {

        res.status(500).json({
            message: "Serverfehler!"
        });

    }

});

// Login
app.post("/login", (req, res) => {

    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({
            message: "E-Mail und Passwort erforderlich!"
        });
    }

    db.get(
        "SELECT * FROM users WHERE email = ?",
        [email],
        async (err, user) => {

            if (err) {
                return res.status(500).json({
                    message: "Datenbankfehler!"
                });
            }

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

        }
    );

});

// Zufälligen Klassencode erstellen
function erstelleKlassencode() {
    return crypto
        .randomBytes(4)
        .toString("hex")
        .toUpperCase()
        .substring(0, 6);
}

// Klasse erstellen
app.post("/classes/create", (req, res) => {

    const { name, email } = req.body;

    if (!name || !email) {
        return res.status(400).json({
            message: "Klassenname und Account erforderlich!"
        });
    }

    const code = erstelleKlassencode();

    db.run(
        `
        INSERT INTO classes (name, code, owner_email)
        VALUES (?, ?, ?)
        `,
        [name, code, email],
        function(err) {

            if (err) {
                return res.status(500).json({
                    message: "Klasse konnte nicht erstellt werden!"
                });
            }

            const classId = this.lastID;

            // Ersteller direkt als Mitglied eintragen
            db.run(
                `
                INSERT OR IGNORE INTO class_members
                (class_id, email)
                VALUES (?, ?)
                `,
                [classId, email],
                () => {

                    res.json({
                        message: "Klasse erfolgreich erstellt! 🎓",
                        class: {
                            id: classId,
                            name: name,
                            code: code
                        }
                    });

                }
            );

        }
    );

});

// Klasse mit Code beitreten
app.post("/classes/join", (req, res) => {

    const { code, email } = req.body;

    if (!code || !email) {
        return res.status(400).json({
            message: "Klassencode und Account erforderlich!"
        });
    }

    db.get(
        "SELECT * FROM classes WHERE code = ?",
        [code.toUpperCase()],
        (err, klasse) => {

            if (err) {
                return res.status(500).json({
                    message: "Datenbankfehler!"
                });
            }

            if (!klasse) {
                return res.status(404).json({
                    message: "Diese Klasse wurde nicht gefunden!"
                });
            }

            db.run(
                `
                INSERT OR IGNORE INTO class_members
                (class_id, email)
                VALUES (?, ?)
                `,
                [klasse.id, email],
                (joinErr) => {

                    if (joinErr) {
                        return res.status(500).json({
                            message: "Beitreten nicht möglich!"
                        });
                    }

                    res.json({
                        message: "Du bist der Klasse beigetreten! 🎉",
                        class: {
                            id: klasse.id,
                            name: klasse.name,
                            code: klasse.code
                        }
                    });

                }
            );

        }
    );

});

// Klassen eines Accounts anzeigen
app.get("/classes/:email", (req, res) => {

    const email = req.params.email;

    db.all(
        `
        SELECT classes.id, classes.name, classes.code
        FROM classes
        INNER JOIN class_members
        ON classes.id = class_members.class_id
        WHERE class_members.email = ?
        `,
        [email],
        (err, classes) => {

            if (err) {
                return res.status(500).json({
                    message: "Klassen konnten nicht geladen werden!"
                });
            }

            res.json(classes);

        }
    );

});

// Server starten
app.listen(PORT, () => {

    console.log(
        `LearnClass läuft auf Port ${PORT}`
    );

});
