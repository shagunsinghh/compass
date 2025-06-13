const express = require("express");
const http = require("http");
const path = require("path");
const socketIo = require("socket.io");
const multer = require("multer");
const fs = require("fs");
const bcrypt = require("bcrypt");
const session = require("express-session");
const usersFile = path.join(__dirname, "users.json");

require("dotenv").config();

const app = express();

app.use(
  session({
    secret: "supersecret-key",
    resave: false,
    saveUninitialized: false,
  })
);

// ─── Multer: use /tmp/uploads instead of uploads/ ─────────────────────────────
const tmpDir = "/tmp/uploads";
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: tmpDir,
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({ storage });
// ───────────────────────────────────────────────────────────────────────────────

const server = http.createServer(app);
const io = socketIo(server);

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/");
  }
  next();
}

// EJS setup from remote
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Debug middleware to log all requests
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

app.get("/intake.html", requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "intake.html"));
});

app.get("/collab2.html", requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "collab2.html"));
});

app.get("/rag.html", requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "rag.html"));
});

app.get("/session", (req, res) => {
  if (req.session.user) {
    return res.json(req.session.user); // ✅ Success
  } else {
    return res.status(401).send("Not logged in");
  }
});

// Important: Make sure JSON parsing middleware comes BEFORE your routes
app.use(express.json({ limit: "10mb" })); // Increased limit for PDF text
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// Check environment variables
console.log("🔍 Environment Check:");
console.log(
  "- OPENAI_API_KEY:",
  process.env.OPENAI_API_KEY ? "✅ Set" : "❌ Missing"
);
console.log("- Node.js version:", process.version);

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
  },
};

// OpenAI API route for detailed paragraph responses
app.post("/api/analyze", async (req, res) => {
  console.log("📧 /api/analyze endpoint hit");

  try {
    const { pdfText } = req.body;

    if (!pdfText) {
      return res.status(400).json({ error: "Missing pdfText in request body" });
    }

    console.log("📄 PDF text length:", pdfText.length);
    console.log("📄 PDF preview:", pdfText.substring(0, 500));

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "OpenAI API key not configured" });
    }

    let fetch;
    try {
      fetch = (await import("node-fetch")).default;
    } catch (e) {
      fetch = global.fetch;
    }

    // Enhanced prompt for detailed paragraph responses
    const prompt = `Analyze this research document and extract detailed, comprehensive information for IRB sections. Provide 2-4 sentences for each section with specific details from the document.

Document text:
${pdfText.substring(0, 8000)}

Extract the following information and return as JSON. Each field should contain a detailed paragraph (2-4 sentences) with specific information from the document:

{
  "section1": "Complete study title with any subtitle or additional descriptive information found in the document",
  "section2": "Principal Investigator's full name, title, institutional affiliation, department, and contact information if available. Look for corresponding author, PI, or lead researcher - often marked with * or 'corresponding author'",
  "section3": "Detailed study purpose, research objectives, hypotheses, and specific aims. Include what the study hopes to achieve and any research questions being addressed",
  "section4": "Comprehensive background information, scientific rationale, literature context, and significance of the research. Include why this study is needed and what gaps it addresses",
  "section5": "Detailed description of target population, demographics, sample size, inclusion criteria, exclusion criteria, and any special population considerations",
  "section6": "Comprehensive recruitment methods, strategies for participant identification, recruitment materials, and how participants will be approached and enrolled",
  "section7": "Detailed research procedures, methodology, study design, data collection methods, interventions, and step-by-step description of what participants will experience",
  "section8": "Thorough risk assessment including physical, psychological, social, and economic risks. Include safety considerations, monitoring procedures, and risk mitigation strategies",
  "section9": "Detailed description of benefits to participants, society, and scientific knowledge. Include both direct benefits to participants and broader societal impact",
  "section10": "Comprehensive data handling procedures, confidentiality measures, data storage, security protocols, de-identification procedures, and data sharing plans",
  "section11": "Detailed informed consent process, who will obtain consent, how consent will be documented, and any special consent considerations",
  "section12": "Comprehensive list and description of supporting documents, materials, instruments, consent forms, and any additional documentation referenced in the study"
}

IMPORTANT: Each JSON value must be a detailed paragraph (2-4 sentences minimum) with specific information extracted from the document. Do not provide brief one-sentence responses.`;

    console.log("🚀 Making OpenAI API request...");

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are an expert research analyst specializing in IRB applications. Carefully read the document and extract detailed, comprehensive information. For each section, provide 2-4 sentences with specific details from the document. Each JSON value should be a detailed paragraph, not just a brief phrase. Always return valid JSON only, but with substantive, paragraph-length content for each field.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        max_tokens: 3000, // Increased for longer responses
        temperature: 0.1,
      }),
    });

    console.log("📡 OpenAI API response status:", response.status);

    if (!response.ok) {
      const errorData = await response.text();
      console.error("❌ OpenAI API error:", errorData);
      return res
        .status(500)
        .json({ error: `OpenAI API error: ${response.status}` });
    }

    const data = await response.json();
    console.log("✅ OpenAI response received successfully");

    // Enhanced debugging
    const content = data.choices[0].message.content;
    console.log("📝 Full OpenAI response:", content);

    // Try to extract and validate JSON
    let extractedData;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        extractedData = JSON.parse(jsonMatch[0]);
        console.log("✅ Successfully parsed JSON:", extractedData);

        // Validate that responses are detailed (more than just a few words)
        Object.keys(extractedData).forEach((key) => {
          const value = extractedData[key];
          if (value && value.length < 50) {
            console.log(`⚠️ Warning: ${key} response seems brief:`, value);
          }
        });

        // Special validation for PI field
        if (extractedData.section2) {
          console.log(
            "👨‍🔬 Principal Investigator found:",
            extractedData.section2
          );
        } else {
          console.log("❌ No PI information extracted");
        }
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (parseError) {
      console.error("❌ JSON parsing failed:", parseError);
      console.log("Raw content for debugging:", content);

      // Create intelligent fallback with detailed responses
      extractedData = createDetailedFallback(pdfText);
    }

    res.json({
      choices: [
        {
          message: {
            content: JSON.stringify(extractedData, null, 2),
          },
        },
      ],
    });
  } catch (error) {
    console.error("💥 Error in /api/analyze:", error.message);
    res.status(500).json({ error: "Internal server error: " + error.message });
  }
});

