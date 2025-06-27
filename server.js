import express from 'express';
import pg from 'pg';
import ejs from 'ejs';
import axios from 'axios';
import sanitizeHtml from 'sanitize-html';
import env from "dotenv";

const app = express();
const port = 3000;
env.config();

app.use(express.static("public"));
app.use(express.urlencoded({extended: true}));


const db = new pg.Client({
    user: process.env.SQL_USER,
    host: process.env.SQL_HOST,
    database: process.env.SQL_DATABASE,
    password: process.env.SQL_PASSWORD,
    port: process.env.SQL_PORT,
    pool_mode: process.env.SQL_MODE
   
});

db.connect();

app.get("/", async (req, res) => {
    // populate with existing information from the database
    
    var dbquery;
    const sortval = req.query.sorted || "";
    switch(sortval){
        case "title": 
            dbquery = "ORDER BY title ASC";
            break;
        case "rating":
            dbquery = "ORDER BY rating ASC";
            break;
        case "time":
            dbquery = "ORDER BY date ASC";
            break;
        case "author":
        dbquery = "ORDER BY author ASC";
        break;
    }
    let dbresult;
    if (dbquery){
     dbresult = await db.query(`SELECT * FROM bookreviewlist ${dbquery}`);
    } else {
     dbresult = await db.query(`SELECT * FROM bookreviewlist`);
    }
    // console.log("The data fetched from the db is: ", dbresult.rows);
    res.render("index.ejs", {dbdata: dbresult.rows, sorted: sortval});
})

app.get("/addnewbookpage", (req, res) =>{
    res.render("addnewbook.ejs");
});

app.get("/editbook/:id", async (req, res) =>{
    const bookid = sanitizeHtml(req.params.id);
    console.log("The book id received is: ", bookid);
    const editdbresult = await db.query(`SELECT * FROM bookreviewlist WHERE id = $1`, [bookid]);
    console.log("The book title db result for edit is: ", editdbresult.rows[0].title);
    res.render("editbook.ejs", {bookdata: editdbresult.rows[0]});

})

app.get("/delete/:id", async (req, res) =>{
    const bookid = sanitizeHtml(req.params.id).toString();
    console.log("The id received from delete is: ", bookid);
    await db.query(`DELETE FROM bookreviewlist WHERE id = $1`, [bookid]);
    res.redirect("/");
})

app.post("/postnewbook", async (req, res) => {
    
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
    // Below is the isbn13 location from google api(not used here as it needs api key)
    // const isbn13google = response.data.items[0].volumeInfo.industryIdentifiers[1].identifier;

    
    // const isbn13 = response.data.docs[0].ia.find(item => item.startsWith(“ISBN”)).slice(5)
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
        await db.query('INSERT INTO bookreviewlist(title, author, rating, summary, isbn, date) VALUES ($1, $2, $3, $4, $5, $6)', [newbooktitle, newbookauthor, newbookrating, newbooksummary, isbn13, time]);
        } catch(error) { console.error("error inserting into database with isbn13 present is: " + error)}
    }else{
        console.log("ISBN13 does not exist!");
        try{
        const time = new Date();
        await db.query('INSERT INTO bookreviewlist(title, author, rating, summary, isbn, date) VALUES ($1, $2, $3, $4, $5, $6)', [newbooktitle, newbookauthor, newbookrating, newbooksummary, "", time]);
        } catch(error) { console.error("error inserting into database without isbn13 present is: " + error)}
    };
    res.redirect("/");

    // get the book cover pic url src

    // if (isbn13){
    //     imgsrc = `https://covers.openlibrary.org/b/isbn/${isbn13}-L.jpg`;
    // } else {imgsrc = ""};

    // Add the information to the database
    // console.log("The book title received is: " + req.body.booktitle);
    // console.log("The book rating received is: " + req.body.rating);
})

app.post("/posteditedbook", async (req, res) =>{

    const bookid = sanitizeHtml(req.body.editbookid);
    let updatedbooktitle = sanitizeHtml(req.body.editbooktitle);
    let updatedbookauthor = sanitizeHtml(req.body.editbookauthor);
    let updatedbooksummary = sanitizeHtml(req.body.editbooksummary);
    let updatedbookrating = sanitizeHtml(req.body.editrating);

    let updatedtime = new Date();

    await db.query('UPDATE bookreviewlist SET title=$1, author=$2, rating=$3, summary=$4, date=$5 WHERE id=$6', [updatedbooktitle, updatedbookauthor, updatedbookrating, updatedbooksummary, updatedtime, bookid]);
    
    res.redirect("/");
})

app.post("/sort", (req, res) =>{
    const sortquery = sanitizeHtml(req.body.sortby);
    res.redirect(`/?sorted=${sortquery}`);
})

app.listen(port, console.log(`Server has started on port ${port}`));