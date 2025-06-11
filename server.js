

const express = require("express");
const http = require("http");
const path = require("path");
const socketIo = require("socket.io");
const multer = require("multer");
const fs = require("fs");
const bcrypt = require('bcrypt');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const upload = multer({ dest: "uploads/" });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));



const formLibrary = {
  required_for_all: [
    {
      name: "ICF Template: Consent to Participate in Research",
      url: "/static/forms/icf-template-consent-participate-research_mit.docx",
    },
    {
      name: "Additional Standard Language for Informed Consent",
      url: "/static/forms/additional-standard-language-informed-consent.docx",
    },
    {
      name: "Supplement for Disclosure of Financial Interest",
      url: "/static/forms/supplement-disclosure-finance-2019-03-11.doc",
    },
  ],
  conditional: {
    involves_minors: {
      name: "Assent to Participate in Research (minors)",
      url: "/static/forms/assent-form-2019-01-22.doc",
    },
    uses_mturk: {
      name: "MTurk Consent Text",
      url: "https://couhes.mit.edu/guidelines/couhes-policy-using-amazons-mechanical-turk", // Add if available
    },
    uses_phi: {
      name: "Authorization for Release of Protected Health Information",
      url: "/static/forms/release-protected-health-information-2019-03-11_mit.doc",
    },
    is_genomic: {
      name: "Genomic Data Sharing Certification",
      url: "/static/forms/data-sharing-submission-certification-request-form.docx",
    },
    wants_waiver: {
      name: "Waiver or Alteration of Informed Consent Request",
      url: "/static/forms/informed-consent-waiver-or-alteration-2019-03-11-doc.docx",
    },
    not_in_english: {
      name: "Translation Attestation",
      url: "/static/forms/translation-attestation-2019-03-11.doc",
    },
    study_complete: {
      name: "Final Report Closure Form",
      url: "/static/forms/final-report-closure-form-2019-03-11.docx",
    },
    adverse_events: {
      name: "Protocol Event Reporting Form",
      url: "/static/forms/protocol-event-reporting-form.doc",
    },
    lincoln_lab: {
      name: "Scientific Review Form (Lincoln Lab only)",
      url: "/static/forms/scientific-review-form-2019-03-11.docx",
    },
    submitting_genomic_data: {
      name: "Genomic Data Sharing Certification",
      url: "/static/forms/data-sharing-submission-certification-request-form.docx",
    },
    conducting_interviews: {
      name: "Consent to Participate in Interview",
      url: "/static/forms/consent-participate-interview-june-2022_mit.docx",
    },
    mit_reviewing_irb: {
      name: "Local Context Form",
      url: "/static/forms/local-context-form.docx",
    },
    dod_funded: {
      name: "DoD Exempt Research Application",
      url: "/static/forms/application-department-defense-supported-exempt-research.docx",
    },
  }
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

const conditionalForms = [];
for (const key of Object.keys(formLibrary.conditional)) {
  if (req.body[key]) conditionalForms.push(formLibrary.conditional[key]);
}
formData.recommended_forms = conditionalForms;
formData.required_for_all = formLibrary.required_for_all;


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
          <h2>Forms Required for All Studies</h2>
<ul>
  ${formLibrary.required_for_all.map(f => `<li><a href="${f.url}" target="_blank">${f.name}</a></li>`).join("")}
</ul>

${
  conditionalForms.length
    ? `
    <h2>Additional Recommended Forms (Based on Your Responses)</h2>
    <ul>
      ${conditionalForms.map(f => `<li><a href="${f.url}" target="_blank">${f.name}</a></li>`).join("")}
    </ul>
    `
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

const session = require('express-session');

app.use(session({
  secret: 'secure_irb_platform_key',
  resave: false,
  saveUninitialized: true
}));


// dashboard for group-specific IRB hub
app.get('/dashboard', (req, res) => {
  if (!req.session.user) return res.redirect('/login.html');

  const user = usersDB[req.session.user.email];
  const submissions = user.submissions || [];

  res.render('dashboard', {
    user: req.session.user,
    submissions
  });
});

app.use(express.urlencoded({ extended: true }));

let usersDB = {}; // In-memory store (replace later with DB)

app.post('/register', async (req, res) => {
  const { email, password, group_name } = req.body;

  if (usersDB[email]) {
    return res.send("❌ Group already registered.");
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  usersDB[email] = {
    password: hashedPassword,
    group_name,
    submissions: []
  };

  res.redirect('/login.html');
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = usersDB[email];

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.send("❌ Invalid credentials.");
  }

  req.session.user = { email, group_name: user.group_name };
  res.redirect('/dashboard');
});