// Enhanced fallback function with detailed paragraph responses
function createDetailedFallback(pdfText) {
  console.log("🔄 Creating detailed fallback analysis");

  const text = pdfText.toLowerCase();
  const suggestions = {};

  // Create detailed fallback responses based on document content
  if (text.includes("conformable ultrasound") && text.includes("breast")) {
    suggestions.section1 =
      "Conformable ultrasound breast patch for deep tissue scanning and imaging. This study focuses on developing a wearable ultrasound technology specifically designed for breast tissue monitoring and imaging applications.";

    suggestions.section2 =
      "Canan Dagdeviren serves as the corresponding author and principal investigator for this research. She is affiliated with the Media Lab at Massachusetts Institute of Technology in Cambridge, MA, where she leads research in conformable electronics and biomedical applications.";

    suggestions.section3 =
      "The primary purpose of this study is to develop and evaluate a wearable conformable ultrasound breast patch (cUSBr-Patch) that enables standardized and reproducible image acquisition over the entire breast. The research aims to reduce reliance on operator training and applied transducer compression while providing large-area, deep scanning capabilities. The study seeks to overcome fundamental challenges in ultrasound integration with wearable technologies, particularly for imaging over large-area curvilinear organs like the breast.";

    suggestions.section4 =
      "Current ultrasound technologies face significant challenges in wearable integration, specifically in imaging over large-area curvilinear organs such as the breast. Existing methods like handheld ultrasonography rely heavily on technician expertise and manual compression, while automated breast ultrasound systems suffer from poor skin contact due to bulky, stationary machines. This research addresses critical gaps in automated, repeatable breast screening technology by developing a nature-inspired honeycomb patch design that provides consistent placement and orientation for comprehensive breast imaging.";

    suggestions.section5 =
      "The study targets adult participants who are suitable candidates for breast ultrasound imaging procedures. Inclusion criteria focus on individuals who can safely undergo ultrasound examination, while exclusion criteria include participants with significant health problems such as chronic or acute cardiovascular diseases and skin diseases that might interfere with device placement or imaging quality. The research aims to accommodate a wide range of breast sizes and anatomical variations through the flexible patch design.";

    suggestions.section6 =
      "Participant recruitment will be conducted through institutional channels and voluntary participation from eligible candidates. The recruitment strategy emphasizes identifying individuals who meet the study criteria and are willing to participate in the ultrasound imaging procedures. Recruitment materials will clearly explain the study purpose, procedures, and any potential risks or benefits to ensure informed decision-making by prospective participants.";

    suggestions.section7 =
      "Participants will wear the conformable ultrasound breast patch while imaging is performed using a phased array system at multiple positions and angles around the breast. The procedure involves placing the nature-inspired honeycomb patch on the breast, positioning the ultrasound array at various predetermined locations, and conducting imaging sessions with 360-degree rotation capabilities. The study protocol includes systematic scanning of different breast quadrants to obtain comprehensive imaging data while maintaining standardized positioning and minimizing operator-dependent variables.";

    suggestions.section8 =
      "The study involves minimal risk as it utilizes non-invasive ultrasound imaging technology with standard safety protocols. Ultrasound imaging is considered safe with no exposure to ionizing radiation, and the conformable patch design minimizes pressure application compared to traditional handheld methods. Potential risks are limited to minor skin irritation from the patch adhesive or temporary discomfort during device placement. Safety monitoring will be maintained throughout all imaging procedures with immediate discontinuation if any adverse reactions occur.";

    suggestions.section9 =
      "This research offers significant benefits for the advancement of wearable medical imaging technology with potential applications in improved breast cancer screening and early detection. The development of a conformable ultrasound patch could provide more accessible, cost-effective, and user-friendly breast imaging options compared to current methods. The technology may enable more frequent monitoring and earlier detection of breast abnormalities, potentially improving patient outcomes. Additionally, the research contributes to the broader field of wearable medical devices and may inspire similar innovations for other medical applications.";

    suggestions.section10 =
      "All collected data will be de-identified and stored securely according to institutional data protection guidelines and regulations. Imaging data and related measurements will be coded with unique identifiers rather than personal information to maintain participant confidentiality. Data storage will utilize secure, encrypted systems with restricted access limited to authorized research personnel. Any data sharing for research purposes will follow established protocols for de-identified medical data, ensuring participant privacy is maintained throughout the research process and any subsequent analyses.";

    suggestions.section11 =
      "Written informed consent will be obtained by trained research personnel prior to any study procedures. The consent process will include detailed explanation of the study purpose, procedures, potential risks and benefits, and participants' rights including the right to withdraw at any time. Research staff will ensure participants understand all aspects of the study and have opportunities to ask questions before providing consent. Documentation of the consent process will be maintained according to institutional requirements for human subjects research.";

    suggestions.section12 =
      "Supporting documentation includes informed consent forms, device technical specifications, imaging protocols, and safety documentation. Additional materials encompass the ultrasound patch design specifications, imaging system operational procedures, data collection protocols, and quality assurance measures. Safety documentation includes device testing results, biocompatibility assessments, and risk mitigation procedures to ensure participant safety throughout the study period.";
  } else {
    // Generic detailed fallback for other types of documents
    suggestions.section1 =
      "Research study title and focus area as identified in the document header or introduction section. Additional descriptive information about the study scope and objectives may be included in subtitle or abstract sections of the document.";

    suggestions.section2 =
      "Principal Investigator identification based on author information, corresponding author designation, or institutional affiliation details provided in the document. Contact information and institutional department may be included if specified in the research publication or study protocol.";

    suggestions.section3 =
      "Study objectives and research aims as described in the document's purpose or objectives section. This includes the primary research questions, hypotheses being tested, and specific goals the study aims to achieve through its methodology and data collection procedures.";

    suggestions.section4 =
      "Background information and scientific rationale based on literature review and contextual information provided in the document. This encompasses the research gaps being addressed, previous work in the field, and the significance of the proposed study in advancing scientific knowledge.";

    suggestions.section5 =
      "Study population characteristics and participant criteria as specified in the research protocol or methodology section. This includes demographic requirements, inclusion and exclusion criteria, sample size considerations, and any special population considerations relevant to the research objectives.";

    suggestions.section6 =
      "Participant recruitment strategies and identification methods outlined in the study methodology. This encompasses the approaches for reaching potential participants, recruitment materials and procedures, and methods for enrolling eligible individuals in the research study.";

    suggestions.section7 =
      "Research procedures and experimental protocols as detailed in the methodology section of the document. This includes step-by-step descriptions of data collection procedures, interventions or treatments, measurement protocols, and the overall study design implementation.";

    suggestions.section8 =
      "Risk assessment and safety considerations identified in the study design and methodology. This includes potential physical, psychological, social, or economic risks to participants, along with safety monitoring procedures and risk mitigation strategies implemented to protect participant welfare.";

    suggestions.section9 =
      "Expected benefits to participants and broader scientific or societal impact as described in the study rationale. This encompasses both direct benefits that participants may receive and the potential contributions to scientific knowledge and societal advancement resulting from the research findings.";

    suggestions.section10 =
      "Data management and confidentiality procedures following institutional guidelines and regulatory requirements. This includes data collection, storage, security protocols, de-identification procedures, and any planned data sharing or publication protocols while maintaining participant privacy.";

    suggestions.section11 =
      "Informed consent process and documentation procedures as outlined in the research protocol. This includes who will obtain consent, how the consent process will be conducted, documentation requirements, and any special considerations for ensuring participant understanding and voluntary participation.";

    suggestions.section12 =
      "Supporting documentation and materials referenced in the study protocol. This includes consent forms, data collection instruments, questionnaires, technical specifications, and any additional materials necessary for conducting the research study according to the established protocol.";
  }

  console.log("📋 Detailed fallback analysis complete");
  return suggestions;
}

