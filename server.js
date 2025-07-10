import express from 'express';
import pg from 'pg';
import ejs from 'ejs';
import axios from 'axios';
import sanitizeHtml from 'sanitize-html';
import env from "dotenv";

import userRouter, {db, setuppassport} from "./users.js";
import bodyParser from "body-parser";

import bcrypt from "bcrypt";
import passport from "passport";
import { Strategy } from "passport-local";
import GoogleStrategy from "passport-google-oauth2";
import session from "express-session";


const app = express();
const port = 3000;
env.config();

app.use(express.static("public"));
app.use(express.urlencoded({extended: true}));


// All incoming request will now be checked for a session cookie with a session id.
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
  })
);

app.use(passport.initialize());
app.use(passport.session());

setuppassport();

// Uses all the routes imported from ./users.js. The external modules involved will be automatically used internally as required.

app.use("/users", userRouter);


// Normal database logic for logged in users
// The home page should be directed to home.ejs, if not authenticated and to 
app.get("/", async (req, res) => {
    if (req.isAuthenticated()) {
        res.redirect("/yourcollection");
    } else {
        res.redirect("/users/home");
    }
});

app.get("/yourcollection", async (req, res) => {
    // populate with existing information from the database
    if(req.isAuthenticated()) {
        var loggedinemail = req.user.email;
        // console.log("The loggedinemail returned from the server is: ", loggedinemail);
        var dbquery;
        var dbsortord;
        const sortval = req.query.sorted || "";
        const sortorder = req.query.sortord || "";

       console.log("sortorder received is: ", sortorder);

        switch (sortorder) {
        case "ascending":
        dbsortord = "ASC";
        break;

        case "descending":
        dbsortord = "DESC";
        break;
        };

        switch(sortval){
            case "title": 
                dbquery = "ORDER BY title "+dbsortord;
                break;
            case "rating":
                dbquery = "ORDER BY rating "+dbsortord;
                break;
            case "time":
                dbquery = "ORDER BY date "+dbsortord;
                break;
            case "author":
            dbquery = "ORDER BY author "+dbsortord;
            break;
        };

        let dbresult;
         console.log("dbquery value is: ", dbquery);
        if (dbquery){
        dbresult = await db.query(`SELECT * FROM bookreviewlist WHERE email = $1 ${dbquery}`, [loggedinemail]);
        } else {
        dbresult = await db.query(`SELECT * FROM bookreviewlist WHERE email = $1`, [loggedinemail]);
        }
        // console.log("The data fetched from the db is: ", dbresult.rows);
        res.render("index.ejs", {dbdata: dbresult.rows, sorted: sortval});
    } else {
        res.redirect("/users/home");
    };
});

// This is just for sending the page for the user to input the actual new book information
app.get("/addnewbookpage", (req, res) =>{
    if(req.isAuthenticated()) {
        res.render("addnewbook.ejs");
    } else {
        res.redirect("/users/home");
    };
});

app.get("/editbook/:id", async (req, res) =>{
    if(req.isAuthenticated()) {
        const bookid = sanitizeHtml(req.params.id);
        console.log("The book id received is: ", bookid);
        const editdbresult = await db.query(`SELECT * FROM bookreviewlist WHERE id = $1`, [bookid]);
        console.log("The book title db result for edit is: ", editdbresult.rows[0].title);
        res.render("editbook.ejs", {bookdata: editdbresult.rows[0]});
    } else {
        res.redirect("/users/home");
    };
});

app.get("/delete/:id", async (req, res) =>{
    if(req.isAuthenticated()) {
        const bookid = sanitizeHtml(req.params.id).toString();
        console.log("The id received from delete is: ", bookid);
        await db.query(`DELETE FROM bookreviewlist WHERE id = $1`, [bookid]);
        res.redirect("/");
    } else {
        res.redirect("/users/home");
    };
});

