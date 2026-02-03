import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import bcrypt from "bcrypt";
import passport from "passport";
import { Strategy } from "passport-local";
import GoogleStrategy from "passport-google-oauth2";
import session from "express-session";
import env from "dotenv";
import sanitizeHtml from "sanitize-html";

env.config();

// const app = express();
// const port = 3000;
const saltRounds = 10;

// No need to use a different db object again, as different tables can be used from the same database
export const db = new pg.Client({
  user: process.env.SQL_USER,
  host: process.env.SQL_HOST,
  database: process.env.SQL_DATABASE,
  password: process.env.SQL_PASSWORD,
  port: process.env.SQL_PORT,
  pool_mode: process.env.SQL_MODE,
});

try {
  await db.connect();
} catch (err) {
  console.error(err);
}

const router = express.Router();
export default router;

router.get("/home", (req, res) => {
  res.render("users/home.ejs");
});

router.get("/login", (req, res) => {
  res.render("users/login.ejs");
});

router.get("/register", (req, res) => {
  // console.log("/users/register link was accessed.");
  res.render("users/register.ejs");
});

router.get("/logout", (req, res) => {
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    res.redirect("/users/home");
  });
});

// The callback function needs to list the permissions to be asked from the user
router.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
  }),
);

// This is for google authenticated users specifically
router.get(
  "/auth/google/callbackuri",
  passport.authenticate("google", {
    successRedirect: "/yourcollection",
    failureRedirect: "login",
  }),
);

router.post(
  "/login",
  passport.authenticate("local", {
    // This needs to be an absolute path
    successRedirect: "../yourcollection",
    // This needs to be a relative path
    failureRedirect: "login",
  }),
);

// Registration is only applicable for local password
router.post("/register", async (req, res, next) => {
  const email = sanitizeHtml(req.body.username);
  const password = sanitizeHtml(req.body.password);

  try {
    // No need to register if an email is found, but need to ask users to link gmail oauth if no password found
    const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
    // Case 1: An email (user) - and corresponding linked data in database was found
    if (checkResult.rows.length > 0) {
      // Case 1a: A password entry was found
      if (checkResult.rows[0].password) {
        passport.authenticate("local", (err, user, info) => {
          if (err) {
            return next(err);
          }
          if (!user) {
            return res.redirect("login");
          }
          req.logIn(user, (err) => {
            if (err) {
              return next(err);
            }
            return res.redirect("../yourcollection");
          });
        })(req, res, next);
      }
      // Case 1b: Only a google oauth verification was found
      else if (checkResult.rows[0].gmail_verified == true) {
        // Adding a new password entry to the existing email row entry
        bcrypt.hash(password, saltRounds, async (err, hash) => {
          if (err) {
            console.error("Error hashing password:", err);
          } else {
            const result = await db.query(
              "UPDATE users SET password = $1 WHERE email = $2 RETURNING *",
              [hash, email],
            );
            const user = result.rows[0];
            req.login(user, (err) => {
              console.log(
                "successfully added a password to the existing gmail oauth entry",
              );
              res.redirect("/yourcollection");
            });
          }
        });
      }
    }
    // Case 2: An email (user) data entry was not found in the database
    else {
      bcrypt.hash(password, saltRounds, async (err, hash) => {
        if (err) {
          console.error("Error hashing password:", err);
        } else {
          const result = await db.query(
            "INSERT INTO users (email, password) VALUES ($1, $2) RETURNING *",
            [email, hash],
          );
          const user = result.rows[0];
          req.login(user, (err) => {
            console.log("success");
            res.redirect("/yourcollection");
          });
        }
      });
    }
  } catch (err) {
    console.log(err);
  }
});

//TODO: Create the post route for submit.
//Handle the submitted data and add it to the database

export function setuppassport() {
  passport.use(
    "local",
    new Strategy(async function verify(username, password, cb) {
      try {
        //  We need to SELECT from SQL just to check if an email entry exist in the database
        const result = await db.query(
          "SELECT * FROM users WHERE (email = $1)",
          [username],
        );
        // Case 1: An email entry exists
        if (result.rows.length > 0) {
          //  Case 1a: A local hashed password entry exists for the email entry
          if (result.rows[0].password && result.rows[0].password !== "google") {
            const user = result.rows[0];
            const storedHashedPassword = user.password;
            bcrypt.compare(password, storedHashedPassword, (err, valid) => {
              if (err) {
                console.error("Error comparing passwords:", err);
                return cb(err);
              } else {
                if (valid) {
                  return cb(null, user);
                } else {
                  return cb(null, false);
                }
              }
            });
          }
          // Case 1b: Only a google oauth entry exists for the email entry
          else {
            return cb("Please click on Sign In With Google");
          }
        }
        // Case 2: An email entry was not found
        else {
          return cb("User not found");
        }
      } catch (err) {
        console.log(err);
      }
    }),
  );

  passport.use(
    "google",
    new GoogleStrategy(
      // Need to include the client id and secret in .env. Also need to register and set up our app with google.
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL,
        userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo",
      },
      async (accessToken, refreshToken, profile, cb) => {
        try {
          // console.log(profile);
          const result = await db.query(
            "SELECT * FROM users WHERE (email = $1)",
            [profile.email],
          );
          // Case 1: No email (user) entry was found in the database
          if (result.rows.length === 0) {
            // If not user entry is found, it is created immediately (and set "g" value)
            const newUser = await db.query(
              "INSERT INTO users (email, gmail_verified, password) VALUES ($1, $2, $3) RETURNING *",
              [profile.email, true, "google"],
            );
            return cb(null, newUser.rows[0]);
          }
          // Case 2: An email (user) entry was found in the database
          else {
            // Case 2a: Google verified entry was true in the email entry
            if (result.rows[0].gmail_verified == true) {
              return cb(null, result.rows[0]);
            }
            // Case 2b: Google verified entry was false in the email entry and is set to true
            else if (result.rows[0].gmail_verified == false) {
              const updatedUser = await db.query(
                "UPDATE users SET gmail_verified = $1 WHERE email= $2 RETURNING *",
                [true, profile.email],
              );
              return cb(null, updatedUser.rows[0]);
            }
          }
        } catch (err) {
          return cb(err);
        }
      },
    ),
  );

  // The whole user information will be attached to req.user from below, instead of user.id
  passport.serializeUser((user, cb) => {
    cb(null, user);
  });

  passport.deserializeUser((user, cb) => {
    cb(null, user);
  });
}
