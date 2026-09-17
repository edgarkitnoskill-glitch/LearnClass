const express = require("express");
const path = require("path");
const bcrypt = require("bcrypt");
const sqlite3 = require("sqlite3").verbose();

const app = express();

// Datenbank öffnen
const db = new sqlite3.Database("./learnclass.db");

// Tabelle für Benutzer erstellen
db.run(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
    )
`);

app.use(express.json());

// Website bereitstellen
app.use(express.static(path.join(__dirname, "..")));

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

        const hashedPassword =
            await bcrypt.hash(password, 12);

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


            const richtig =
                await bcrypt.compare(
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

// Server starten
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`LearnClass läuft auf Port ${PORT}`);
});