app.post("/postnewbook", async (req, res) => {
    if(req.isAuthenticated()) {
        var loggedinemail = req.user.email;
        let imgsrc;
        // collect all the input information in variables
        let newbooktitle = sanitizeHtml(req.body.booktitle);
        let newbookauthor = sanitizeHtml(req.body.bookauthor);
        let newbooksummary = sanitizeHtml(req.body.booksummary);
        let newbookrating = sanitizeHtml(req.body.rating);
        
        // get the book ISBN no
        const newtitlewords = newbooktitle.split(" ").join("+");
        const newauthorwords = newbookauthor.split(" ").join("+");
        try{
        const response = await axios.get(`https://openlibrary.org/search.json?title=${newtitlewords}`);

        var isbn13;

        if(response.data.docs[0].ia.find(item => item.startsWith("isbn"))){
        isbn13 = response.data.docs[0].ia.find(item => item.startsWith("isbn")).slice(5);
        console.log("The ISBN13 no obtained is: " + isbn13);
        } else {isbn13=""}
        

        } catch(err) {
            console.error("The error fetching isbn is: " + err);
        }
        if (isbn13){
            console.log("The isbn13 value is: " + isbn13);
            try{
            const time = new Date();
            await db.query('INSERT INTO bookreviewlist(title, author, rating, summary, isbn, date, email) VALUES ($1, $2, $3, $4, $5, $6, $7)', [newbooktitle, newbookauthor, newbookrating, newbooksummary, isbn13, time, loggedinemail]);
            } catch(error) { console.error("error inserting into database with isbn13 present is: " + error)}
        }else{
            console.log("ISBN13 does not exist!");
            try{
            const time = new Date();
            await db.query('INSERT INTO bookreviewlist(title, author, rating, summary, isbn, date, email) VALUES ($1, $2, $3, $4, $5, $6, $7)', [newbooktitle, newbookauthor, newbookrating, newbooksummary, "", time, loggedinemail]);
            } catch(error) { console.error("error inserting into database without isbn13 present is: " + error)}
        };
        res.redirect("/");
    } else {
        res.redirect("/users/home");
    };
    
})

app.post("/posteditedbook", async (req, res) =>{

    if(req.isAuthenticated()) {
        const bookid = sanitizeHtml(req.body.editbookid);
        let updatedbooktitle = sanitizeHtml(req.body.editbooktitle);
        let updatedbookauthor = sanitizeHtml(req.body.editbookauthor);
        let updatedbooksummary = sanitizeHtml(req.body.editbooksummary);
        let updatedbookrating = sanitizeHtml(req.body.editrating);

        let updatedtime = new Date();

        await db.query('UPDATE bookreviewlist SET title=$1, author=$2, rating=$3, summary=$4, date=$5 WHERE id=$6', [updatedbooktitle, updatedbookauthor, updatedbookrating, updatedbooksummary, updatedtime, bookid]);
        
        res.redirect("/");
     } else {
        res.redirect("/users/home");
    };
});

app.post("/sort", (req, res) =>{
    if(req.isAuthenticated()) {
        const sortquery = sanitizeHtml(req.body.sortby);
        const sortorder = sanitizeHtml(req.body.sortorder);
        res.redirect(`yourcollection/?sorted=${sortquery}&sortord=${sortorder}`);
     } else {
        res.redirect("/users/home");
    };
});

app.get("/bookview/:id", async (req, res) =>{
    if(req.isAuthenticated()) {
        const bookid = sanitizeHtml(req.params.id);
        const editdbresult = await db.query(`SELECT * FROM bookreviewlist WHERE id = $1`, [bookid]);
        res.render("bookview.ejs", {bookdata: editdbresult.rows[0]});
    } else {
    res.redirect("/users/home");
    };
});

app.get("/about", (req, res) =>{
    let loggedstatus = req.user ? true : false;
    res.render("about.ejs", {loggedstatus: loggedstatus});
})

app.listen(port, console.log(`Server has started on port ${port}`));