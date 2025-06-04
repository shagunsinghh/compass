const express = require("express");
const http = require("http");
const path = require("path");
const socketIo = require("socket.io");
const multer = require("multer");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const upload = multer({ dest: "uploads/" });

const formLibrary = {
  involves_minors: {
    name: "Assent to Participate in Research (minors)",
    url: "https://couhes.mit.edu/forms/assent.doc",
  },
  uses_mturk: {
    name: "MTurk Consent Text",
    url: "https://couhes.mit.edu/forms/mturk_consent.doc",
  },
  uses_phi: {
    name: "Authorization for Release of Protected Health Information",
    url: "https://couhes.mit.edu/forms/phi_release.doc",
  },
  is_genomic: {
    name: "Genomic Data Sharing Certification",
    url: "https://couhes.mit.edu/forms/genomic_cert.doc",
  },
  wants_waiver: {
    name: "Waiver or Alteration of Informed Consent Request",
    url: "https://couhes.mit.edu/forms/waiver_consent.docx",
  },
};

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

let sharedText = "";
let sectionStates = {
  "section-1": "",
  "section-2": "",
  "section-3": "",
  "section-4": "",
  "section-5": "",
  "section-6": "",
  "section-7": "",
  "section-8": "",
  "section-9": "",
  "section-10": "",
  "section-11": "",
  "section-12": "",
};

const users = {};

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.emit("init-content", sharedText);

  socket.on("join", ({ name, color }) => {
    users[socket.id] = { name, color };
    io.emit(
      "user-list",
      Object.entries(users).map(([id, u]) => ({
        socketId: id,
        ...u,
      }))
    );
  });

  socket.on("text-change", (payload) => {
    const fullPayload = [...payload, socket.id];
    sharedText = payload[0].ops.reduce(
      (acc, op) => acc + (op.insert || ""),
      ""
    );
    socket.broadcast.emit("remote-text-change", fullPayload);
  });

  socket.on("cursor-change", ({ index, length }) => {
    const user = users[socket.id];
    if (user) {
      io.emit("remote-cursor-update", {
        socketId: socket.id,
        index,
        length,
        name: user.name,
        color: user.color,
      });
    }
  });

  Object.entries(sectionStates).forEach(([id, content]) => {
    socket.emit(`${id}-init`, content);
  });

  socket.on("section-edit", ({ section, content }) => {
    sectionStates[section] = content;
    socket.broadcast.emit(`${section}-update`, content);
  });

  socket.on("editor-change", (newText) => {
    sharedText = newText;
    socket.broadcast.emit("remote-edit", newText);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    delete users[socket.id];
    io.emit(
      "user-list",
      Object.entries(users).map(([id, u]) => ({
        socketId: id,
        ...u,
      }))
    );
  });
});

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

  const requiredForms = [];
  for (const key of Object.keys(formLibrary)) {
    if (req.body[key]) requiredForms.push(formLibrary[key]);
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
          fetch('/navbar.html').then(res => res.text()).then(html => {
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
          ${
            requiredForms.length
              ? `
            <h2>Recommended COUHES Forms</h2>
            <ul>
              ${requiredForms
                .map(
                  (f) =>
                    `<li><a href="${f.url}" target="_blank">${f.name}</a></li>`
                )
                .join("")}
            </ul>`
              : `<p><em>No additional forms required based on your answers.</em></p>`
          }
          <p><a href="/intake.html">← Submit another</a> | <a href="/submissions">View all submissions</a></p>
        </div>
      </body>
    </html>
  `;
  res.send(html);
});

app.get("/submissions", (req, res) => {
  const filePath = path.join(__dirname, "intake_submissions.json");

  if (!fs.existsSync(filePath)) return res.send("<p>No submissions yet.</p>");

  const submissions = JSON.parse(fs.readFileSync(filePath));
  const html = `
    <!DOCTYPE html>
    <html>
      <head><title>All IRB Submissions</title><link rel="stylesheet" href="/main.css"></head>
      <body>
        <div id="navbar-placeholder"></div>
        <script>
          fetch('/navbar.html').then(res => res.text()).then(html => {
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
