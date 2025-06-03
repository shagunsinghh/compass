const express = require("express");
const http = require("http");
const path = require("path");
const socketIo = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Intake Form Handling
const multer = require("multer");
const upload = multer({ dest: "uploads/" });
const fs = require("fs");


//To identify/map which forms are needed
const formLibrary = {
  involves_minors: {
    name: "Assent to Participate in Research (minors)",
    url: "https://couhes.mit.edu/forms/assent.doc"
  },
  uses_mturk: {
    name: "MTurk Consent Text",
    url: "https://couhes.mit.edu/forms/mturk_consent.doc"
  },
  uses_phi: {
    name: "Authorization for Release of Protected Health Information",
    url: "https://couhes.mit.edu/forms/phi_release.doc"
  },
  is_genomic: {
    name: "Genomic Data Sharing Certification",
    url: "https://couhes.mit.edu/forms/genomic_cert.doc"
  },
  wants_waiver: {
    name: "Waiver or Alteration of Informed Consent Request",
    url: "https://couhes.mit.edu/forms/waiver_consent.docx"
  }
};
app.use(express.urlencoded({ extended: true }));


// Serve static files from ./public
app.use(express.static(path.join(__dirname, "public")));

//home page route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// In‐memory “shared document”
// (This is a very minimal baseline; it will reset if the server restarts.)
let sharedText = "";

// When a client connects:
io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  // Send the current document to the newly connected client
  socket.emit("init-content", sharedText);

  // When a client sends an update (the entire textarea value),
  // broadcast it to everyone (including the sender, so everyone stays in sync).
  socket.on("editor-change", (newText) => {
    sharedText = newText;
    socket.broadcast.emit("remote-edit", newText);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});



// Intake Form Handling
app.post("/submit-intake", upload.single("supporting_docs"), (req, res) => {
  const formData = {
    timestamp: new Date().toISOString(),
    title: req.body.title,
    pi: req.body.pi,
    irb_number: req.body.irb_number,
    description: req.body.description,
    recruitment: req.body.recruitment,
    risk_level: req.body.risk_level,
    consent: req.body.consent,
    uploaded_file: req.file?.originalname || null,
  };

  // Identify recommended forms
  const requiredForms = [];
  for (const key of Object.keys(formLibrary)) {
    if (req.body[key]) {
      requiredForms.push(formLibrary[key]);
    }
  }
formData.recommended_forms = requiredForms;

  const filePath = path.join(__dirname, "intake_submissions.json");
  let submissions = [];
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath);
    submissions = JSON.parse(existing);
  }

  submissions.push(formData);
  fs.writeFileSync(filePath, JSON.stringify(submissions, null, 2));

  // Render confirmation in HTML
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Submission Confirmed</title>
        <link rel="stylesheet" href="/main.css">
      </head>
      <body>
  <div id="navbar-placeholder"></div>
  <script>
    fetch('/navbar.html')
      .then(res => res.text())
      .then(html => {
        document.getElementById('navbar-placeholder').innerHTML = html;
      });
  </script>

  <div class="page-wrapper">

          <h1>Submission Received 🎉</h1>
          <p><strong>Study Title:</strong> ${formData.title}</p>
          <p><strong>PI:</strong> ${formData.pi}</p>
          <p><strong>Risk Level:</strong> ${formData.risk_level}</p>
          <p><strong>Consent Required:</strong> ${formData.consent}</p>
          <p><strong>Submitted At:</strong> ${formData.timestamp}</p>
      ${formData.recommended_forms.length > 0 ? `
  <h2>Recommended COUHES Forms</h2>
  <ul>
    ${formData.recommended_forms.map(f => `
      <li><a href="${f.url}" target="_blank">${f.name}</a></li>
    `).join("")}
  </ul>
` : `<p><em>No additional forms required based on your answers.</em></p>`}

<p><a href="/intake.html">← Submit another</a> | <a href="/submissions">View all submissions</a></p>


        </div>
      </body>
    </html>
  `;

  res.send(html);
});

//Show submissions in browser
app.get("/submissions", (req, res) => {
  const filePath = path.join(__dirname, "intake_submissions.json");

  if (!fs.existsSync(filePath)) {
    return res.send("<p>No submissions yet.</p>");
  }

  const submissions = JSON.parse(fs.readFileSync(filePath));
const html = `
  <!DOCTYPE html>
  <html>
    <head>
      <title>All IRB Submissions</title>
      <link rel="stylesheet" href="/main.css">
    </head>
    <body>
      <div id="navbar-placeholder"></div>
      <script>
        fetch('/navbar.html')
          .then(res => res.text())
          .then(html => {
            document.getElementById('navbar-placeholder').innerHTML = html;
          });
      </script>

      <div class="page-wrapper">
        <h1>IRB Submission Log</h1>
        ${submissions
          .map(
            (s) => `
              <div style="margin-bottom: 20px; border-bottom: 1px solid #ccc;">
                <p><strong>${s.title}</strong> by ${s.pi} — ${s.timestamp}</p>
                <p>Risk: ${s.risk_level} | Consent: ${s.consent}</p>
              </div>
            `
          )
          .join("")}
        <p><a href="/intake.html">← Submit another</a></p>
      </div>
    </body>
  </html>
`;

  res.send(html);
});