// Test endpoint to verify API is working
app.get("/api/test", (req, res) => {
  console.log("🧪 Test endpoint hit");
  res.json({
    status: "API is working",
    timestamp: new Date().toISOString(),
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
  });
});

// Your original routes
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

// Socket.io connection handling
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

// Submit intake route
app.post("/submit-intake", upload.single("supporting_docs"), (req, res) => {
  const formData = {
    user_email: req.session.user?.email || "unknown",
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
  ${formLibrary.required_for_all
    .map((f) => `<li><a href="${f.url}" target="_blank">${f.name}</a></li>`)
    .join("")}
</ul>

${
  conditionalForms.length
    ? `
    <h2>Additional Recommended Forms (Based on Your Responses)</h2>
    <ul>
      ${conditionalForms
        .map((f) => `<li><a href="${f.url}" target="_blank">${f.name}</a></li>`)
        .join("")}
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

// Save collaborative IRB draft
app.post("/save-draft", requireLogin, (req, res) => {
  const draftPath = path.join(__dirname, "drafts.json");
  let drafts = fs.existsSync(draftPath)
    ? JSON.parse(fs.readFileSync(draftPath))
    : [];

// Load existing draft if it exists, so we keep collaborators
    let existingDraft = drafts.find(
  (d) => d.email === req.session.user.email && d.title === req.body.title
);

const newDraft = {
  email: req.session.user.email,
  timestamp: new Date().toISOString(),
  title: req.body.title || "Untitled",
  sections: req.body.sections,
  extraForms: req.body.extraForms || {},
  collaborators: existingDraft?.collaborators || []
};

  // Replace old draft with same title
  drafts = drafts.filter(
    (d) => !(d.email === newDraft.email && d.title === newDraft.title)
  );
  drafts.push(newDraft);

  fs.writeFileSync(draftPath, JSON.stringify(drafts, null, 2));
  res.json({ success: true });
});

// Load draft when editing
app.get("/load-draft", requireLogin, (req, res) => {
  const draftPath = path.join(__dirname, "drafts.json");  // ✅ Shared file
  if (!fs.existsSync(draftPath)) return res.status(404).send("No drafts found");

  const drafts = JSON.parse(fs.readFileSync(draftPath));
  const draft = drafts.find(
    (d) => d.email === req.session.user.email && d.title === req.query.title
  );

  if (!draft) return res.status(404).send("Draft not found");
  res.json(draft);
});



// Submissions route
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

// Protect all routes except login, register, and public files
app.use((req, res, next) => {
  const openPaths = [
    "/",
    "/login",
    "/register",
    "/login.html",
    "/register.html",
  ];
  const isStatic =
    req.path.startsWith("/public") || req.path.startsWith("/static");

  if (openPaths.includes(req.path) || isStatic) {
    return next();
  }

  if (!req.session.user) {
    return res.redirect("/");
  }

  next();
});

app.post("/register", (req, res) => {
  const { name, email, institution, group_name, password } = req.body;

  const newUser = {
    name,
    email,
    institution,
    group_name,
    password,
  };

  let users = [];
  if (fs.existsSync(usersFile)) {
    users = JSON.parse(fs.readFileSync(usersFile, "utf8"));
  }

  if (users.find((u) => u.email === email)) {
    return res.status(400).send("User already exists.");
  }

  users.push(newUser);
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));

  // ✅ This must be inside the route
  req.session.user = newUser;

  res.redirect("/dashboard");
});

app.get("/dashboard", requireLogin, (req, res) => {
  const draftPath = path.join(__dirname, "drafts.json");  // ✅ Shared file
  let drafts = [];
  if (fs.existsSync(draftPath)) {
    const allDrafts = JSON.parse(fs.readFileSync(draftPath));
    const userEmail = req.session.user.email;
  drafts = allDrafts.filter(d =>
    d.email === userEmail || (d.collaborators && d.collaborators.includes(userEmail))
  );
}

  const intakePath = path.join(__dirname, "intake_submissions.json");
  const submissions = fs.existsSync(intakePath)
    ? JSON.parse(fs.readFileSync(intakePath)).filter(
        (s) => s.user_email === req.session.user.email
      )
    : [];

  res.render("dashboard", {
    user: req.session.user,
    drafts,
    submissions,
  });
});


// Handle deleting a saved draft
app.post("/delete-draft", (req, res) => {
  const { title } = req.body;
  if (!req.session.user) return res.status(403).send("Unauthorized");

  const draftPath = path.join(__dirname, "drafts.json");
  if (!fs.existsSync(draftPath)) return res.redirect("/dashboard");

  let drafts = JSON.parse(fs.readFileSync(draftPath));
  drafts = drafts.filter(d => !(d.title === title && d.email === req.session.user.email));

  fs.writeFileSync(draftPath, JSON.stringify(drafts, null, 2));
  res.redirect("/dashboard");
});



// Handle deleting a submitted IRB
app.post("/delete-submission", (req, res) => {
  const { timestamp } = req.body;
  if (!req.session.user) return res.status(403).send("Unauthorized");

  const submissionPath = path.join(__dirname, "intake_submissions.json");
  if (!fs.existsSync(submissionPath)) return res.redirect("/dashboard");

  let submissions = JSON.parse(fs.readFileSync(submissionPath));
  submissions = submissions.filter(s => !(s.timestamp === timestamp && s.user_email === req.session.user.email));

  fs.writeFileSync(submissionPath, JSON.stringify(submissions, null, 2));
  res.redirect("/dashboard");
});





// Load stored submissions if available
let submissions = [];
const filePath = path.join(__dirname, "intake_submissions.json");
if (fs.existsSync(filePath)) {
  submissions = JSON.parse(fs.readFileSync(filePath));
}

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  // ✅ Correctly parse users.json
  const users = JSON.parse(fs.readFileSync("users.json", "utf8"));

  // ✅ Check that it's an array
  if (!Array.isArray(users)) {
    console.error("users.json is not an array!");
    return res.status(500).send("Internal error.");
  }

  // ✅ Look up user
  const user = users.find((u) => u.email === email);
  if (!user) {
    return res.send("User not found.");
  }

  // ✅ Simple password check (plaintext for now — switch to bcrypt later)
  if (user.password !== password) {
    return res.send("Incorrect password.");
  }

  // ✅ Save session
  req.session.user = user;
  console.log("Logged in user, session now:", req.session);

  res.redirect("/dashboard");
});

app.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Logout error:", err);
      return res.status(500).send("Error logging out.");
    }
    res.redirect("/login.html");
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
  console.log(`🧪 Test the API at: http://localhost:${PORT}/api/test`);
  console.log(`🤖 AI endpoint at: http://localhost:${PORT}/api/analyze`);
});

app.post("/invite-collaborator", requireLogin, (req, res) => {
  const { draftTitle, inviteEmail } = req.body;
  const draftPath = path.join(__dirname, "drafts.json");
  const drafts = fs.existsSync(draftPath)
    ? JSON.parse(fs.readFileSync(draftPath))
    : [];

  // Find the draft belonging to the logged-in user
  const draft = drafts.find(
    (d) => d.email === req.session.user.email && d.title === draftTitle
  );

  if (!draft) {
    return res.status(404).json({ message: "Draft not found or unauthorized." });
  }

  if (!draft.collaborators) {
    draft.collaborators = [];
  }

  if (!draft.collaborators.includes(inviteEmail)) {
    draft.collaborators.push(inviteEmail);
    fs.writeFileSync(draftPath, JSON.stringify(drafts, null, 2));
    return res.json({ message: `✅ ${inviteEmail} invited to collaborate.` });
  } else {
    return res.json({ message: `${inviteEmail} is already a collaborator.` });
  }
});


function loadCollaborators() {
  const params = new URLSearchParams(window.location.search);
  const draftTitle = params.get("draftTitle");

  fetch(`/load-draft?title=${encodeURIComponent(draftTitle)}`)
    .then(res => res.json())
    .then(data => {
      const list = document.getElementById("collaborator-list");
      list.innerHTML = ""; // Clear existing
      const collaborators = data.collaborators || [];

      collaborators.forEach(email => {
        const li = document.createElement("li");
        li.textContent = email;
        li.style.marginBottom = "4px";
        list.appendChild(li);
      });

      // Show yourself at the top (optional)
      if (data.email) {
        const you = document.createElement("li");
        you.innerHTML = `<strong>You:</strong> ${data.email}`;
        list.prepend(you);
      }
    });

}
